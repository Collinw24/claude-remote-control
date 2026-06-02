import React from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { useAppStore } from "../state/store";

export function RunStatus() {
  const runStatus = useAppStore((s) => s.runStatus);
  const serverModel = useAppStore((s) => s.serverModel);

  const config: Record<string, { color: string; label: string; icon: string }> = {
    idle: { color: "#888", label: "Idle", icon: "○" },
    running: { color: "#4ecca3", label: "Running", icon: "" },
    completed: { color: "#3498db", label: "Completed", icon: "✓" },
    stopped: { color: "#f0a500", label: "Stopped", icon: "⏹" },
    failed: { color: "#e74c3c", label: "Failed", icon: "✗" },
  };

  const { color, label, icon } = config[runStatus] || config.idle;

  return (
    <View style={styles.container}>
      {runStatus === "running" ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <Text style={[styles.icon, { color }]}>{icon}</Text>
      )}
      <Text style={[styles.label, { color }]}>{label}</Text>
      {serverModel ? (
        <Text style={styles.model}>{serverModel}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  icon: {
    fontSize: 14,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
  },
  model: {
    fontSize: 11,
    color: "#666",
    marginLeft: "auto",
  },
});
