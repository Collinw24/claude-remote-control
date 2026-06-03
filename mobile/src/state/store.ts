import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_BACKEND_URL } from "../utils/connection";
import type {
  ConnectionStatus,
  RunStatus,
  LogEntry,
  SessionRecord,
} from "../types";

// ── Caps ──

/** Maximum number of messages per session persisted to AsyncStorage. */
const MAX_MESSAGES = 200;
/** Maximum number of sessions persisted. Oldest sessions are trimmed. */
const MAX_SESSIONS = 50;

// Generate a simple unique ID (no uuid dependency needed on mobile)
let idCounter = 0;
function uid(): string {
  idCounter++;
  return `${Date.now()}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function isoNow(): string {
  return new Date().toISOString();
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

  // Session tracking (persisted)
  sessions: SessionRecord[];
  activeSessionId: string | null;
  /** Derive messages from the active session for backward-compatible UI reads. */
  messages: LogEntry[];
  /** Last user prompt text — used to auto-name new sessions (not persisted). */
  lastPromptText: string;
  setLastPromptText: (text: string) => void;

  // Session operations
  /** Create a new session (or ensure one exists with this ID) and switch to it. */
  ensureSession: (id: string, firstPrompt: string) => void;
  /** Update session summary after a run completes. */
  completeSession: (id: string, summary: string) => void;
  /** Switch the active session by ID. */
  switchSession: (id: string) => void;
  /** Rename the active session (mirrors desktop `/rename-conversation`). */
  renameSession: (id: string, name: string) => void;
  /** Delete a session by ID. If it was active, switch to the most recent remaining. */
  deleteSession: (id: string) => void;

  // Output log (operates on the active session)
  addMessage: (entry: Omit<LogEntry, "id" | "sessionId">) => string;
  removeMessage: (id: string) => void;
  clearMessages: () => void;

  // Confirmation dialog
  pendingConfirmation: PendingConfirmation | null;
  setPendingConfirmation: (conf: PendingConfirmation | null) => void;

  // Quick actions
  sendMessage: ((msg: Record<string, unknown>) => void) | null;
  setSendMessage: (fn: ((msg: Record<string, unknown>) => void) | null) => void;
}

function autoName(firstPrompt: string): string {
  // Derive a session name from the first prompt, mirroring desktop Claude Code.
  const cleaned = firstPrompt.replace(/^[\/\s]+/, "").trim();
  if (!cleaned) return "Untitled session";
  if (cleaned.length <= 60) return cleaned;
  return cleaned.slice(0, 57) + "...";
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

      // Sessions
      sessions: [],
      activeSessionId: null,
      messages: [],
      lastPromptText: "",
      setLastPromptText: (text) => set({ lastPromptText: text }),

      ensureSession: (id, firstPrompt) =>
        set((s) => {
          const existing = s.sessions.find((ses) => ses.id === id);
          if (existing) {
            // Already have this session — just switch to it
            return {
              activeSessionId: id,
              messages: existing.messages,
            };
          }
          // Create a new session
          const now = isoNow();
          const newSession: SessionRecord = {
            id,
            name: autoName(firstPrompt),
            summary: "",
            firstPrompt,
            messageCount: 0,
            created: now,
            modified: now,
            messages: [],
          };
          let sessions = [...s.sessions, newSession];
          if (sessions.length > MAX_SESSIONS) {
            sessions = sessions.slice(sessions.length - MAX_SESSIONS);
          }
          return {
            sessions,
            activeSessionId: id,
            messages: [],
          };
        }),

      completeSession: (id, summary) =>
        set((s) => ({
          sessions: s.sessions.map((ses) =>
            ses.id === id
              ? { ...ses, summary, modified: isoNow() }
              : ses
          ),
        })),

      switchSession: (id) =>
        set((s) => {
          const session = s.sessions.find((ses) => ses.id === id);
          if (!session) return {};
          return {
            activeSessionId: id,
            messages: session.messages,
          };
        }),

      renameSession: (id, name) =>
        set((s) => ({
          sessions: s.sessions.map((ses) =>
            ses.id === id ? { ...ses, name } : ses
          ),
        })),

      deleteSession: (id) =>
        set((s) => {
          const sessions = s.sessions.filter((ses) => ses.id !== id);
          if (s.activeSessionId === id) {
            // Switch to the most recent remaining session, or clear
            const next = sessions.length > 0 ? sessions[sessions.length - 1] : null;
            return {
              sessions,
              activeSessionId: next?.id ?? null,
              messages: next?.messages ?? [],
            };
          }
          return { sessions };
        }),

      // Output log (operates on active session)
      addMessage: (entry) => {
        const id = uid();
        set((s) => {
          const sid = s.activeSessionId;
          if (!sid) {
            // No active session — create a transient unnamed one
            const fallbackId = `auto-${uid()}`;
            const now = isoNow();
            const fallback: SessionRecord = {
              id: fallbackId,
              name: "Untitled",
              summary: "",
              firstPrompt: "",
              messageCount: 1,
              created: now,
              modified: now,
              messages: [{ ...entry, id, sessionId: fallbackId }],
            };
            return {
              sessions: [...s.sessions, fallback],
              activeSessionId: fallbackId,
              messages: fallback.messages,
            };
          }

          const sessions = s.sessions.map((ses) => {
            if (ses.id !== sid) return ses;
            const stamped: LogEntry = { ...entry, id, sessionId: sid };
            let nextMessages = [...ses.messages, stamped];
            if (nextMessages.length > MAX_MESSAGES) {
              nextMessages = nextMessages.slice(nextMessages.length - MAX_MESSAGES);
            }
            return {
              ...ses,
              messages: nextMessages,
              messageCount: nextMessages.length,
              modified: isoNow(),
            };
          });

          const activeSession = sessions.find((ses) => ses.id === sid);
          return {
            sessions,
            messages: activeSession?.messages ?? [],
          };
        });
        return id;
      },

      removeMessage: (id) =>
        set((s) => {
          const sid = s.activeSessionId;
          if (!sid) return {};
          const sessions = s.sessions.map((ses) => {
            if (ses.id !== sid) return ses;
            const nextMessages = ses.messages.filter((m) => m.id !== id);
            return {
              ...ses,
              messages: nextMessages,
              messageCount: nextMessages.length,
            };
          });
          const activeSession = sessions.find((ses) => ses.id === sid);
          return {
            sessions,
            messages: activeSession?.messages ?? [],
          };
        }),

      clearMessages: () =>
        set((s) => {
          const sid = s.activeSessionId;
          if (!sid) return { messages: [] };
          const sessions = s.sessions.map((ses) =>
            ses.id === sid
              ? { ...ses, messages: [], messageCount: 0, modified: isoNow() }
              : ses
          );
          return { sessions, messages: [] };
        }),

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
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
      }),
      // After rehydration, derive messages from the active session
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.warn("[store] rehydration failed:", error);
          return;
        }
        if (!state) return;

        // Trim sessions
        if (state.sessions.length > MAX_SESSIONS) {
          state.sessions = state.sessions.slice(
            state.sessions.length - MAX_SESSIONS
          );
        }

        // Trim messages in each session
        for (const ses of state.sessions) {
          if (ses.messages.length > MAX_MESSAGES) {
            ses.messages = ses.messages.slice(
              ses.messages.length - MAX_MESSAGES
            );
            ses.messageCount = ses.messages.length;
          }
        }

        // Derive messages from active session
        if (state.activeSessionId) {
          const active = state.sessions.find(
            (s) => s.id === state.activeSessionId
          );
          state.messages = active?.messages ?? [];
        } else {
          state.messages = [];
        }
      },
    }
  )
);
