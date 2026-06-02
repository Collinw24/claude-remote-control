import React from "react";
import { View, TouchableOpacity, Text, StyleSheet } from "react-native";
import { useAppStore } from "../state/store";

const ACTIONS = [
  { key: "continue", label: "Continue", icon: "▶" },
  { key: "run_tests", label: "Run Tests", icon: "🧪" },
  { key: "git_diff", label: "Git Diff", icon: "📋" },
  { key: "explain_error", label: "Explain Error", icon: "💡" },
  { key: "commit", label: "Commit", icon: "📦" },
  { key: "revert", label: "Revert", icon: "↩" },
] as const;

export function QuickActions() {
  const sendMessage = useAppStore((s) => s.sendMessage);
  const isConnected = useAppStore((s) => s.connectionStatus === "connected");
  const isRunning = useAppStore((s) => s.runStatus === "running");

  const generateId = () =>
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const handleAction = (action: typeof ACTIONS[number]["key"]) => {
    if (!sendMessage) return;
    sendMessage({
      type: "quick_action",
      action,
      request_id: generateId(),
    });
  };

  const disabled = !isConnected;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Quick Actions</Text>
      <View style={styles.grid}>
        {ACTIONS.map(({ key, label, icon }) => (
          <TouchableOpacity
            key={key}
            style={[
              styles.button,
              disabled && styles.disabledButton,
              key === "continue" && isRunning && styles.runningButton,
            ]}
            onPress={() => handleAction(key)}
            disabled={disabled}
          >
            <Text style={styles.icon}>{icon}</Text>
            <Text style={styles.label}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 10,
    backgroundColor: "#1a1a2e",
  },
  title: {
    color: "#888",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  button: {
    backgroundColor: "#16213e",
    borderRadius: 8,
    padding: 10,
    alignItems: "center",
    width: "31%",
    flexGrow: 1,
    flexBasis: "31%",
    borderWidth: 1,
    borderColor: "#333",
  },
  disabledButton: {
    opacity: 0.4,
  },
  runningButton: {
    borderColor: "#4ecca3",
  },
  icon: {
    fontSize: 18,
    marginBottom: 2,
  },
  label: {
    color: "#ccc",
    fontSize: 11,
    textAlign: "center",
  },
});
