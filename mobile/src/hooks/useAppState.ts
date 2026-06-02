import { useMemo } from "react";
import { useAppStore } from "../state/store";

/**
 * Convenience hook that provides derived state from the app store.
 * All heavy lifting is done in useWebSocket and useAppStore directly.
 */
export function useAppState() {
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const runStatus = useAppStore((s) => s.runStatus);
  const serverModel = useAppStore((s) => s.serverModel);
  const messages = useAppStore((s) => s.messages);
  const pendingConfirmation = useAppStore((s) => s.pendingConfirmation);
  const sendMessage = useAppStore((s) => s.sendMessage);

  return useMemo(
    () => ({
      connectionStatus,
      runStatus,
      serverModel,
      messages,
      pendingConfirmation,
      sendMessage,
      isConnected: connectionStatus === "connected",
      isConnecting: connectionStatus === "connecting",
      isDisconnected: connectionStatus === "disconnected",
      isRunning: runStatus === "running",
      isIdle: runStatus === "idle",
    }),
    [connectionStatus, runStatus, serverModel, messages, pendingConfirmation, sendMessage]
  );
}
