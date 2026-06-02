import { logger } from "../logger.js";
import type { ContentBlock } from "../types.js";

/**
 * Callbacks invoked by the stream-json parser for each event type.
 */
export interface ParserCallbacks {
  onThinking(text: string, timestamp: string): void;
  onText(text: string, timestamp: string): void;
  onToolUse(toolName: string, toolInput: Record<string, unknown>, toolId: string, timestamp: string): void;
  onToolResult(toolId: string, stdout: string | null, stderr: string | null, isError: boolean, timestamp: string): void;
  onError(message: string): void;
  onCompleted(result: string, numTurns: number, usage: unknown): void;
  onFailed(error: string, code?: string): void;
}

interface ParserState {
  currentAssistantContent: ContentBlock[];
  currentToolUse: { id: string; name: string; input: Record<string, unknown> } | null;
  turnCount: number;
}

/**
 * Create a stream-json line parser.
 *
 * Claude Code's --output-format stream-json produces one JSON object per line.
 * This parser handles the known message types and dispatches to the callbacks.
 *
 * Message types handled:
 *  - system/init          → session initialization
 *  - assistant            → thinking, text, tool_use content blocks
 *  - user                 → tool_result blocks
 *  - result/success       → final result
 *  - result/error         → error result
 *  - system/api_retry     → API retry notification
 */
export function createParser(callbacks: ParserCallbacks) {
  const state: ParserState = {
    currentAssistantContent: [],
    currentToolUse: null,
    turnCount: 0,
  };

  function now(): string {
    return new Date().toISOString();
  }

  function feed(line: string): void {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      // Non-JSON lines (rare) — treat as stderr/output
      callbacks.onError(line);
      return;
    }

    const type = event.type as string | undefined;
    const subtype = event.subtype as string | undefined;

    switch (type) {
      case "system": {
        if (subtype === "init") {
          logger.debug("Claude session initialized", {
            session_id: event.session_id,
            model: event.model,
          });
        }
        break;
      }

      case "assistant": {
        state.turnCount++;
        const content = event.content as unknown[] | undefined;
        if (!content) break;

        for (const block of content) {
          const c = block as Record<string, unknown>;
          switch (c.type) {
            case "thinking": {
              if (c.thinking) {
                callbacks.onThinking(String(c.thinking), now());
              }
              break;
            }
            case "text": {
              if (c.text) {
                callbacks.onText(String(c.text), now());
              }
              break;
            }
            case "tool_use": {
              callbacks.onToolUse(
                String(c.name || "unknown"),
                (c.input as Record<string, unknown>) || {},
                String(c.id || "unknown"),
                now()
              );
              break;
            }
          }
        }
        break;
      }

      case "user": {
        const userContent = event.content as unknown[] | undefined;
        if (!userContent) break;

        for (const block of userContent) {
          const c = block as Record<string, unknown>;
          if (c.type === "tool_result") {
            const toolContent = c.content as Array<{ type: string; text: string }> | undefined;
            let stdout = "";
            let stderr = "";
            if (toolContent) {
              for (const tc of toolContent) {
                if (tc.type === "text") {
                  stdout += tc.text;
                }
              }
            }
            // Check for is_error
            const isError = c.is_error === true;

            callbacks.onToolResult(
              String(c.tool_use_id || "unknown"),
              stdout || null,
              stderr || null,
              isError,
              now()
            );

            if (isError) {
              callbacks.onError(stdout || stderr || "Tool returned an error");
            }
          }
        }
        break;
      }

      case "result": {
        if (subtype === "success") {
          const resultText = typeof event.result === "string" ? event.result : "";
          const numTurns = typeof event.num_turns === "number" ? event.num_turns : state.turnCount;
          callbacks.onCompleted(resultText, numTurns, event.usage || {});
        } else if (subtype === "error") {
          const errors = event.errors as Array<{ message: string }> | undefined;
          const errorMsg = errors?.[0]?.message || event.error || "Unknown error";
          callbacks.onFailed(String(errorMsg), "RESULT_ERROR");
        }
        break;
      }

      default:
        // Unknown message type — log but don't fail
        logger.debug("Unhandled stream-json message type", { type, subtype });
        break;
    }
  }

  return { feed };
}
