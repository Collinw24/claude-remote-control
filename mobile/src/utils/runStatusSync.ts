import type { RunStatus } from "../types";

interface ServerStatusInput {
  running: boolean;
  runId: string | null;
}

interface SyncedRunState {
  runStatus: RunStatus;
  runId: string | null;
}

export function getRunStatusFromServerStatus({ running, runId }: ServerStatusInput): SyncedRunState {
  return {
    runStatus: running ? "running" : "idle",
    runId: running ? runId : null,
  };
}
