import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { LogEntry as LogEntryType } from "../types";

interface Props {
  entry: LogEntryType;
}

const TYPE_STYLES: Record<
  string,
  { bg: string; text: string; border: string }
> = {
  thinking: { bg: "#1a1a2e", text: "#a29bfe", border: "#6c5ce7" },
  text: { bg: "#16213e", text: "#dfe6e9", border: "#333" },
  tool_use: { bg: "#1a1a2e", text: "#74b9ff", border: "#0984e3" },
  tool_result: { bg: "#1a1a2e", text: "#55efc4", border: "#00b894" },
  error: { bg: "#2d1b1b", text: "#ff7675", border: "#d63031" },
  system: { bg: "#1a1a2e", text: "#888", border: "#555" },
};

export function LogEntry({ entry }: Props) {
  const style = TYPE_STYLES[entry.type] || TYPE_STYLES.text;

  return (
    <View style={[styles.container, { backgroundColor: style.bg, borderLeftColor: style.border }]}>
      <View style={styles.header}>
        <Text style={[styles.type, { color: style.text }]}>
          {entry.toolName ? `${entry.type} (${entry.toolName})` : entry.type}
        </Text>
        <Text style={styles.timestamp}>
          {formatTime(entry.timestamp)}
        </Text>
      </View>
      <Text
        style={[
          styles.content,
          { color: style.text },
          entry.isError && styles.errorContent,
        ]}
        selectable
      >
        {entry.content}
      </Text>
    </View>
  );
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

const styles = StyleSheet.create({
  container: {
    padding: 8,
    marginHorizontal: 10,
    marginVertical: 2,
    borderRadius: 4,
    borderLeftWidth: 3,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  type: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    opacity: 0.7,
  },
  timestamp: {
    fontSize: 10,
    color: "#666",
  },
  content: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: "monospace",
  },
  errorContent: {
    color: "#ff7675",
  },
});
