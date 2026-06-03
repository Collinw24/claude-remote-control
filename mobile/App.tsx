import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  StatusBar,
  FlatList,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
} from "react-native";
import { SafeAreaView, SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { useWebSocket } from "./src/hooks/useWebSocket";
import { useAppStore } from "./src/state/store";
import { getPromptBottomInset } from "./src/utils/keyboardLayout";

interface Command {
  cmd: string;
  desc: string;
  type: "quick_action" | "local" | "prompt";
  action?: string;
}

const COMMANDS: Command[] = [
  { cmd: "/diff",      desc: "Show working tree changes",       type: "quick_action", action: "git_diff" },
  { cmd: "/commit",    desc: "Commit staged changes",           type: "quick_action", action: "commit" },
  { cmd: "/revert",    desc: "Revert uncommitted changes",      type: "quick_action", action: "revert" },
  { cmd: "/tests",     desc: "Run test suite, fix failures",    type: "quick_action", action: "run_tests" },
  { cmd: "/explain",   desc: "Explain the last error",          type: "quick_action", action: "explain_error" },
  { cmd: "/continue",  desc: "Continue from where you left off", type: "quick_action", action: "continue" },
  { cmd: "/clear",     desc: "Clear the conversation",          type: "local" },
  { cmd: "/compact",   desc: "Compact context to save tokens",  type: "prompt", action: "/compact" },
  { cmd: "/config",    desc: "Show current configuration",      type: "prompt", action: "Show the current configuration and settings." },
  { cmd: "/cost",      desc: "Show token costs for this session", type: "prompt", action: "Show the token usage and cost summary." },
  { cmd: "/doctor",    desc: "Check Claude Code setup",         type: "prompt", action: "Run a diagnostic check — is everything configured correctly?" },
  { cmd: "/init",      desc: "Initialize project memory",       type: "prompt", action: "Initialize CLAUDE.md for this project." },
  { cmd: "/memory",    desc: "Edit project memory",             type: "prompt", action: "Open and edit the project memory files." },
  { cmd: "/model",     desc: "Show current AI model",           type: "local" },
  { cmd: "/pr-comment", desc: "Comment on a pull request",      type: "prompt", action: "Review and comment on this PR." },
  { cmd: "/review",    desc: "Review the current code",         type: "prompt", action: "Review the recent changes and provide feedback." },
  { cmd: "/status",    desc: "Show session status",             type: "local" },
  { cmd: "/upgrade",   desc: "Check for Claude Code updates",   type: "prompt", action: "Check if a newer version of Claude Code is available and what's new." },
  { cmd: "/help",      desc: "Show available commands",         type: "local" },
];

export default function App() {
  return (
    <SafeAreaProvider>
      <RemoteControlApp />
    </SafeAreaProvider>
  );
}

function RemoteControlApp() {
  const { connect, disconnect } = useWebSocket();
  const [input, setInput] = useState("");
  const [selectedCmdIdx, setSelectedCmdIdx] = useState(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();

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
  const footerBottomPadding = getPromptBottomInset({
    keyboardHeight,
    safeAreaBottom: insets.bottom,
  });

  // Auto-scroll when messages change
  useEffect(() => {
    if (scrollRef.current) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50);
    }
  }, [messages.length]);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Filtered command suggestions
  const showSuggestions = input.startsWith("/") && !input.includes(" ");
  const filteredCmds = useMemo(() => {
    if (!showSuggestions) return [];
    const q = input.toLowerCase().slice(1);
    return COMMANDS.filter((c) => c.cmd.toLowerCase().startsWith("/" + q));
  }, [input, showSuggestions]);

  useEffect(() => {
    setSelectedCmdIdx(0);
  }, [filteredCmds.length]);

  const clearMessages = useAppStore((s) => s.clearMessages);

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
      if (text === "/clear" || text.startsWith("/clear")) {
        clearMessages();
        setInput("");
        return;
      }
      if (text === "/status" || text.startsWith("/status")) {
        sendMessage({ type: "get_status" });
        setInput("");
        return;
      }
      if (text === "/model" || text.startsWith("/model")) {
        sendMessage({ type: "get_status" });
        setInput("");
        return;
      }
      if (text === "/help" || text.startsWith("/help")) {
        const helpText = COMMANDS.map((c) => `${c.cmd.padEnd(14)} ${c.desc}`).join("\n");
        sendMessage({ type: "prompt", text: `Available commands:\n${helpText}`, request_id: id });
        setInput("");
        return;
      }
    }

    sendMessage({ type: "prompt", text, request_id: id });
    setInput("");
  }, [input, sendMessage, clearMessages]);

  const handleConnect = useCallback(() => {
    if (backendUrl && token) connect();
  }, [backendUrl, token, connect]);

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

  const projectName = "claude";

  return (
    <SafeAreaView style={S.shell} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={S.keyboardAvoider}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
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
            <TouchableOpacity onPress={handleConnect}>
              <Text style={S.headerAction}>/connect</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={disconnect}>
              <Text style={[S.headerAction, { color: "#f85149" }]}>/disconnect</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Connection panel ── */}
      {!isConnected && (
        <View style={S.connPanel}>
          <Text style={S.connLabel}>backend</Text>
          <TextInput
            style={S.connInput}
            value={backendUrl}
            onChangeText={setBackendUrl}
            placeholder="ws://192.168.1.X:3001"
            placeholderTextColor="#30363d"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            blurOnSubmit={false}
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
            returnKeyType="go"
            onSubmitEditing={handleConnect}
          />
          <TouchableOpacity
            style={[S.connectBtn, (!backendUrl || !token) && { opacity: 0.5 }]}
            onPress={handleConnect}
            disabled={!backendUrl || !token}
          >
            <Text style={S.connectBtnText}>Connect</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Status bar ── */}
      <View style={S.statusBar}>
        <Text style={S.statusText}>
          {connectionStatus === "connected"
            ? "● connected"
            : connectionStatus === "connecting"
              ? "◌ connecting…"
              : "○ disconnected"}
        </Text>
        {connectionStatus === "connecting" && (
          <Text style={S.statusDetail}>WebSocket handshake to {backendUrl}</Text>
        )}
      </View>

      {/* ── Conversation ── */}
      <ScrollView
        ref={scrollRef}
        style={S.body}
        contentContainerStyle={S.bodyInner}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="interactive"
      >
        {messages.length === 0 ? (
          <View style={S.placeholder}>
            <Text style={S.placeholderLine}>claude code v1.0.0</Text>
            <Text style={S.placeholderLine}>model: deepseek-v4-pro</Text>
            <Text style={S.placeholderLine}>cwd: ~/documents/claude</Text>
            <Text style={S.placeholderMuted}>
              {isConnected
                ? "\ntype a prompt to begin"
                : "\nenter your PC's LAN IP and token, then Connect"}
            </Text>
            {!isConnected && (
              <Text style={[S.placeholderMuted, { color: "#58a6ff", marginTop: 8 }]}>
                Find your PC IP: open terminal → ipconfig → look for "IPv4 Address" under Wi-Fi
              </Text>
            )}
            <View style={S.cmdList}>
              {COMMANDS.map((c) => (
                <Text key={c.cmd} style={S.cmdItem}>
                  {"  "}{c.cmd.padEnd(14)} {c.desc}
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
      <View style={[S.footer, { paddingBottom: footerBottomPadding }]}>
        {showSuggestions && filteredCmds.length > 0 && (
          <View style={S.suggestPopup}>
            <FlatList
              data={filteredCmds}
              keyExtractor={(item) => item.cmd}
              keyboardShouldPersistTaps="always"
              style={S.suggestList}
              renderItem={({ item, index }) => {
                const isSelected = index === selectedCmdIdx;
                return (
                  <TouchableOpacity
                    style={[S.suggestItem, isSelected && S.suggestItemSelected]}
                    onPress={() => {
                      setInput(item.cmd + " ");
                      setSelectedCmdIdx(0);
                    }}
                  >
                    <Text style={S.suggestCmd}>{item.cmd}</Text>
                    <Text style={S.suggestDesc}>{item.desc}</Text>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        )}
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
            onKeyPress={({ nativeEvent }) => {
              if (nativeEvent.key === "ArrowDown" && filteredCmds.length > 0) {
                setSelectedCmdIdx((p) => Math.min(p + 1, filteredCmds.length - 1));
              } else if (nativeEvent.key === "ArrowUp" && filteredCmds.length > 0) {
                setSelectedCmdIdx((p) => Math.max(p - 1, 0));
              } else if (nativeEvent.key === "Tab" && filteredCmds.length > 0) {
                const pick = filteredCmds[selectedCmdIdx];
                if (pick) setInput(pick.cmd + " ");
              }
            }}
          />
          {isRunning && (
            <TouchableOpacity onPress={handleStop} style={S.stopBtn}>
              <Text style={S.stopText}>⏹</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

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

const S = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: "#0d1117",
  },
  keyboardAvoider: {
    flex: 1,
  },

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
  connectBtn: {
    backgroundColor: "#238636",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  connectBtnText: {
    color: "#ffffff",
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "700",
  },

  // status bar
  statusBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#0d1117",
    borderBottomWidth: 1,
    borderBottomColor: "#21262d",
    gap: 12,
  },
  statusText: {
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "600",
  },
  statusDetail: {
    color: "#8b949e",
    fontFamily: "monospace",
    fontSize: 10,
    flex: 1,
  },

  body: {
    flex: 1,
    paddingHorizontal: 16,
  },
  bodyInner: {
    paddingTop: 12,
    paddingBottom: 16,
  },

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

  suggestPopup: {
    backgroundColor: "#161b22",
    borderWidth: 1,
    borderColor: "#30363d",
    borderRadius: 8,
    marginBottom: 8,
    maxHeight: 260,
    overflow: "hidden",
  },
  suggestList: {
    paddingVertical: 4,
  },
  suggestItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 12,
  },
  suggestItemSelected: {
    backgroundColor: "#1c2333",
    borderLeftWidth: 2,
    borderLeftColor: "#58a6ff",
  },
  suggestCmd: {
    color: "#58a6ff",
    fontFamily: "monospace",
    fontSize: 13,
    fontWeight: "600",
    minWidth: 90,
  },
  suggestDesc: {
    color: "#8b949e",
    fontFamily: "monospace",
    fontSize: 11,
    flex: 1,
  },
});
