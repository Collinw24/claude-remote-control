import React from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
} from "react-native";
import { useAppStore } from "../state/store";

interface Props {
  onConnect: () => void;
  onDisconnect: () => void;
}

export function ConnectionBar({ onConnect, onDisconnect }: Props) {
  const backendUrl = useAppStore((s) => s.backendUrl);
  const setBackendUrl = useAppStore((s) => s.setBackendUrl);
  const token = useAppStore((s) => s.token);
  const setToken = useAppStore((s) => s.setToken);
  const connectionStatus = useAppStore((s) => s.connectionStatus);

  const isConnected = connectionStatus === "connected";
  const isConnecting = connectionStatus === "connecting";

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder="ws://192.168.1.100:3001"
        placeholderTextColor="#888"
        value={backendUrl}
        onChangeText={setBackendUrl}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!isConnected && !isConnecting}
      />
      <TextInput
        style={styles.input}
        placeholder="Token"
        placeholderTextColor="#888"
        value={token}
        onChangeText={setToken}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={!isConnected && !isConnecting}
      />
      <TouchableOpacity
        style={[
          styles.button,
          isConnected ? styles.disconnectButton : styles.connectButton,
          isConnecting && styles.connectingButton,
        ]}
        onPress={isConnected ? onDisconnect : onConnect}
        disabled={isConnecting}
      >
        <Text style={styles.buttonText}>
          {isConnecting ? "Connecting..." : isConnected ? "Disconnect" : "Connect"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 10,
    backgroundColor: "#1a1a2e",
    gap: 6,
  },
  input: {
    backgroundColor: "#16213e",
    color: "#e0e0e0",
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: "#333",
  },
  button: {
    borderRadius: 8,
    padding: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  connectButton: {
    backgroundColor: "#0f3460",
  },
  disconnectButton: {
    backgroundColor: "#533483",
  },
  connectingButton: {
    backgroundColor: "#555",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
});
