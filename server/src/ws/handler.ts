import { WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import { appConfig } from "../config.js";
import { logger } from "../logger.js";
import { parseClientMessage, ServerMessage } from "./protocol.js";
import { spawnClaude, stopRun as killClaude } from "../claude/spawn.js";
import { scanPrompt } from "../claude/guardrails.js";
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
}

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
  };
}

// ── Send helpers ──

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function sendTerm(ws: WebSocket, text: string): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "term", text }));
  }
}

function sendError(ws: WebSocket, message: string): void {
  send(ws, { type: "server_error", message });
}

// ── Stop current run ──

function stopCurrentRun(state: ClientState, reason: "user_requested" | "guardrails"): void {
  if (!state.currentProcess) return;
  logger.info("Stopping run", { runId: state.currentRunId, reason });
  killClaude(state.currentProcess);
  state.currentProcess = null;
  state.currentRunId = null;
  state.runStartedAt = null;
}

// ── Run Claude (raw terminal mode) ──

function runClaude(ws: WebSocket, state: ClientState, prompt: string, requestId: string): void {
  stopCurrentRun(state, "user_requested");

  const runId = uuidv4();
  state.currentRunId = runId;
  state.currentRequestId = requestId;
  state.runStartedAt = Date.now();
  state.lastError = null;

  logger.info("Launching Claude", { runId, requestId, prompt: prompt.slice(0, 200) });

  sendTerm(ws, `\x1b[1m> ${prompt}\x1b[0m\n\n`);
  send(ws, { type: "run_started", request_id: requestId, run_id: runId, timestamp: new Date().toISOString() });

  const child = spawnClaude(prompt);
  state.currentProcess = child;

  // Pipe stdout directly to client as terminal output
  if (child.stdout) {
    child.stdout.on("data", (chunk: Buffer) => {
      sendTerm(ws, chunk.toString());
    });
  }

  // Pipe stderr — mark as dim/red in the terminal
  if (child.stderr) {
    child.stderr.on("data", (chunk: Buffer) => {
      state.lastError = chunk.toString();
      sendTerm(ws, `\x1b[2m${chunk.toString()}\x1b[0m`);
    });
  }

  // Process exit
  child.on("exit", (code) => {
    const duration = state.runStartedAt ? Date.now() - state.runStartedAt : 0;
    state.currentProcess = null;
    state.currentRunId = null;
    state.runStartedAt = null;

    if (code === 0 || code === null) {
      logger.info("Run completed", { runId, requestId, durationMs: duration });
      sendTerm(ws, `\n✓ Completed in ${(duration / 1000).toFixed(1)}s\n`);
      send(ws, { type: "run_completed", request_id: requestId, result: "", num_turns: 0, duration_ms: duration, usage: {} });
    } else {
      logger.error("Run failed", { runId, requestId, exitCode: code, durationMs: duration });
      sendTerm(ws, `\n✗ Exited with code ${code}\n`);
      send(ws, { type: "run_failed", request_id: requestId, error: `Exit code ${code}`, code: `EXIT_${code}` });
    }
  });

  child.on("error", (err) => {
    logger.error("Spawn error", { runId, error: err.message });
    if (state.currentProcess === child) {
      state.currentProcess = null;
      state.currentRunId = null;
      state.runStartedAt = null;
      sendTerm(ws, `\n✗ Spawn failed: ${err.message}\n`);
      send(ws, { type: "run_failed", request_id: requestId, error: err.message, code: "SPAWN_ERROR" });
    }
  });
}

// ── Quick actions ──

