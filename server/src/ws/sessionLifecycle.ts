export const REATTACH_GRACE_MS = 5 * 60_000;
export const TERM_BUFFER_MAX_CHARS = 200_000;

export interface TermBufferState {
  termBuffer: string[];
  termBufferChars: number;
}

export function getDisconnectAction({ hasCurrentProcess }: { hasCurrentProcess: boolean }): "detach" | "cleanup" {
  return hasCurrentProcess ? "detach" : "cleanup";
}

export function appendBufferedTerm(
  state: TermBufferState,
  text: string,
  maxChars = TERM_BUFFER_MAX_CHARS
): void {
  state.termBuffer.push(text);
  state.termBufferChars += text.length;

  while (state.termBufferChars > maxChars && state.termBuffer.length > 0) {
    const removed = state.termBuffer.shift() || "";
    state.termBufferChars -= removed.length;
  }
}
