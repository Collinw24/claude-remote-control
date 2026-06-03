import assert from "node:assert/strict";
import test from "node:test";
import {
  getCloseCodeLabel,
  shouldReportConnectionLoss,
  shouldReconnectAfterClose,
  shouldUpdateConnectionStateAfterClose,
} from "./websocketLifecycle";

test("labels normal websocket close codes", () => {
  assert.equal(getCloseCodeLabel(1000), "NORMAL");
  assert.equal(getCloseCodeLabel(1001), "GOING_AWAY");
  assert.equal(getCloseCodeLabel(1006), "ABNORMAL");
  assert.equal(getCloseCodeLabel(4001), "code_4001");
});

test("does not report or reconnect after intentional normal closes", () => {
  assert.equal(shouldReportConnectionLoss({ code: 1000, intentional: true, replaced: false }), false);
  assert.equal(shouldReconnectAfterClose({ code: 1000, intentional: true, replaced: false }), false);
});

test("does not report or reconnect when an old socket is replaced", () => {
  assert.equal(shouldReportConnectionLoss({ code: 1000, intentional: false, replaced: true }), false);
  assert.equal(shouldReconnectAfterClose({ code: 1000, intentional: false, replaced: true }), false);
  assert.equal(shouldUpdateConnectionStateAfterClose({ code: 1000, intentional: false, replaced: true }), false);
});

test("reports and reconnects after abnormal unintentional closes", () => {
  assert.equal(shouldReportConnectionLoss({ code: 1006, intentional: false, replaced: false }), true);
  assert.equal(shouldReconnectAfterClose({ code: 1006, intentional: false, replaced: false }), true);
  assert.equal(shouldUpdateConnectionStateAfterClose({ code: 1006, intentional: false, replaced: false }), true);
});