async function handleQuickAction(ws: WebSocket, state: ClientState, action: string, requestId: string): Promise<void> {
  logger.info("Quick action", { action, requestId });

  switch (action) {
    case "continue":
      runClaude(ws, state, "Continue from where you left off.", requestId);
      break;
    case "run_tests":
      runClaude(ws, state, "Run the project's test suite, summarize failures, and fix them if safe.", requestId);
      break;
    case "git_diff":
      try {
        const diff = await runGitDiff(appConfig.projectDir);
        sendTerm(ws, `\n${diff.stats}\n\n${diff.diff.slice(0, 8000)}\n`);
      } catch (err) {
        sendError(ws, `Git diff failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    case "explain_error":
      if (!state.lastError) {
        sendError(ws, "No previous error to explain.");
      } else {
        runClaude(ws, state, `The last command produced this error:\n\n${state.lastError}\n\nExplain what went wrong and propose the smallest safe fix.`, requestId);
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

async function handleCommitAction(ws: WebSocket, state: ClientState, requestId: string): Promise<void> {
  try {
    const result = await runCommit(appConfig.projectDir);
    if (result.needsConfirmation) {
      const actionId = uuidv4();
      send(ws, {
        type: "confirmation_required",
        action_id: actionId,
        request_id: requestId,
        prompt: "Commit changes?",
        details: `Files:\n${(result.files || []).join("\n")}\n\n${result.diff?.slice(0, 3000) || ""}`,
      });
      state.pendingConfirmation = {
        actionId,
        resolve: async (approved: boolean) => {
          state.pendingConfirmation = null;
          if (approved) {
            try {
              const r = await runCommit(appConfig.projectDir, true);
              sendTerm(ws, `\n${r.commitMessage || "Committed."}\n`);
            } catch (err) {
              sendError(ws, `Commit failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          } else {
            sendTerm(ws, "\nCommit cancelled.\n");
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
      sendTerm(ws, `\n${result.commitMessage || "Committed."}\n`);
    } else {
      sendError(ws, result.error || "Nothing to commit.");
    }
  } catch (err) {
    sendError(ws, `Commit failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleRevertAction(ws: WebSocket, state: ClientState, requestId: string): Promise<void> {
  if (!appConfig.allowDestructiveActions) {
    sendError(ws, "Revert disabled. Set ALLOW_DESTRUCTIVE_ACTIONS=true in .env");
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
        details: `Files:\n${(result.files || []).join("\n")}\n\n${result.diff?.slice(0, 3000) || ""}`,
      });
      state.pendingConfirmation = {
        actionId,
        resolve: async (approved: boolean) => {
          state.pendingConfirmation = null;
          if (approved) {
            try {
              const r = await runRevert(appConfig.projectDir, true);
              sendTerm(ws, `\n${r.message || "Reverted."}\n`);
            } catch (err) {
              sendError(ws, `Revert failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          } else {
            sendTerm(ws, "\nRevert cancelled.\n");
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
  logger.info("Client connected", { total: clients.size });

  ws.on("message", (raw) => {
    let data: unknown;
    try { data = JSON.parse(raw.toString()); } catch { sendError(ws, "Invalid JSON"); return; }

    const message = parseClientMessage(data);
    if (!message) { sendError(ws, "Invalid message format"); return; }

    if (message.type === "auth") {
      if (message.token === appConfig.remoteToken) {
        state.authenticated = true;
        logger.info("Client authenticated");
        send(ws, { type: "auth_ok", session: uuidv4(), server_version: "1.0.0", model: appConfig.model });
        sendTerm(ws, `\x1b[1m● Connected\x1b[0m  model: ${appConfig.model}  cwd: ${appConfig.projectDir}\n\n`);
      } else {
        logger.warn("Auth failed");
        send(ws, { type: "auth_error", message: "Invalid token" });
      }
      return;
    }

    if (!state.authenticated) { sendError(ws, "Not authenticated."); return; }

    switch (message.type) {
      case "prompt": {
        const scan = scanPrompt(message.text);
        if (!scan.safe) { sendError(ws, `Blocked: ${scan.reason}`); return; }
        runClaude(ws, state, message.text, message.request_id);
        break;
      }
      case "stop":
        if (state.currentProcess) {
          stopCurrentRun(state, "user_requested");
          send(ws, { type: "run_stopped", request_id: state.currentRequestId || "unknown", reason: "user_requested" });
          sendTerm(ws, "\n⏹ Stopped\n");
        }
        break;
      case "quick_action":
        handleQuickAction(ws, state, message.action, message.request_id);
        break;
      case "confirm_action":
        if (state.pendingConfirmation?.actionId === message.action_id) {
          clearTimeout(state.pendingConfirmation.timer);
          state.pendingConfirmation.resolve(message.approved);
        } else {
          sendError(ws, "No matching confirmation.");
        }
        break;
      case "get_status":
        break; // status is shown via term messages now
    }
  });

  ws.on("close", () => {
    if (state.currentProcess) stopCurrentRun(state, "user_requested");
    if (state.pendingConfirmation) { clearTimeout(state.pendingConfirmation.timer); state.pendingConfirmation.resolve(false); }
    clients.delete(ws);
    logger.info("Client disconnected", { total: clients.size });
  });

  ws.on("error", (err) => {
    logger.error("WebSocket error", { error: err.message });
    clients.delete(ws);
  });
}
