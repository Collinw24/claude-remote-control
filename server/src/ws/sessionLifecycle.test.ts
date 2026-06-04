import assert from "node:assert/strict";
import test from "node:test";
import {
  appendBufferedTerm,
  type TermBufferState,
} from "./sessionLifecycle.js";

test("keeps only the newest terminal output within the replay buffer", () => {
  const state: TermBufferState = { termBuffer: [], termBufferChars: 0 };

  appendBufferedTerm(state, "abc", 8);
  appendBufferedTerm(state, "def", 8);
  appendBufferedTerm(state, "ghi", 8);

  assert.deepEqual(state.termBuffer, ["def", "ghi"]);
  assert.equal(state.termBufferChars, 6);
});
