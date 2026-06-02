import { z } from "zod";

// ── Client → Server messages ──

export const AuthMessage = z.object({
  type: z.literal("auth"),
  token: z.string().min(1, "Token is required"),
});

export const PromptMessage = z.object({
  type: z.literal("prompt"),
  text: z.string().min(1, "Prompt text is required"),
  request_id: z.string().uuid(),
});

export const QuickActionMessage = z.object({
  type: z.literal("quick_action"),
  action: z.enum([
    "continue",
    "run_tests",
    "git_diff",
    "explain_error",
    "commit",
    "revert",
  ]),
  request_id: z.string().uuid(),
});

export const StopMessage = z.object({
  type: z.literal("stop"),
});

export const ConfirmActionMessage = z.object({
  type: z.literal("confirm_action"),
  action_id: z.string(),
  approved: z.boolean(),
});

export const GetStatusMessage = z.object({
  type: z.literal("get_status"),
});

export const ClientMessage = z.discriminatedUnion("type", [
  AuthMessage,
  PromptMessage,
  QuickActionMessage,
  StopMessage,
  ConfirmActionMessage,
  GetStatusMessage,
]);

export type ClientMessageType = z.infer<typeof ClientMessage>;

// ── Server → Client messages ──

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

export type ServerMessage =
  | AuthOkMessage
  | AuthErrorMessage
  | StatusMessage
  | RunStartedMessage
  | AgentOutputMessage
  | AgentErrorMessage
  | RunCompletedMessage
  | RunStoppedMessage
  | RunFailedMessage
  | ConfirmationRequiredMessage
  | GitDiffMessage
  | ServerErrorMessage;

/** Validate an incoming client message. Returns parsed message or null. */
export function parseClientMessage(data: unknown): ClientMessageType | null {
  const result = ClientMessage.safeParse(data);
  if (result.success) return result.data;
  return null;
}
