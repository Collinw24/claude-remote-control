import assert from "node:assert/strict";
import test from "node:test";
import { getPromptBottomInset } from "./keyboardLayout";

test("uses safe area inset when keyboard is closed", () => {
  assert.equal(getPromptBottomInset({ keyboardHeight: 0, safeAreaBottom: 24 }), 34);
  assert.equal(getPromptBottomInset({ keyboardHeight: 0, safeAreaBottom: 0 }), 10);
});

test("uses keyboard height when keyboard is open", () => {
  assert.equal(getPromptBottomInset({ keyboardHeight: 312, safeAreaBottom: 24 }), 322);
});

test("clamps negative keyboard heights", () => {
  assert.equal(getPromptBottomInset({ keyboardHeight: -20, safeAreaBottom: 24 }), 34);
});
