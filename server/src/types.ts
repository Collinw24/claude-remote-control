// Shared TypeScript types used across server modules

export interface SpawnOptions {
  model?: string;
  projectDir?: string;
  requestId: string;
}

/** Internal parsed event from Claude stream-json output */
export interface ParsedClaudeEvent {
  type: string;
  subtype?: string;
  message?: unknown;
  session_id?: string;
  model?: string;
  tools?: string[];
  content?: unknown[];
  result?: string;
  num_turns?: number;
  total_cost_usd?: number;
  usage?: unknown;
  errors?: unknown[];
  error?: string;
  [key: string]: unknown;
}

/** Internal tool_use content block */
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Internal tool_result content block */
export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: Array<{ type: "text"; text: string }>;
  is_error?: boolean;
}

/** Internal text content block */
export interface TextBlock {
  type: "text";
  text: string;
}

/** Internal thinking content block */
export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

export type ContentBlock = ToolUseBlock | ToolResultBlock | TextBlock | ThinkingBlock;
