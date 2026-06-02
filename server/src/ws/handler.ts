import { WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import { appConfig } from "../config.js";
import { logger } from "../logger.js";
import { parseClientMessage, ServerMessage } from "./protocol.js";
import { spawnClaude, stopRun as killClaude } from "../claude/spawn.js";
import { createParser, ParserCallbacks } from "../claude/parser.js";
import { scanPrompt, scanCommand } from "../claude/guardrails.js";
import { runGitDiff } from "../quick-actions/git-diff.js";
import { runCommit } from "../quick-actions/commit.js";
import { runRevert } from "../quick-actions/revert.js";
import type { ChildProcess } from "child_process";

// ── Per-client state ──

interface PendingConfirmation {
  actionId: string;
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ClientState {
  authenticated: boolean;
  currentProcess: ChildProcess | null;
  currentRunId: string | null;
  currentRequestId: string | null;
  runStartedAt: number | null;
  pendingConfirmation: PendingConfirmation | null;
  lastError: string | null;
  outputLines: ServerMessage[];
}

// ── In-memory client registry ──

const clients = new Map<WebSocket, ClientState>();

export function getActiveClientCount(): number {
  return clients.size;
}

function createClientState(): ClientState {
  return {
    authenticated: false,
    currentProcess: null,
    currentRunId: null,
    currentRequestId: null,
    runStartedAt: null,
    pendingConfirmation: null,
    lastError: null,
    outputLines: [],
  };
}

// ── Send helpers ──

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function sendError(ws: WebSocket, message: string): void {
  send(ws, { type: "server_error", message });
}

function sendStatus(ws: WebSocket, state: ClientState): void {
  send(ws, {
    type: "status",
    connected: state.authenticated,
    running: state.currentProcess !== null,
    run_id: state.currentRunId,
    cwd: appConfig.projectDir,
    model: appConfig.model,
  });
}

// ── Stop current run ──

function stopCurrentRun(state: ClientState, reason: "user_requested" | "guardrails"): void {
  if (!state.currentProcess) return;
  logger.info("Stopping run", {
    runId: state.currentRunId,
    requestId: state.currentRequestId,
    reason,
  });
  killClaude(state.currentProcess);
  state.currentProcess = null;
  state.currentRunId = null;
  state.runStartedAt = null;
  // requestId is kept for the stopped/failed message
}

// ── Run Claude ──

function runClaude(ws: WebSocket, state: ClientState, prompt: string, requestId: string): void {
  // Stop any existing run first
  stopCurrentRun(state, "user_requested");

  const runId = uuidv4();
  state.currentRunId = runId;
  state.currentRequestId = requestId;
  state.runStartedAt = Date.now();
  state.outputLines = [];
  state.lastError = null;

  logger.info("Launching Claude", { runId, requestId, prompt: prompt.slice(0, 200) });

  send(ws, {
    type: "run_started",
    request_id: requestId,
    run_id: runId,
    timestamp: new Date().toISOString(),
  });
  sendStatus(ws, state);

  const child = spawnClaude(prompt, { requestId });
  state.currentProcess = child;

  const callbacks: ParserCallbacks = {
    onThinking(text, timestamp) {
      const msg = {
        type: "agent_output" as const,
        request_id: requestId,
        content_type: "thinking" as const,
        content: text,
        timestamp,
      };
      state.outputLines.push(msg);
      send(ws, msg);
    },
    onText(text, timestamp) {
      const msg = {
        type: "agent_output" as const,
        request_id: requestId,
        content_type: "text" as const,
        content: text,
        timestamp,
      };
      state.outputLines.push(msg);
      send(ws, msg);
    },
    onToolUse(toolName, toolInput, toolId, timestamp) {
      // Guardrail: scan the command
      if (toolName === "Bash" && toolInput && typeof toolInput.command === "string") {
        const result = scanCommand(toolInput.command as string);
        if (result.action === "block") {
          logger.warn("Guardrail blocked tool_use", {
            runId,
            requestId,
            command: (toolInput.command as string).slice(0, 200),
            reason: result.reason,
          });
          stopCurrentRun(state, "guardrails");
          send(ws, {
            type: "run_stopped",
            request_id: requestId,
            reason: "guardrails",
          });
          send(ws, {
            type: "server_error",
            message: `Blocked dangerous command: ${result.reason}`,
          });
          sendStatus(ws, state);
          return; // Don't forward the tool_use
        }
        if (result.action === "confirm") {
          // Post-hoc guard: tool already executing. Log it and warn.
          logger.warn("Confirm-required tool_use executing (post-hoc)", {
            runId,
            requestId,
            command: (toolInput.command as string).slice(0, 200),
            reason: result.reason,
          });
          // For MVP: still forward the tool_use but mark it
          const msg = {
            type: "agent_output" as const,
            request_id: requestId,
            content_type: "tool_use" as const,
            tool_name: toolName,
            tool_input: toolInput,
            tool_id: toolId,
            content: `⚠️ DANGEROUS: ${result.reason}\n${toolInput.command}`,
            timestamp,
          };
          state.outputLines.push(msg);
          send(ws, msg);
          return;
        }
      }

      const msg = {
        type: "agent_output" as const,
        request_id: requestId,
        content_type: "tool_use" as const,
        tool_name: toolName,
        tool_input: toolInput,
        tool_id: toolId,
        timestamp,
      };
      state.outputLines.push(msg);
      send(ws, msg);
    },
    onToolResult(toolId, stdout, stderr, isError, timestamp) {
      const msg = {
        type: "agent_output" as const,
        request_id: requestId,
        content_type: "tool_result" as const,
        tool_id: toolId,
        stdout: stdout || undefined,
        stderr: stderr || undefined,
        is_error: isError,
        timestamp,
      };
      state.outputLines.push(msg);
      send(ws, msg);

      if (stderr) {
        state.lastError = stderr;
      }
    },
    onError(message) {
      state.lastError = message;
      send(ws, {
        type: "agent_error",
        message,
        request_id: requestId,
      });
    },
    onCompleted(result, numTurns, usage) {
      const duration = state.runStartedAt ? Date.now() - state.runStartedAt : 0;
      logger.info("Run completed", { runId, requestId, numTurns, durationMs: duration });
      state.currentProcess = null;
      state.currentRunId = null;
      state.runStartedAt = null;
      send(ws, {
        type: "run_completed",
        request_id: requestId,
        result,
        num_turns: numTurns,
        duration_ms: duration,
        usage,
      });
      sendStatus(ws, state);
    },
    onFailed(error, code) {
      const duration = state.runStartedAt ? Date.now() - state.runStartedAt : 0;
      logger.error("Run failed", { runId, requestId, error, code, durationMs: duration });
      state.currentProcess = null;
      state.currentRunId = null;
      state.runStartedAt = null;
      state.lastError = error;
      send(ws, {
        type: "run_failed",
        request_id: requestId,
        error,
        code,
      });
      sendStatus(ws, state);
    },
  };

  const parser = createParser(callbacks);

  // Pipe stdout through the JSONL parser
  if (child.stdout) {
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer
      for (const line of lines) {
        if (line.trim()) {
          parser.feed(line.trim());
        }
      }
    });
    child.stdout.on("end", () => {
      if (buffer.trim()) {
        parser.feed(buffer.trim());
      }
    });
  }

  // Pipe stderr through error handler
  if (child.stderr) {
    let errBuffer = "";
    child.stderr.on("data", (chunk: Buffer) => {
      errBuffer += chunk.toString();
      const lines = errBuffer.split("\n");
      errBuffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) {
          callbacks.onError(line.trim());
        }
      }
    });
    child.stderr.on("end", () => {
      if (errBuffer.trim()) {
        callbacks.onError(errBuffer.trim());
      }
    });
  }

  // Handle process exit
  child.on("exit", (code, signal) => {
    if (code !== 0 && state.currentProcess === child) {
      callbacks.onFailed(
        `Process exited with code ${code}${signal ? `, signal ${signal}` : ""}`,
        code ? `EXIT_${code}` : `SIGNAL_${signal}`
      );
    }
  });

  child.on("error", (err) => {
    logger.error("Spawn error", { runId, requestId, error: err.message });
    if (state.currentProcess === child) {
      callbacks.onFailed(`Failed to spawn Claude: ${err.message}`, "SPAWN_ERROR");
    }
  });
}

