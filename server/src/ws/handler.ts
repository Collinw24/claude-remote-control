import { WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import { appConfig } from "../config.js";
import { logger } from "../logger.js";
import { parseClientMessage, ServerMessage } from "./protocol.js";
import { spawnClaude, stopRun } from "../claude/spawn.js";
import { scanPrompt } from "../claude/guardrails.js";
import { runGitDiff } from "../quick-actions/git-diff.js";
import { runCommit } from "../quick-actions/commit.js";
import { runRevert } from "../quick-actions/revert.js";
import type { ChildProcess } from "child_process";
import {
  appendBufferedTerm,
  TERM_BUFFER_MAX_CHARS,
  type TermBufferState,
} from "./sessionLifecycle.js";

const CONFIRMATION_TIMEOUT_MS = 60_000;

interface PendingConfirmation {
  actionId: string;
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ClientState extends TermBufferState {
  currentProcess: ChildProcess | null;
  currentRunId: string | null;
  currentRequestId: string | null;
  runStartedAt: number | null;
  pendingConfirmation: PendingConfirmation | null;
  lastError: string | null;
  claudeSessionId: string | null;
}

const clients = new Map<WebSocket, ClientState>();
const session = createClientState();
const serverSessionId = uuidv4();
let activeWs: WebSocket | null = null;

export function getActiveClientCount(): number {
  return clients.size;
}

function createClientState(): ClientState {
  return {
    currentProcess: null,
    currentRunId: null,
    currentRequestId: null,
    runStartedAt: null,
    pendingConfirmation: null,
    lastError: null,
    claudeSessionId: null,
    termBuffer: [],
    termBufferChars: 0,
  };
}

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function sendActive(message: ServerMessage): void {
  if (activeWs?.readyState === WebSocket.OPEN) {
    send(activeWs, message);
  }
}

function sendActiveTerm(state: ClientState, text: string): void {
  if (activeWs?.readyState === WebSocket.OPEN) {
    send(activeWs, { type: "term", text });
    return;
  }

  appendBufferedTerm(state, text);
}

function sendActiveError(message: string): void {
  sendActive({ type: "server_error", message });
}

function attachClient(ws: WebSocket, state: ClientState): void {
  if (activeWs && activeWs !== ws && activeWs.readyState === WebSocket.OPEN) {
    activeWs.close(1000, "Replaced by new authenticated client");
  }

  activeWs = ws;

  if (!state.claudeSessionId) {
    state.claudeSessionId = uuidv4();
    logger.info("Created Claude session", { sessionId: state.claudeSessionId });
  }
}

function replaySession(ws: WebSocket, state: ClientState): void {
  if (state.currentProcess && state.currentRunId && state.currentRequestId) {
    send(ws, {
      type: "run_started",
      request_id: state.currentRequestId,
      run_id: state.currentRunId,
      session_id: serverSessionId,
      timestamp: new Date().toISOString(),
    });
    send(ws, { type: "term", text: "\nReattached to running Claude session.\n" });
  }

  for (const text of state.termBuffer) {
    send(ws, { type: "term", text });
  }
  state.termBuffer = [];
  state.termBufferChars = 0;
}

function cleanupPendingConfirmation(state: ClientState): void {
  if (state.pendingConfirmation) {
    clearTimeout(state.pendingConfirmation.timer);
    state.pendingConfirmation.resolve(false);
    state.pendingConfirmation = null;
  }
}

function killRun(state: ClientState, reason: "user_requested" | "guardrails"): void {
  const proc = state.currentProcess;
  if (!proc) return;
  logger.info("Stopping run", { runId: state.currentRunId, reason });
  stopRun(proc);
  state.currentProcess = null;
  state.currentRunId = null;
  state.currentRequestId = null;
  state.runStartedAt = null;
}

function runClaude(state: ClientState, prompt: string, requestId: string): void {
  if (state.currentProcess) {
    killRun(state, "user_requested");
  }

  const sessionId = state.claudeSessionId || uuidv4();
  state.claudeSessionId = sessionId;
  state.currentRunId = sessionId;
  state.currentRequestId = requestId;
  state.runStartedAt = Date.now();
  state.lastError = null;
  state.termBuffer = [];
  state.termBufferChars = 0;

  logger.info("Launching Claude", { sessionId, requestId, prompt: prompt.slice(0, 200) });

  sendActiveTerm(state, `\x1b[1m> ${prompt}\x1b[0m\n`);
  sendActive({ type: "run_started", request_id: requestId, run_id: sessionId, session_id: serverSessionId, timestamp: new Date().toISOString() });

  const child = spawnClaude(prompt, sessionId);
  state.currentProcess = child;

  if (child.stdout) {
    child.stdout.on("data", (chunk: Buffer) => {
      sendActiveTerm(state, chunk.toString());
    });
  }

  if (child.stderr) {
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      state.lastError = (state.lastError || "") + text;
      if (state.lastError.length > TERM_BUFFER_MAX_CHARS / 2) {
        state.lastError = state.lastError.slice(-TERM_BUFFER_MAX_CHARS / 2);
      }
      sendActiveTerm(state, `\x1b[2m${text}\x1b[0m`);
    });
  }

  child.on("exit", (code) => {
    const duration = state.runStartedAt ? Date.now() - state.runStartedAt : 0;
    if (state.currentProcess === child) {
      state.currentProcess = null;
      state.currentRunId = null;
      state.currentRequestId = null;
      state.runStartedAt = null;
    }

    if (code === 0 || code === null) {
      logger.info("Run completed", { sessionId, requestId, durationMs: duration });
      sendActiveTerm(state, `\nCompleted in ${(duration / 1000).toFixed(1)}s\n`);
      sendActive({ type: "run_completed", request_id: requestId, result: "", num_turns: 0, duration_ms: duration, usage: {} });
    } else {
      logger.error("Run failed", { sessionId, requestId, exitCode: code, durationMs: duration });
      sendActiveTerm(state, `\nExited with code ${code}\n`);
      sendActive({ type: "run_failed", request_id: requestId, error: `Exit code ${code}`, code: `EXIT_${code}` });
    }
  });

  child.on("error", (err) => {
    logger.error("Spawn error", { sessionId, error: err.message });
    if (state.currentProcess === child) {
      state.currentProcess = null;
      state.currentRunId = null;
      state.currentRequestId = null;
      state.runStartedAt = null;
      sendActiveTerm(state, `\nSpawn failed: ${err.message}\n`);
      sendActive({ type: "run_failed", request_id: requestId, error: err.message, code: "SPAWN_ERROR" });
    }
  });
}

