import React, { useState } from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
} from "react-native";
import { useAppStore } from "../state/store";

export function PromptInput() {
  const [text, setText] = useState("");
  const sendMessage = useAppStore((s) => s.sendMessage);
  const isRunning = useAppStore((s) => s.runStatus === "running");
  const isConnected = useAppStore((s) => s.connectionStatus === "connected");

  const generateId = () =>
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const handleSend = () => {
    if (!text.trim() || !sendMessage) return;
    sendMessage({
      type: "prompt",
      text: text.trim(),
      request_id: generateId(),
    });
    setText("");
  };

  const handleStop = () => {
    if (!sendMessage) return;
    sendMessage({ type: "stop" });
  };

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder={isConnected ? "Enter prompt..." : "Connect to server first..."}
        placeholderTextColor="#666"
        value={text}
        onChangeText={setText}
        multiline
        numberOfLines={3}
        editable={isConnected && !isRunning}
      />
      <View style={styles.buttons}>
        <TouchableOpacity
          style={[
            styles.sendButton,
            (!isConnected || !text.trim() || isRunning) && styles.disabledButton,
          ]}
          onPress={handleSend}
          disabled={!isConnected || !text.trim() || isRunning}
        >
          <Text style={styles.buttonText}>Send</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.stopButton, !isRunning && styles.disabledButton]}
          onPress={handleStop}
          disabled={!isRunning}
        >
          <Text style={styles.buttonText}>Stop</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 10,
    backgroundColor: "#1a1a2e",
    gap: 8,
  },
  input: {
    backgroundColor: "#16213e",
    color: "#e0e0e0",
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    minHeight: 70,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: "#333",
  },
  buttons: {
    flexDirection: "row",
    gap: 10,
  },
  sendButton: {
    flex: 1,
    backgroundColor: "#0f3460",
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
  },
  stopButton: {
    flex: 1,
    backgroundColor: "#c0392b",
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
  },
  disabledButton: {
    opacity: 0.4,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 15,
  },
});
