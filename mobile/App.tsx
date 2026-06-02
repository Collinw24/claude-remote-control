import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  StatusBar,
} from "react-native";
import { useWebSocket } from "./src/hooks/useWebSocket";
import { useAppStore } from "./src/state/store";

const CMDS: Record<string, string> = {
  "/diff": "git diff",
  "/commit": "commit staged",
  "/revert": "revert changes",
  "/tests": "run tests",
  "/explain": "explain error",
  "/continue": "continue",
};

export default function App() {
  const { connect, disconnect } = useWebSocket();
  const [input, setInput] = useState("");
  const [showConn, setShowConn] = useState(true);
  const scrollRef = useRef<ScrollView>(null);

  const backendUrl = useAppStore((s) => s.backendUrl);
  const setBackendUrl = useAppStore((s) => s.setBackendUrl);
  const token = useAppStore((s) => s.token);
  const setToken = useAppStore((s) => s.setToken);
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const runStatus = useAppStore((s) => s.runStatus);
  const messages = useAppStore((s) => s.messages);
  const pendingConfirmation = useAppStore((s) => s.pendingConfirmation);
  const setPendingConfirmation = useAppStore((s) => s.setPendingConfirmation);
  const sendMessage = useAppStore((s) => s.sendMessage);

  const isConnected = connectionStatus === "connected";
  const isRunning = runStatus === "running";

  useEffect(() => {
    if (scrollRef.current) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50);
    }
  }, [messages.length]);

  useEffect(() => {
    if (isConnected) setShowConn(false);
  }, [isConnected]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !sendMessage) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (text.startsWith("/")) {
      const action = mapCommand(text);
      if (action) {
        sendMessage({ type: "quick_action", action, request_id: id });
        setInput("");
        return;
      }
    }

    sendMessage({ type: "prompt", text, request_id: id });
    setInput("");
  }, [input, sendMessage]);

  const handleStop = useCallback(() => {
    if (sendMessage) sendMessage({ type: "stop" });
  }, [sendMessage]);

  const handleConfirm = useCallback(
    (approved: boolean) => {
      if (sendMessage && pendingConfirmation) {
        sendMessage({ type: "confirm_action", action_id: pendingConfirmation.actionId, approved });
      }
      setPendingConfirmation(null);
    },
    [sendMessage, pendingConfirmation, setPendingConfirmation]
  );

  // Derive project name from cwd
  const projectName = "wdfabrik";

  return (
    <View style={S.shell}>
      <StatusBar barStyle="light-content" backgroundColor="#0d1117" />

      {/* ── Header ── */}
      <View style={S.header}>
        <View style={S.headerLeft}>
          <Text style={S.headerDot}>{isConnected ? "●" : "○"}</Text>
          <Text style={S.headerText}>
            {isConnected ? `claude  ·  ${projectName}` : "claude  ·  disconnected"}
          </Text>
        </View>
        <View style={S.headerRight}>
          {isRunning && <Text style={S.headerRunning}>⏺ running</Text>}
          {!isConnected ? (
            <TouchableOpacity onPress={connect}>
              <Text style={S.headerAction}>/connect</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={disconnect}>
              <Text style={[S.headerAction, { color: "#f85149" }]}>/disconnect</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Connection panel (collapsible) ── */}
      {showConn && !isConnected && (
        <View style={S.connPanel}>
          <Text style={S.connLabel}>backend</Text>
          <TextInput
            style={S.connInput}
            value={backendUrl}
            onChangeText={setBackendUrl}
            placeholder="ws://127.0.0.1:3001"
            placeholderTextColor="#30363d"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={S.connLabel}>token</Text>
          <TextInput
            style={[S.connInput, { flex: 0.7 }]}
            value={token}
            onChangeText={setToken}
            placeholder="····"
            placeholderTextColor="#30363d"
            secureTextEntry
            autoCapitalize="none"
          />
        </View>
      )}

      {/* ── Conversation ── */}
      <ScrollView ref={scrollRef} style={S.body} contentContainerStyle={S.bodyInner}>
        {messages.length === 0 ? (
          <View style={S.placeholder}>
            <Text style={S.placeholderLine}>claude code v1.0.0</Text>
            <Text style={S.placeholderLine}>model: deepseek-v4-pro</Text>
            <Text style={S.placeholderLine}>cwd: ~/documents/claude/WDFabrik</Text>
            <Text style={S.placeholderMuted}>
              {isConnected
                ? "\ntype a prompt to begin"
                : "\nenter backend url and token, then /connect"}
            </Text>
            <View style={S.cmdList}>
              {Object.entries(CMDS).map(([cmd, desc]) => (
                <Text key={cmd} style={S.cmdItem}>
                  {"  "}{cmd}  — {desc}
                </Text>
              ))}
            </View>
          </View>
        ) : (
          messages.map((m) => (
            <Text key={m.id} style={msgStyle(m)}>
              {m.type === "term" ? stripAnsi(m.content) : m.content}
            </Text>
          ))
        )}

        {/* Confirmation dialog */}
        {pendingConfirmation && (
          <View style={S.confirm}>
            <Text style={S.confirmTitle}>⚠ {pendingConfirmation.prompt}</Text>
            <Text style={S.confirmBody}>{pendingConfirmation.details.slice(0, 500)}</Text>
            <View style={S.confirmRow}>
              <TouchableOpacity onPress={() => handleConfirm(true)}>
                <Text style={S.confirmYes}>Yes</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleConfirm(false)}>
                <Text style={S.confirmNo}>No</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {/* ── Prompt ── */}
      <View style={S.footer}>
        <View style={S.promptRow}>
          <Text style={S.prompt}>{">"}</Text>
          <TextInput
            style={S.promptInput}
            value={input}
            onChangeText={setInput}
            placeholder={isConnected ? "send a message (enter)" : ""}
            placeholderTextColor="#30363d"
            autoCapitalize="none"
            autoCorrect={false}
            editable={isConnected && !isRunning}
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
          />
          {isRunning && (
            <TouchableOpacity onPress={handleStop} style={S.stopBtn}>
              <Text style={S.stopText}>⏹</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

// ── helpers ──

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]0;.*?\x07/g, "");
}

function mapCommand(text: string): string | null {
  const t = text.toLowerCase().trim();
  if (t.startsWith("/diff")) return "git_diff";
  if (t.startsWith("/commit")) return "commit";
  if (t.startsWith("/revert")) return "revert";
  if (t.startsWith("/tests")) return "run_tests";
  if (t.startsWith("/explain")) return "explain_error";
  if (t.startsWith("/continue")) return "continue";
  return null;
}

function msgStyle(m: { type: string; isError?: boolean }): object {
  const base = { fontFamily: "monospace", fontSize: 13, lineHeight: 20, marginBottom: 1 } as const;
  switch (m.type) {
    case "term":
      return { ...base, color: "#c9d1d9" };
    case "system":
      return { ...base, color: "#58a6ff", fontWeight: "600" as const };
    case "thinking":
      return { ...base, color: "#484f58", fontStyle: "italic" as const };
    case "tool_use":
      return { ...base, color: "#7ee787" };
    case "tool_result":
      return { ...base, color: m.isError ? "#f85149" : "#8b949e", paddingLeft: 16 };
    case "error":
      return { ...base, color: "#f85149" };
    case "text":
    default:
      return { ...base, color: "#c9d1d9" };
  }
}

// ── styles ──

const S = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: "#0d1117",
    paddingHorizontal: 0,
    paddingTop: 0,
  },

  // header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#161b22",
    borderBottomWidth: 1,
    borderBottomColor: "#21262d",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerDot: {
    color: "#3fb950",
    fontSize: 10,
  },
  headerText: {
    color: "#8b949e",
    fontFamily: "monospace",
    fontSize: 12,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerRunning: {
    color: "#d29922",
    fontFamily: "monospace",
    fontSize: 11,
  },
  headerAction: {
    color: "#58a6ff",
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "600",
  },

  // connection panel
  connPanel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#161b22",
    borderBottomWidth: 1,
    borderBottomColor: "#21262d",
  },
  connLabel: {
    color: "#8b949e",
    fontFamily: "monospace",
    fontSize: 11,
  },
  connInput: {
    flex: 1,
    backgroundColor: "#0d1117",
    color: "#c9d1d9",
    fontFamily: "monospace",
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#30363d",
    borderRadius: 6,
  },

  // body
  body: {
    flex: 1,
    paddingHorizontal: 16,
  },
  bodyInner: {
    paddingTop: 12,
    paddingBottom: 16,
  },

  // placeholder
  placeholder: {
    paddingTop: 4,
  },
  placeholderLine: {
    color: "#8b949e",
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 20,
  },
  placeholderMuted: {
    color: "#484f58",
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 20,
  },
  cmdList: {
    marginTop: 12,
  },
  cmdItem: {
    color: "#30363d",
    fontFamily: "monospace",
    fontSize: 11,
    lineHeight: 18,
  },

  // confirmation
  confirm: {
    marginTop: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#d29922",
    borderRadius: 6,
    backgroundColor: "#161b22",
  },
  confirmTitle: {
    color: "#d29922",
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
  },
  confirmBody: {
    color: "#8b949e",
    fontFamily: "monospace",
    fontSize: 11,
    marginBottom: 10,
    lineHeight: 16,
  },
  confirmRow: {
    flexDirection: "row",
    gap: 16,
  },
  confirmYes: {
    color: "#3fb950",
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "700",
  },
  confirmNo: {
    color: "#f85149",
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "700",
  },

  // footer / prompt
  footer: {
    borderTopWidth: 1,
    borderTopColor: "#21262d",
    backgroundColor: "#161b22",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  promptRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  prompt: {
    color: "#58a6ff",
    fontFamily: "monospace",
    fontSize: 15,
    fontWeight: "600",
  },
  promptInput: {
    flex: 1,
    color: "#c9d1d9",
    fontFamily: "monospace",
    fontSize: 13,
    paddingVertical: 6,
    paddingHorizontal: 0,
  },
  stopBtn: {
    backgroundColor: "#da3633",
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  stopText: {
    color: "#fff",
    fontSize: 12,
  },
});
