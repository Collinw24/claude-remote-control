import { useRef, useCallback, useEffect } from "react";
import { Platform, AppState, Dimensions } from "react-native";
import { useAppStore } from "../state/store";
import type { ServerMessage } from "../types";
import { normalizeBackendUrl, validateBackendUrl } from "../utils/connection";
import {
  getCloseCodeLabel,
  shouldReconnectAfterClose,
  shouldReportConnectionLoss,
  shouldUpdateConnectionStateAfterClose,
} from "../utils/websocketLifecycle";
import { getRunStatusFromServerStatus } from "../utils/runStatusSync";

const HEARTBEAT_INTERVAL = 15_000;
const PONG_TIMEOUT = 45_000;
const RECONNECT_BASE_DELAY = 1_000;
const RECONNECT_MAX_DELAY = 15_000;

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

function now(): number {
  return Date.now();
}

const WS_STATE: Record<number, string> = { 0: "CONNECTING", 1: "OPEN", 2: "CLOSING", 3: "CLOSED" };

// ── Console-only diagnostic ring (view via adb logcat) ──

const RING_SIZE = 500;
const diagRing: string[] = [];

function diag(msg: string): void {
  const line = `[WS ${ts()}] ${msg}`;
  diagRing.push(line);
  if (diagRing.length > RING_SIZE) diagRing.shift();
  console.log(line);
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pongTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  const intentionalClose = useRef(false);
  const thinkingIdRef = useRef<string | null>(null);
  const lastMessageTime = useRef(now());
  const heartbeatCount = useRef(0);
  const lastHbSent = useRef(0);
  const msgCount = useRef(0);
  const bytesReceived = useRef(0);
  const connectRef = useRef<() => void>(() => {});
  const replacedSockets = useRef(new WeakSet<WebSocket>());

  const {
    backendUrl,
    token,
    setBackendUrl,
    setConnectionStatus,
    setRunStatus,
    setRunId,
    setServerModel,
    addMessage,
    removeMessage,
    setPendingConfirmation,
    setSendMessage,
  } = useAppStore();

  // ── Visible UI message (only for important events) ──

  const uiMsg = useCallback(
    (text: string, type: "system" | "error" = "system") => {
      addMessage({
        timestamp: new Date().toISOString(),
        type,
        content: text,
      });
    },
    [addMessage]
  );

  const sendJson = useCallback(
    (msg: Record<string, unknown>) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        const raw = JSON.stringify(msg);
        diag(`>> SEND ${msg.type} · ${raw.length}B`);
        ws.send(raw);
      } else {
        diag(`>> DROP ${msg.type} · ws=${WS_STATE[ws?.readyState ?? 3]}`);
      }
    },
    []
  );

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      const receivedAt = now();
      lastMessageTime.current = receivedAt;
      msgCount.current++;
      const raw = event.data as string;
      bytesReceived.current += raw.length;

      let data: ServerMessage;
      try {
        data = JSON.parse(raw);
      } catch {
        diag(`<< RAW (non-JSON) · ${raw.length}B · ${raw.slice(0, 80)}`);
        return;
      }

      const elapsed = receivedAt - lastHbSent.current;
      diag(
        `<< RECV ${data.type} · ${raw.length}B · #${msgCount.current}` +
          (data.type === "status" ? ` · rtt=${elapsed}ms` : "")
      );

      switch (data.type) {
        case "auth_ok":
          diag(`AUTH OK · session=${data.session.slice(0, 8)}… · model=${data.model}`);
          setConnectionStatus("connected");
          setServerModel(data.model);
          setSendMessage(sendJson);
          reconnectAttempts.current = 0;
          sendJson({ type: "get_status" });
          break;

        case "auth_error":
          diag(`AUTH ERROR: ${data.message}`);
          uiMsg(`Auth failed: ${data.message}`, "error");
          setConnectionStatus("disconnected");
          break;

        case "term": {
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
          heartbeatCount.current++;
          {
            const synced = getRunStatusFromServerStatus({
              running: data.running,
              runId: data.run_id,
            });
            setRunStatus(synced.runStatus);
            setRunId(synced.runId);
            if (!data.running && thinkingIdRef.current) {
              removeMessage(thinkingIdRef.current);
              thinkingIdRef.current = null;
            }
          }
          break;

        case "run_started":
          setRunStatus("running");
          setRunId(data.run_id);
          diag(`RUN STARTED · ${data.run_id.slice(0, 8)}…`);
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
          diag(`SERVER ERROR: ${data.message}`);
          uiMsg(`Server: ${data.message}`, "error");
          break;

        default:
          diag(`<< UNKNOWN type="${(data as any).type}" · ${raw.slice(0, 120)}`);
      }
    },
    [uiMsg, setConnectionStatus, setRunStatus, setRunId, setServerModel, addMessage, removeMessage, setPendingConfirmation, setSendMessage, sendJson]
  );

  // ── Heartbeat / Pong (console-only logging) ──

  const startHeartbeat = useCallback((ws: WebSocket) => {
    heartbeatCount.current = 0;
    heartbeatTimer.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        lastHbSent.current = now();
        ws.send(JSON.stringify({ type: "get_status" }));
        diag(`>> HB sent`);
      }
    }, HEARTBEAT_INTERVAL);
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimer.current) {
      clearInterval(heartbeatTimer.current);
      heartbeatTimer.current = null;
    }
  }, []);

  const startPongTimer = useCallback(() => {
    if (pongTimer.current) clearTimeout(pongTimer.current);
    pongTimer.current = setTimeout(() => {
      const since = now() - lastMessageTime.current;
      diag(`PONG TIMEOUT · ${(since / 1000).toFixed(0)}s since last msg`);
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    }, PONG_TIMEOUT);
  }, []);

  const stopPongTimer = useCallback(() => {
    if (pongTimer.current) {
      clearTimeout(pongTimer.current);
      pongTimer.current = null;
    }
  }, []);

  // ── Connection lifecycle ──

  const doDisconnect = useCallback(
    (intentional: boolean, trigger: string) => {
      diag(
        `DISCONNECT · intentional=${intentional} · trigger=${trigger} · hb=${heartbeatCount.current} · msgs=${msgCount.current}`
      );
      intentionalClose.current = intentional;
      stopHeartbeat();
      stopPongTimer();
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      setConnectionStatus("disconnected");
      setSendMessage(null);
      setRunStatus("idle");
      setRunId(null);
    },
    [stopHeartbeat, stopPongTimer, setConnectionStatus, setSendMessage, setRunStatus, setRunId]
  );

  const connect = useCallback(() => {
    const prev = wsRef.current;
    if (prev) {
      diag(`CONNECT · replacing ws=${WS_STATE[prev.readyState]}`);
      replacedSockets.current.add(prev);
      prev.close();
    }

    const validationError = validateBackendUrl(backendUrl);
    if (validationError) {
      uiMsg(validationError, "error");
      setConnectionStatus("disconnected");
      return;
    }

    const normalizedBackendUrl = normalizeBackendUrl(backendUrl);
    if (normalizedBackendUrl !== backendUrl) {
      setBackendUrl(normalizedBackendUrl);
    }

    intentionalClose.current = false;
    setConnectionStatus("connecting");
    lastMessageTime.current = now();
    msgCount.current = 0;
    bytesReceived.current = 0;
    heartbeatCount.current = 0;
    lastHbSent.current = 0;

    const { width, height } = Dimensions.get("window");
    diag(
      `CONNECT · url=${normalizedBackendUrl} · platform=${Platform.OS}/${Platform.Version} · ${width}x${height}`
    );

    try {
      const ws = new WebSocket(normalizedBackendUrl);
      wsRef.current = ws;
      diag(`WS created · readyState=${WS_STATE[ws.readyState]}`);

      ws.onopen = () => {
        diag(`WS OPEN · sending auth`);
        ws.send(JSON.stringify({ type: "auth", token }));
      };

      ws.onmessage = (event) => {
        handleMessage(event);
        startPongTimer();
      };

      ws.onerror = () => {
        diag(`WS ERROR · readyState=${WS_STATE[ws.readyState]}`);
      };

      ws.onclose = (event) => {
        const { code, reason, wasClean } = event as CloseEvent;
        const replaced = replacedSockets.current.has(ws);
        const codeLabel = getCloseCodeLabel(code);
        const closeDecision = { code, intentional: intentionalClose.current, replaced };

        diag(`WS CLOSE · ${codeLabel} · clean=${wasClean}` + (reason ? ` · reason=${reason}` : ""));

        if (shouldReportConnectionLoss(closeDecision)) {
          uiMsg(`Connection lost (${codeLabel})`, "error");
        }

        if (shouldUpdateConnectionStateAfterClose(closeDecision)) {
          doDisconnect(false, `ws.onclose ${codeLabel}`);
        }

        if (shouldReconnectAfterClose(closeDecision)) {
          scheduleReconnect();
        }
      };

      startHeartbeat(ws);
      startPongTimer();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      diag(`CONNECT EXCEPTION: ${msg}`);
      uiMsg(`Connection failed: ${msg}`, "error");
      doDisconnect(false, `exception: ${msg}`);
    }
  }, [backendUrl, token, setBackendUrl, uiMsg, handleMessage, startPongTimer, startHeartbeat, doDisconnect, setConnectionStatus]);

  // ── AppState ──

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      const ws = wsRef.current;
      diag(`APPSTATE ${state} · ws=${WS_STATE[ws?.readyState ?? 3]}`);
      if (state === "active" && !intentionalClose.current) {
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          diag("APPSTATE dead socket — reconnect");
          reconnectAttempts.current = 0;
          connectRef.current();
        }
      }
    });
    return () => sub.remove();
  }, []);

  const disconnect = useCallback(() => {
    doDisconnect(true, "user disconnect");
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, [doDisconnect]);

  const scheduleReconnect = useCallback(() => {
    const delay = Math.min(
      RECONNECT_MAX_DELAY,
      RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts.current)
    );
    reconnectAttempts.current++;
    diag(`RECONNECT #${reconnectAttempts.current} in ${delay}ms`);
    uiMsg(`Reconnecting in ${(delay / 1000).toFixed(0)}s…`);

    reconnectTimer.current = setTimeout(() => {
      connectRef.current();
    }, delay);
  }, [uiMsg]);

  connectRef.current = connect;

  return { connect, disconnect, sendJson };
}

// ── Formatting ──

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
  const keys = Object.keys(input).join(", ");
  return keys || "(no input)";
}
