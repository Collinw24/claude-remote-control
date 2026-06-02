import React, { useCallback, useEffect, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ConnectionBar } from "./src/components/ConnectionBar";
import { StatusBadge } from "./src/components/StatusBadge";
import { RunStatus } from "./src/components/RunStatus";
import { PromptInput } from "./src/components/PromptInput";
import { QuickActions } from "./src/components/QuickActions";
import { OutputLog } from "./src/components/OutputLog";
import { ConfirmDialog } from "./src/components/ConfirmDialog";
import { useWebSocket } from "./src/hooks/useWebSocket";

export default function App() {
  const { connect, disconnect } = useWebSocket();

  const handleConnect = useCallback(() => {
    connect();
  }, [connect]);

  const handleDisconnect = useCallback(() => {
    disconnect();
  }, [disconnect]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#0f0f23" />
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={0}
        >
          <ConnectionBar onConnect={handleConnect} onDisconnect={handleDisconnect} />
          <StatusBadge />
          <RunStatus />
          <PromptInput />
          <QuickActions />
          <OutputLog />
        </KeyboardAvoidingView>
        <ConfirmDialog />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f0f23",
  },
  flex: {
    flex: 1,
  },
});
