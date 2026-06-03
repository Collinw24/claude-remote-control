// Mirror of server WebSocket message types

// ── Server → Client ──

export interface AuthOkMessage {
  type: "auth_ok";
  session: string;
  server_version: string;
  model: string;
}

export interface AuthErrorMessage {
  type: "auth_error";
  message: string;
}

export interface StatusMessage {
  type: "status";
  connected: boolean;
  running: boolean;
  run_id: string | null;
  cwd: string;
  model: string;
}

export interface RunStartedMessage {
  type: "run_started";
  request_id: string;
  run_id: string;
  session_id: string;
  timestamp: string;
}

export interface AgentOutputMessage {
  type: "agent_output";
  request_id: string;
  content_type: "thinking" | "text" | "tool_use" | "tool_result";
  content?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_id?: string;
  stdout?: string;
  stderr?: string;
  is_error?: boolean;
  timestamp: string;
}

export interface AgentErrorMessage {
  type: "agent_error";
  message: string;
  request_id?: string;
}

export interface RunCompletedMessage {
  type: "run_completed";
  request_id: string;
  result: string;
  num_turns: number;
  duration_ms: number;
  usage: unknown;
}

export interface RunStoppedMessage {
  type: "run_stopped";
  request_id: string;
  reason: "user_requested" | "guardrails";
}

export interface RunFailedMessage {
  type: "run_failed";
  request_id: string;
  error: string;
  code?: string;
}

export interface ConfirmationRequiredMessage {
  type: "confirmation_required";
  action_id: string;
  request_id: string;
  prompt: string;
  details: string;
}

export interface GitDiffMessage {
  type: "git_diff";
  request_id: string;
  diff: string;
  files: string[];
  stats: string;
}

export interface ServerErrorMessage {
  type: "server_error";
  message: string;
}

export interface TermMessage {
  type: "term";
  text: string;
}

export type ServerMessage =
  | AuthOkMessage
  | AuthErrorMessage
  | StatusMessage
  | TermMessage
  | RunStartedMessage
  | AgentOutputMessage
  | AgentErrorMessage
  | RunCompletedMessage
  | RunStoppedMessage
  | RunFailedMessage
  | ConfirmationRequiredMessage
  | GitDiffMessage
  | ServerErrorMessage;

// ── Client → Server ──

export interface AuthClientMessage {
  type: "auth";
  token: string;
}

export interface PromptClientMessage {
  type: "prompt";
  text: string;
  request_id: string;
}

export interface QuickActionClientMessage {
  type: "quick_action";
  action: "continue" | "run_tests" | "git_diff" | "explain_error" | "commit" | "revert";
  request_id: string;
}

export interface StopClientMessage {
  type: "stop";
}

export interface ConfirmActionClientMessage {
  type: "confirm_action";
  action_id: string;
  approved: boolean;
}

export interface GetStatusClientMessage {
  type: "get_status";
}

export type ClientMessage =
  | AuthClientMessage
  | PromptClientMessage
  | QuickActionClientMessage
  | StopClientMessage
  | ConfirmActionClientMessage
  | GetStatusClientMessage;

// ── UI types ──

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export type RunStatus = "idle" | "running" | "completed" | "stopped" | "failed";

export interface LogEntry {
  id: string;
  timestamp: string;
  type: "thinking" | "text" | "tool_use" | "tool_result" | "error" | "system" | "term";
  content: string;
  toolName?: string;
  isError?: boolean;
  sessionId?: string;
}

/** Mirror of desktop Claude Code's sessions-index entry.
 *  Each session represents one Claude conversation. */
export interface SessionRecord {
  id: string;            // run_id from run_started (matches Claude --session-id)
  name: string;          // auto-derived from first prompt text
  summary: string;       // updated on run_completed
  firstPrompt: string;   // the user's first message in this session
  messageCount: number;
  created: string;       // ISO timestamp
  modified: string;      // ISO timestamp
  messages: LogEntry[];  // capped at 200 per session
}
