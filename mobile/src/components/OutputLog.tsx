import React, { useRef, useEffect } from "react";
import { FlatList, View, Text, StyleSheet } from "react-native";
import { useAppStore } from "../state/store";
import { LogEntry } from "./LogEntry";

export function OutputLog() {
  const messages = useAppStore((s) => s.messages);
  const listRef = useRef<FlatList>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0 && listRef.current) {
      setTimeout(() => {
        listRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Output will appear here...</Text>
        <Text style={styles.emptyHint}>
          Connect to the server and send a prompt to get started.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      ref={listRef}
      data={messages}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <LogEntry entry={item} />}
      style={styles.list}
      contentContainerStyle={styles.listContent}
      initialNumToRender={30}
      maxToRenderPerBatch={20}
      windowSize={10}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: "#0f0f23",
  },
  listContent: {
    paddingVertical: 4,
  },
  empty: {
    flex: 1,
    backgroundColor: "#0f0f23",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  emptyText: {
    color: "#666",
    fontSize: 16,
    marginBottom: 8,
  },
  emptyHint: {
    color: "#444",
    fontSize: 13,
    textAlign: "center",
  },
});
