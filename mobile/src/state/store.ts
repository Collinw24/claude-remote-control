import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_BACKEND_URL } from "../utils/connection";
import type {
  ConnectionStatus,
  RunStatus,
  LogEntry,
} from "../types";

// ── Caps ──

/** Maximum number of messages persisted to AsyncStorage. Older messages are
 *  trimmed when the limit is exceeded.  200 entries ≈ 100–200 KB. */
const MAX_MESSAGES = 200;

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

  // Session tracking (persisted so conversations are grouped)
  lastSessionId: string | null;
  setLastSessionId: (id: string | null) => void;

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

      // Session tracking
      lastSessionId: null,
      setLastSessionId: (id) => set({ lastSessionId: id }),

      // Output log
      messages: [],
      addMessage: (entry) => {
        const id = uid();
        set((s) => {
          const next = [...s.messages, { ...entry, id }];
          // Trim oldest messages when over the cap
          if (next.length > MAX_MESSAGES) {
            return { messages: next.slice(next.length - MAX_MESSAGES) };
          }
          return { messages: next };
        });
        return id;
      },
      removeMessage: (id) =>
        set((s) => ({
          messages: s.messages.filter((m) => m.id !== id),
        })),
      clearMessages: () => set({ messages: [], lastSessionId: null }),

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
        messages: state.messages,
        lastSessionId: state.lastSessionId,
      }),
      // Trim messages on rehydration (belt-and-suspenders)
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.warn("[store] rehydration failed:", error);
          return;
        }
        if (state && state.messages.length > MAX_MESSAGES) {
          state.messages = state.messages.slice(
            state.messages.length - MAX_MESSAGES
          );
        }
      },
    }
  )
);
