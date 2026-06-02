import { useRef, useCallback } from "react";
import { Platform } from "react-native";
import { useAppStore } from "../state/store";
import type { ServerMessage, ClientMessage } from "../types";

const HEARTBEAT_INTERVAL = 30_000;
const RECONNECT_BASE_DELAY = 1_000;
const RECONNECT_MAX_DELAY = 30_000;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttempts = useRef(0);
  const intentionalClose = useRef(false);
  const thinkingIdRef = useRef<string | null>(null);

  const {
    backendUrl,
    token,
    setConnectionStatus,
    setRunStatus,
    setRunId,
    setServerModel,
    addMessage,
    removeMessage,
    clearMessages,
    setPendingConfirmation,
    setSendMessage,
  } = useAppStore();

  const sendJson = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      let data: ServerMessage;
      try {
        data = JSON.parse(event.data as string);
      } catch {
        return;
      }

      switch (data.type) {
        case "auth_ok":
          setConnectionStatus("connected");
          setServerModel(data.model);
          setSendMessage(sendJson);
          reconnectAttempts.current = 0;
          break;

        case "auth_error":
          addMessage({
            timestamp: new Date().toISOString(),
            type: "error",
            content: `Auth failed: ${data.message}`,
          });
          setConnectionStatus("disconnected");
          break;

        case "term": {
          // Remove thinking indicator on first real output (skip blank/whitespace-only chunks)
          if (thinkingIdRef.current && data.text.trim().length > 0) {
            removeMessage(thinkingIdRef.current);
            thinkingIdRef.current = null;
          }
          addMessage({
            timestamp: new Date().toISOString(),
            type: "term",
            content: data.text,
          });
          break;
        }

        case "status":
          setRunStatus(data.running ? "running" : "idle");
          if (data.run_id) setRunId(data.run_id);
          break;

        case "run_started":
          setRunStatus("running");
          setRunId(data.run_id);
          // Show thinking indicator until first output arrives
          thinkingIdRef.current = addMessage({
            timestamp: new Date().toISOString(),
            type: "thinking",
            content: "Thinking…",
          });
          break;

        case "agent_output": {
          const content = formatAgentOutput(data);
          addMessage({
            timestamp: data.timestamp,
            type: data.content_type,
            content,
            toolName: data.tool_name,
            isError: data.is_error,
          });
          break;
        }

        case "agent_error":
          // stderr lines — show as errors
          addMessage({
            timestamp: new Date().toISOString(),
            type: "error",
            content: `⚠ ${data.message}`,
          });
          break;

        case "run_completed":
          setRunStatus("completed");
          setRunId(null);
          if (thinkingIdRef.current) {
            removeMessage(thinkingIdRef.current);
            thinkingIdRef.current = null;
          }
          break;

        case "run_stopped":
          setRunStatus("stopped");
          setRunId(null);
          if (thinkingIdRef.current) {
            removeMessage(thinkingIdRef.current);
            thinkingIdRef.current = null;
          }
          break;

        case "run_failed":
          setRunStatus("failed");
          setRunId(null);
          if (thinkingIdRef.current) {
            removeMessage(thinkingIdRef.current);
            thinkingIdRef.current = null;
          }
          break;

        case "confirmation_required":
          setPendingConfirmation({
            actionId: data.action_id,
            prompt: data.prompt,
            details: data.details,
          });
          break;

        case "git_diff":
          addMessage({
            timestamp: new Date().toISOString(),
            type: "text",
            content: `📋 Git Diff\n${data.stats}\n\n${data.diff.slice(0, 5000)}`,
          });
          break;

        case "server_error":
          addMessage({
            timestamp: new Date().toISOString(),
            type: "error",
            content: `🛑 Server error: ${data.message}`,
          });
          break;
      }
    },
    [setConnectionStatus, setRunStatus, setRunId, setServerModel, addMessage, removeMessage, setPendingConfirmation, setSendMessage, sendJson]
  );

  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    intentionalClose.current = false;
    setConnectionStatus("connecting");

    try {
      const ws = new WebSocket(backendUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Send auth immediately
        ws.send(JSON.stringify({ type: "auth", token }));
        addMessage({
          timestamp: new Date().toISOString(),
          type: "system",
          content: "Connecting to server...",
        });
      };

      ws.onmessage = handleMessage;

      ws.onerror = (err) => {
        console.warn("WebSocket error", err);
      };

      ws.onclose = () => {
        setConnectionStatus("disconnected");
        setSendMessage(null);
        stopHeartbeat();

        if (!intentionalClose.current) {
          scheduleReconnect();
        }
      };

      startHeartbeat(ws);
    } catch (err) {
      setConnectionStatus("disconnected");
      addMessage({
        timestamp: new Date().toISOString(),
        type: "error",
        content: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }, [backendUrl, token, handleMessage, setConnectionStatus, setSendMessage, addMessage]);

  const disconnect = useCallback(() => {
    intentionalClose.current = true;
    stopHeartbeat();
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnectionStatus("disconnected");
    setSendMessage(null);
  }, [setConnectionStatus, setSendMessage]);

  const scheduleReconnect = useCallback(() => {
    const delay = Math.min(
      RECONNECT_MAX_DELAY,
      RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts.current)
    );
    reconnectAttempts.current++;

    addMessage({
      timestamp: new Date().toISOString(),
      type: "system",
      content: `Reconnecting in ${(delay / 1000).toFixed(0)}s... (attempt ${reconnectAttempts.current})`,
    });

    reconnectTimer.current = setTimeout(() => {
      connect();
    }, delay);
  }, [connect, addMessage]);

  const startHeartbeat = (ws: WebSocket) => {
    heartbeatTimer.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "get_status" }));
      }
    }, HEARTBEAT_INTERVAL);
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer.current) {
      clearInterval(heartbeatTimer.current);
      heartbeatTimer.current = null;
    }
  };

  return { connect, disconnect, sendJson };
}

/**
 * Convert an agent_output message to a readable string for the log.
 */
function formatAgentOutput(msg: ServerMessage & { type: "agent_output" }): string {
  switch (msg.content_type) {
    case "thinking":
      return `💭 ${msg.content || ""}`;
    case "text":
      return msg.content || "";
    case "tool_use": {
      const toolName = msg.tool_name || "unknown";
      const summary = formatToolInput(toolName, msg.tool_input || {});
      return `🔧 ${toolName}: ${summary}`;
    }
    case "tool_result": {
      const prefix = msg.is_error ? "❌ " : "✓ ";
      const out = msg.stdout || msg.stderr || "";
      const truncated = out.length > 1000 ? out.slice(0, 1000) + "..." : out;
      return `${prefix}Result: ${truncated}`;
    }
    default:
      return "";
  }
}

function formatToolInput(name: string, input: Record<string, unknown>): string {
  if (name === "Bash" && typeof input.command === "string") {
    const cmd = input.command as string;
    return cmd.length > 150 ? cmd.slice(0, 150) + "..." : cmd;
  }
  if (name === "Edit" && typeof input.file_path === "string") {
    return `Edit ${input.file_path}`;
  }
  if (name === "Read" && typeof input.file_path === "string") {
    return `Read ${input.file_path}`;
  }
  if (name === "WebSearch" && typeof input.query === "string") {
    const q = input.query as string;
    return q.length > 80 ? q.slice(0, 80) + "..." : q;
  }
  // Generic: show keys
  const keys = Object.keys(input).join(", ");
  return keys || "(no input)";
}
