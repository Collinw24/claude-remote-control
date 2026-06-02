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
  "/diff": "Show git diff",
  "/commit": "Commit staged changes",
  "/revert": "Revert uncommitted changes",
  "/tests": "Run test suite",
  "/explain": "Explain last error",
  "/continue": "Continue from where you left off",
};

export default function App() {
  const { connect, disconnect } = useWebSocket();
  const [input, setInput] = useState("");
  const [showConn, setShowConn] = useState(true);
  const scrollRef = useRef<ScrollView>(null);

  // Use Zustand store directly for URL/token so useWebSocket reads them
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
  const addMessage = useAppStore((s) => s.addMessage);

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

  // ── send prompt or slash command ──

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !sendMessage) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Slash commands
    if (text.startsWith("/")) {
      const action = mapCommand(text);
      if (action) {
        addMessage({ timestamp: new Date().toISOString(), type: "system", content: `> ${text}` });
        sendMessage({ type: "quick_action", action, request_id: id });
        setInput("");
        return;
      }
    }

    // Normal prompt
    addMessage({ timestamp: new Date().toISOString(), type: "system", content: `> ${text}` });
    sendMessage({ type: "prompt", text, request_id: id });
    setInput("");
  }, [input, sendMessage, addMessage]);

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

  // ── render ──

  const statusDot = isConnected ? "●" : "○";
  const statusColor = isConnected ? "#0f0" : "#f00";
  const runningTag = isRunning ? " ⚡" : runStatus === "completed" ? " ✓" : runStatus === "failed" ? " ✗" : "";

  return (
    <View style={S.term}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* ── top bar ── */}
      <View style={S.topBar}>
        <TouchableOpacity onPress={() => setShowConn(!showConn)}>
          <Text style={{ color: statusColor, fontFamily: "monospace", fontSize: 11 }}>
            {statusDot}{runningTag} {isConnected ? "claude-remote" : "disconnected"}
          </Text>
        </TouchableOpacity>
        {!isConnected ? (
          <TouchableOpacity onPress={connect}>
            <Text style={[S.topBtn, { color: "#0f0" }]}>/connect</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={disconnect}>
            <Text style={[S.topBtn, { color: "#f00" }]}>/disconnect</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── connection config ── */}
      {showConn && !isConnected && (
        <View style={S.connPanel}>
          <Text style={S.label}>url</Text>
          <TextInput
            style={S.connInput}
            value={backendUrl}
            onChangeText={setBackendUrl}
            placeholder="ws://127.0.0.1:3001"
            placeholderTextColor="#333"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={S.label}>token</Text>
          <TextInput
            style={[S.connInput, { width: 160 }]}
            value={token}
            onChangeText={setToken}
            placeholder="..."
            placeholderTextColor="#333"
            secureTextEntry
            autoCapitalize="none"
          />
        </View>
      )}

      {/* ── conversation ── */}
      <ScrollView ref={scrollRef} style={S.convo} contentContainerStyle={S.convoInner}>
        {messages.length === 0 ? (
          <View>
            <Text style={S.muted}>
              {isConnected
                ? "● Connected. Type a prompt or /command.\n"
                : "○ Disconnected. Enter URL and token, then /connect.\n"}
            </Text>
            <Text style={S.muted}>
              {"\n"}Available commands:{'\n'}
              {Object.entries(CMDS).map(([cmd, desc]) => (
                <Text key={cmd} style={S.muted}>
                  {"  "}{cmd}  — {desc}{'\n'}
                </Text>
              ))}
            </Text>
          </View>
        ) : (
          messages.map((m) => (
            <Text key={m.id} style={msgStyle(m)}>
              {m.type === "term" ? stripAnsi(m.content) : m.content}
            </Text>
          ))
        )}

        {/* running indicator */}
        {isRunning && (
          <Text style={{ color: "#0f0", fontFamily: "monospace", fontSize: 12, marginTop: 4 }}>
            ⚡ Thinking...
          </Text>
        )}

        {/* confirmation */}
        {pendingConfirmation && (
          <View style={S.confirm}>
            <Text style={{ color: "#ff0", fontFamily: "monospace", fontSize: 12, marginBottom: 4 }}>
              ⚠ {pendingConfirmation.prompt}
            </Text>
            <Text style={{ color: "#888", fontFamily: "monospace", fontSize: 11, marginBottom: 8 }}>
              {pendingConfirmation.details.slice(0, 500)}
            </Text>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <TouchableOpacity onPress={() => handleConfirm(true)}>
                <Text style={{ color: "#0f0", fontFamily: "monospace", fontSize: 12, fontWeight: "bold" }}>Allow</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleConfirm(false)}>
                <Text style={{ color: "#f00", fontFamily: "monospace", fontSize: 12, fontWeight: "bold" }}>Deny</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {/* ── prompt line ── */}
      <View style={S.promptRow}>
        <Text style={S.prompt}>{">"}</Text>
        <TextInput
          style={S.promptInput}
          value={input}
          onChangeText={setInput}
          placeholder={isConnected ? "Send a message (Enter to send)" : ""}
          placeholderTextColor="#333"
          autoCapitalize="none"
          autoCorrect={false}
          editable={isConnected && !isRunning}
          onSubmitEditing={handleSend}
          blurOnSubmit={false}
        />
        {isRunning && (
          <TouchableOpacity onPress={handleStop} style={S.stopBtn}>
            <Text style={{ color: "#fff", fontFamily: "monospace", fontSize: 10 }}>⏹ STOP</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── slash command hints ── */}
      <View style={S.hintRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {Object.keys(CMDS).map((cmd) => (
            <TouchableOpacity
              key={cmd}
              onPress={() => {
                if (isConnected && !isRunning) setInput(cmd + " ");
              }}
            >
              <Text style={S.hint}>{cmd} </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

// ── slash command → quick_action mapping ──

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

// ── ANSI strip ──

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]0;.*?\x07/g, "");
}

// ── message colors ──

function msgStyle(m: { type: string; isError?: boolean }): object {
  const base = { fontFamily: "monospace", fontSize: 13, lineHeight: 19, marginBottom: 1 } as const;
  switch (m.type) {
    case "term":
      return { ...base, color: "#0f0" };
    case "system":
      return { ...base, color: "#ff0", fontWeight: "bold" as const };
    case "thinking":
      return { ...base, color: "#555", fontStyle: "italic" as const };
    case "tool_use":
      return { ...base, color: "#0af" };
    case "tool_result":
      return { ...base, color: m.isError ? "#f44" : "#0a0", marginLeft: 8 };
    case "error":
      return { ...base, color: "#f44" };
    case "text":
    default:
      return { ...base, color: "#ccc" };
  }
}

// ── styles ──

const S = StyleSheet.create({
  term: { flex: 1, backgroundColor: "#000", padding: 8 },

  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
    marginBottom: 6,
  },
  topBtn: {
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "bold",
  },

  connPanel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
    padding: 4,
    backgroundColor: "#0a0a0a",
  },
  label: { color: "#0f0", fontFamily: "monospace", fontSize: 11 },
  connInput: {
    backgroundColor: "#111",
    color: "#ccc",
    fontFamily: "monospace",
    fontSize: 11,
    padding: 4,
    borderWidth: 1,
    borderColor: "#333",
    flex: 1,
    minWidth: 120,
  },

  convo: { flex: 1, marginBottom: 4 },
  convoInner: { paddingBottom: 8 },

  muted: { color: "#555", fontFamily: "monospace", fontSize: 12, lineHeight: 18 },

  confirm: {
    borderWidth: 1,
    borderColor: "#f0a500",
    padding: 8,
    marginTop: 8,
  },

  promptRow: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#1a1a1a",
    paddingTop: 6,
    gap: 6,
  },
  prompt: {
    color: "#0f0",
    fontFamily: "monospace",
    fontSize: 15,
    fontWeight: "bold",
  },
  promptInput: {
    flex: 1,
    color: "#0f0",
    fontFamily: "monospace",
    fontSize: 13,
    padding: 6,
    backgroundColor: "#0a0a0a",
    borderRadius: 0,
  },
  stopBtn: {
    backgroundColor: "#c00",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 2,
  },

  hintRow: {
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: "#111",
  },
  hint: {
    color: "#333",
    fontFamily: "monospace",
    fontSize: 10,
    marginRight: 10,
  },
});