function handleQuickAction(state: ClientState, action: string, requestId: string): void {
  logger.info("Quick action", { action, requestId });

  switch (action) {
    case "continue":
      runClaude(state, "Continue from where you left off.", requestId);
      break;
    case "run_tests":
      runClaude(state, "Run the project's test suite, summarize failures, and fix them if safe.", requestId);
      break;
    case "git_diff":
      runGitDiff(appConfig.projectDir).then((diff) => {
        sendActiveTerm(state, `\n${diff.stats}\n\n${diff.diff.slice(0, 8000)}\n`);
      }).catch((err) => {
        sendActiveError(`Git diff failed: ${err instanceof Error ? err.message : String(err)}`);
      });
      break;
    case "explain_error":
      if (!state.lastError) {
        sendActiveError("No previous error to explain.");
      } else {
        runClaude(
          state,
          `The last command produced this error:\n\n${state.lastError}\n\nExplain what went wrong and propose the smallest safe fix.`,
          requestId
        );
      }
      break;
    case "commit":
      handleCommitAction(state, requestId);
      break;
    case "revert":
      handleRevertAction(state, requestId);
      break;
    default:
      sendActiveError(`Unknown quick action: ${action}`);
  }
}

function handleCommitAction(state: ClientState, requestId: string): void {
  runCommit(appConfig.projectDir).then((result) => {
    if (result.needsConfirmation) {
      const actionId = uuidv4();
      sendActive({
        type: "confirmation_required",
        action_id: actionId,
        request_id: requestId,
        prompt: "Commit changes?",
        details: `Files:\n${(result.files || []).join("\n")}\n\n${result.diff?.slice(0, 3000) || ""}`,
      });
      state.pendingConfirmation = {
        actionId,
        resolve: (approved: boolean) => {
          state.pendingConfirmation = null;
          if (approved) {
            runCommit(appConfig.projectDir, true).then((r) => {
              sendActiveTerm(state, `\n${r.commitMessage || "Committed."}\n`);
            }).catch((err) => {
              sendActiveError(`Commit failed: ${err instanceof Error ? err.message : String(err)}`);
            });
          } else {
            sendActiveTerm(state, "\nCommit cancelled.\n");
          }
        },
        timer: setTimeout(() => {
          if (state.pendingConfirmation?.actionId === actionId) {
            state.pendingConfirmation.resolve(false);
            sendActiveError("Confirmation timed out.");
          }
        }, CONFIRMATION_TIMEOUT_MS),
      };
    } else if (result.committed) {
      sendActiveTerm(state, `\n${result.commitMessage || "Committed."}\n`);
    } else {
      sendActiveError(result.error || "Nothing to commit.");
    }
  }).catch((err) => {
    sendActiveError(`Commit failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}

function handleRevertAction(state: ClientState, requestId: string): void {
  runRevert(appConfig.projectDir).then((result) => {
    if (result.needsConfirmation) {
      const actionId = uuidv4();
      sendActive({
        type: "confirmation_required",
        action_id: actionId,
        request_id: requestId,
        prompt: "Revert all uncommitted changes?",
        details: `Files:\n${(result.files || []).join("\n")}\n\n${result.diff?.slice(0, 3000) || ""}`,
      });
      state.pendingConfirmation = {
        actionId,
        resolve: (approved: boolean) => {
          state.pendingConfirmation = null;
          if (approved) {
            runRevert(appConfig.projectDir, true).then((r) => {
              sendActiveTerm(state, `\n${r.message || "Reverted."}\n`);
            }).catch((err) => {
              sendActiveError(`Revert failed: ${err instanceof Error ? err.message : String(err)}`);
            });
          } else {
            sendActiveTerm(state, "\nRevert cancelled.\n");
          }
        },
        timer: setTimeout(() => {
          if (state.pendingConfirmation?.actionId === actionId) {
            state.pendingConfirmation.resolve(false);
            sendActiveError("Confirmation timed out.");
          }
        }, CONFIRMATION_TIMEOUT_MS),
      };
    }
  }).catch((err) => {
    sendActiveError(`Revert failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}

export function handleConnection(ws: WebSocket): void {
  const state = session;
  let authenticated = false;
  clients.set(ws, state);
  logger.info("Client connected", { total: clients.size });

  ws.on("message", (raw) => {
    const rawStr = raw.toString().trim();
    if (!rawStr) return;

    let data: unknown;
    try {
      data = JSON.parse(rawStr);
    } catch {
      return;
    }

    const message = parseClientMessage(data);
    if (!message) {
      logger.debug("Unknown message format", { raw: rawStr.slice(0, 200) });
      return;
    }

    if (message.type === "auth") {
      if (message.token === appConfig.remoteToken) {
        authenticated = true;
        attachClient(ws, state);
        logger.info("Client authenticated");
        send(ws, { type: "auth_ok", session: serverSessionId, server_version: "1.0.0", model: appConfig.model });
        send(ws, { type: "term", text: `\x1b[1mConnected\x1b[0m  model: ${appConfig.model}  cwd: ${appConfig.projectDir}\n\n` });
        replaySession(ws, state);
      } else {
        logger.warn("Auth failed");
        send(ws, { type: "auth_error", message: "Invalid token" });
      }
      return;
    }

    if (!authenticated) {
      send(ws, { type: "server_error", message: "Not authenticated." });
      return;
    }

    switch (message.type) {
      case "prompt": {
        const scan = scanPrompt(message.text);
        if (!scan.safe) {
          sendActiveError(`Blocked: ${scan.reason}`);
          return;
        }
        runClaude(state, message.text, message.request_id);
        break;
      }
      case "stop": {
        const runId = state.currentRunId;
        if (state.currentProcess) {
          killRun(state, "user_requested");
          sendActive({ type: "run_stopped", request_id: runId || state.currentRequestId || "unknown", reason: "user_requested" });
          sendActiveTerm(state, "\nStopped\n");
        }
        break;
      }
      case "quick_action":
        handleQuickAction(state, message.action, message.request_id);
        break;
      case "confirm_action":
        if (state.pendingConfirmation?.actionId === message.action_id) {
          clearTimeout(state.pendingConfirmation.timer);
          state.pendingConfirmation.resolve(message.approved);
        } else {
          sendActiveError("No matching confirmation.");
        }
        break;
      case "get_status":
        send(ws, {
          type: "status",
          connected: true,
          running: !!state.currentProcess,
          run_id: state.currentRunId,
          cwd: appConfig.projectDir,
          model: appConfig.model,
        });
        break;
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    if (activeWs === ws) {
      activeWs = null;
      if (state.currentProcess) {
        logger.info("Client disconnected during active run; run continues", {
          runId: state.currentRunId,
        });
      }
      cleanupPendingConfirmation(state);
    }
    logger.info("Client disconnected", { total: clients.size });
  });

  ws.on("error", (err) => {
    logger.error("WebSocket error", { error: err.message });
  });
}
