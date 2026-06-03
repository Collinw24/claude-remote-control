import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_BACKEND_URL,
  normalizeBackendUrl,
  validateBackendUrl,
} from "./connection";

test("defaults to the current Tailscale server URL", () => {
  assert.equal(DEFAULT_BACKEND_URL, "ws://100.81.211.88:3001");
});

test("normalizes bare host and host:port values to ws URLs", () => {
  assert.equal(normalizeBackendUrl("100.81.211.88"), "ws://100.81.211.88:3001");
  assert.equal(normalizeBackendUrl("100.81.211.88:3002"), "ws://100.81.211.88:3002");
});

test("preserves websocket schemes and trims whitespace", () => {
  assert.equal(normalizeBackendUrl("  ws://100.81.211.88:3001  "), "ws://100.81.211.88:3001");
  assert.equal(normalizeBackendUrl("wss://desktop.example.ts.net"), "wss://desktop.example.ts.net");
});

test("converts pasted http URLs to websocket URLs", () => {
  assert.equal(normalizeBackendUrl("http://100.81.211.88:3001"), "ws://100.81.211.88:3001");
  assert.equal(normalizeBackendUrl("https://desktop.example.ts.net"), "wss://desktop.example.ts.net");
});

test("rejects unsupported or empty backend URLs", () => {
  assert.equal(validateBackendUrl(""), "Backend URL is required.");
  assert.equal(validateBackendUrl("ftp://100.81.211.88:3001"), "Use a ws:// or wss:// backend URL.");
  assert.equal(validateBackendUrl("ws://"), "Backend URL is invalid.");
});
