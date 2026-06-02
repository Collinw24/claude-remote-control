import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useAppStore } from "../state/store";

export function StatusBadge() {
  const status = useAppStore((s) => s.connectionStatus);

  const color =
    status === "connected"
      ? "#4ecca3"
      : status === "connecting"
      ? "#f0a500"
      : "#e74c3c";

  const label =
    status === "connected"
      ? "Connected"
      : status === "connecting"
      ? "Connecting..."
      : "Disconnected";

  return (
    <View style={styles.container}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 4,
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
  },
});