// ── Handle quick actions ──

async function handleQuickAction(
  ws: WebSocket,
  state: ClientState,
  action: string,
  requestId: string
): Promise<void> {
  logger.info("Quick action", { action, requestId });

  switch (action) {
    case "continue":
      runClaude(ws, state, "Continue from where you left off.", requestId);
      break;

    case "run_tests":
      runClaude(
        ws,
        state,
        "Run the project's test suite, summarize failures, and fix them if safe.",
        requestId
      );
      break;

    case "git_diff":
      try {
        const diff = await runGitDiff(appConfig.projectDir);
        send(ws, {
          type: "git_diff",
          request_id: requestId,
          diff: diff.diff,
          files: diff.files,
          stats: diff.stats,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendError(ws, `Git diff failed: ${message}`);
      }
      break;

    case "explain_error":
      if (!state.lastError) {
        sendError(ws, "No previous error to explain. Run a prompt first.");
      } else {
        runClaude(
          ws,
          state,
          `The last command produced this error:\n\n${state.lastError}\n\nExplain what went wrong and propose the smallest safe fix.`,
          requestId
        );
      }
      break;

    case "commit":
      await handleCommitAction(ws, state, requestId);
      break;

    case "revert":
      await handleRevertAction(ws, state, requestId);
      break;

    default:
      sendError(ws, `Unknown quick action: ${action}`);
  }
}

async function handleCommitAction(
  ws: WebSocket,
  state: ClientState,
  requestId: string
): Promise<void> {
  try {
    const result = await runCommit(appConfig.projectDir);
    if (result.needsConfirmation) {
      const actionId = uuidv4();
      send(ws, {
        type: "confirmation_required",
        action_id: actionId,
        request_id: requestId,
        prompt: `Commit changes?`,
        details: `Files changed:\n${(result.files || []).join("\n")}\n\n${result.diff}`,
      });
      // Wait for confirmation response (handled in message switch)
      state.pendingConfirmation = {
        actionId,
        resolve: async (approved: boolean) => {
          state.pendingConfirmation = null;
          if (approved) {
            try {
              const commitResult = await runCommit(appConfig.projectDir, true);
              send(ws, {
                type: "agent_output",
                request_id: requestId,
                content_type: "text",
                content: commitResult.commitMessage || "Changes committed successfully.",
                timestamp: new Date().toISOString(),
              });
            } catch (err) {
              sendError(ws, `Commit failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          } else {
            sendError(ws, "Commit cancelled by user.");
          }
        },
        timer: setTimeout(() => {
          if (state.pendingConfirmation?.actionId === actionId) {
            state.pendingConfirmation.resolve(false);
            sendError(ws, "Confirmation timed out.");
          }
        }, 60_000),
      };
    } else if (result.committed) {
      send(ws, {
        type: "agent_output",
        request_id: requestId,
        content_type: "text",
        content: result.commitMessage || "Changes committed.",
        timestamp: new Date().toISOString(),
      });
    } else {
      sendError(ws, result.error || "Nothing to commit.");
    }
  } catch (err) {
    sendError(ws, `Commit failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleRevertAction(
  ws: WebSocket,
  state: ClientState,
  requestId: string
): Promise<void> {
  if (!appConfig.allowDestructiveActions) {
    send(ws, {
      type: "server_error",
      message:
        "Revert is disabled. Set ALLOW_DESTRUCTIVE_ACTIONS=true in .env to enable destructive actions.\n" +
        "⚠️ WARNING: This will discard uncommitted changes.",
    });
    return;
  }

  try {
    const result = await runRevert(appConfig.projectDir);
    if (result.needsConfirmation) {
      const actionId = uuidv4();
      send(ws, {
        type: "confirmation_required",
        action_id: actionId,
        request_id: requestId,
        prompt: "Revert all uncommitted changes?",
        details: `⚠️ This will discard:\n${(result.files || []).join("\n")}\n\n${result.diff}`,
      });
      state.pendingConfirmation = {
        actionId,
        resolve: async (approved: boolean) => {
          state.pendingConfirmation = null;
          if (approved) {
            try {
              const revertResult = await runRevert(appConfig.projectDir, true);
              send(ws, {
                type: "agent_output",
                request_id: requestId,
                content_type: "text",
                content: revertResult.message || "Changes reverted.",
                timestamp: new Date().toISOString(),
              });
            } catch (err) {
              sendError(ws, `Revert failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          } else {
            sendError(ws, "Revert cancelled by user.");
          }
        },
        timer: setTimeout(() => {
          if (state.pendingConfirmation?.actionId === actionId) {
            state.pendingConfirmation.resolve(false);
            sendError(ws, "Confirmation timed out.");
          }
        }, 60_000),
      };
    }
  } catch (err) {
    sendError(ws, `Revert failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── WebSocket connection handler ──

export function handleConnection(ws: WebSocket): void {
  const state = createClientState();
  clients.set(ws, state);

  logger.info("WebSocket client connected", { totalClients: clients.size });

  ws.on("message", (raw) => {
    let data: unknown;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      sendError(ws, "Invalid JSON");
      return;
    }

    const message = parseClientMessage(data);
    if (!message) {
      sendError(ws, "Invalid message format");
      return;
    }

    // Handle auth
    if (message.type === "auth") {
      if (message.token === appConfig.remoteToken) {
        state.authenticated = true;
        logger.info("Client authenticated");
        send(ws, {
          type: "auth_ok",
          session: uuidv4(),
          server_version: "1.0.0",
          model: appConfig.model,
        });
        sendStatus(ws, state);
      } else {
        logger.warn("Client auth failed — invalid token");
        send(ws, { type: "auth_error", message: "Invalid token" });
      }
      return;
    }

    // All other messages require authentication
    if (!state.authenticated) {
      sendError(ws, "Not authenticated. Send auth message first.");
      return;
    }

    switch (message.type) {
      case "prompt": {
        // Guardrail: scan prompt text before spawning
        const scanResult = scanPrompt(message.text);
        if (!scanResult.safe) {
          logger.warn("Guardrail blocked prompt", {
            requestId: message.request_id,
            reason: scanResult.reason,
          });
          sendError(ws, `Prompt blocked: ${scanResult.reason}`);
          return;
        }
        logger.info("Prompt received", {
          requestId: message.request_id,
          prompt: message.text.slice(0, 200),
        });
        runClaude(ws, state, message.text, message.request_id);
        break;
      }

      case "stop":
        logger.info("Stop requested", { runId: state.currentRunId });
        if (state.currentProcess) {
          stopCurrentRun(state, "user_requested");
          send(ws, {
            type: "run_stopped",
            request_id: state.currentRequestId || "unknown",
            reason: "user_requested",
          });
          sendStatus(ws, state);
        }
        break;

      case "quick_action":
        handleQuickAction(ws, state, message.action, message.request_id);
        break;

      case "confirm_action": {
        if (state.pendingConfirmation && state.pendingConfirmation.actionId === message.action_id) {
          clearTimeout(state.pendingConfirmation.timer);
          state.pendingConfirmation.resolve(message.approved);
        } else {
          sendError(ws, "No matching pending confirmation.");
        }
        break;
      }

      case "get_status":
        sendStatus(ws, state);
        break;

      default:
        sendError(ws, `Unknown message type`);
    }
  });

  ws.on("close", () => {
    logger.info("WebSocket client disconnected", { totalClients: clients.size - 1 });
    // Clean up
    if (state.currentProcess) {
      stopCurrentRun(state, "user_requested");
    }
    if (state.pendingConfirmation) {
      clearTimeout(state.pendingConfirmation.timer);
      state.pendingConfirmation.resolve(false);
    }
    clients.delete(ws);
  });

  ws.on("error", (err) => {
    logger.error("WebSocket error", { error: err.message });
    clients.delete(ws);
  });
}
