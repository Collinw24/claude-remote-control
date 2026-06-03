import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_BACKEND_URL } from "../utils/connection";
import type {
  ConnectionStatus,
  RunStatus,
  LogEntry,
} from "../types";

// Generate a simple unique ID (no uuid dependency needed on mobile)
let idCounter = 0;
function uid(): string {
  idCounter++;
  return `${Date.now()}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

interface PendingConfirmation {
  actionId: string;
  prompt: string;
  details: string;
}

interface AppState {
  // Connection
  backendUrl: string;
  setBackendUrl: (url: string) => void;
  token: string;
  setToken: (token: string) => void;
  connectionStatus: ConnectionStatus;
  setConnectionStatus: (status: ConnectionStatus) => void;

  // Run
  runStatus: RunStatus;
  setRunStatus: (status: RunStatus) => void;
  runId: string | null;
  setRunId: (id: string | null) => void;
  serverModel: string;
  setServerModel: (model: string) => void;

  // Output log
  messages: LogEntry[];
  addMessage: (entry: Omit<LogEntry, "id">) => string;
  removeMessage: (id: string) => void;
  clearMessages: () => void;

  // Confirmation dialog
  pendingConfirmation: PendingConfirmation | null;
  setPendingConfirmation: (conf: PendingConfirmation | null) => void;

  // Quick actions
  sendMessage: ((msg: Record<string, unknown>) => void) | null;
  setSendMessage: (fn: ((msg: Record<string, unknown>) => void) | null) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Connection
      backendUrl: DEFAULT_BACKEND_URL,
      setBackendUrl: (url) => set({ backendUrl: url }),
      token: "",
      setToken: (token) => set({ token }),
      connectionStatus: "disconnected",
      setConnectionStatus: (status) => set({ connectionStatus: status }),

      // Run
      runStatus: "idle",
      setRunStatus: (status) => set({ runStatus: status }),
      runId: null,
      setRunId: (id) => set({ runId: id }),
      serverModel: "",
      setServerModel: (model) => set({ serverModel: model }),

      // Output log
      messages: [],
      addMessage: (entry) => {
        const id = uid();
        set((s) => ({
          messages: [...s.messages, { ...entry, id }],
        }));
        return id;
      },
      removeMessage: (id) =>
        set((s) => ({
          messages: s.messages.filter((m) => m.id !== id),
        })),
      clearMessages: () => set({ messages: [] }),

      // Confirmation
      pendingConfirmation: null,
      setPendingConfirmation: (conf) => set({ pendingConfirmation: conf }),

      // Send
      sendMessage: null,
      setSendMessage: (fn) => set({ sendMessage: fn }),
    }),
    {
      name: "claude-remote-control",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        backendUrl: state.backendUrl,
        token: state.token,
      }),
    }
  )
);
