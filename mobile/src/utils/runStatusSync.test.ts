import assert from "node:assert/strict";
import test from "node:test";
import { getRunStatusFromServerStatus } from "./runStatusSync";

test("marks the app running when server status has an active run", () => {
  assert.deepEqual(
    getRunStatusFromServerStatus({ running: true, runId: "run-1" }),
    { runStatus: "running", runId: "run-1" }
  );
});

test("unlocks the prompt when server status says no run is active", () => {
  assert.deepEqual(
    getRunStatusFromServerStatus({ running: false, runId: null }),
    { runStatus: "idle", runId: null }
  );
});
