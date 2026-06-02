import React from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from "react-native";
import { useAppStore } from "../state/store";

export function ConfirmDialog() {
  const confirmation = useAppStore((s) => s.pendingConfirmation);
  const setPendingConfirmation = useAppStore((s) => s.setPendingConfirmation);
  const sendMessage = useAppStore((s) => s.sendMessage);

  if (!confirmation) return null;

  const handleResponse = (approved: boolean) => {
    if (sendMessage) {
      sendMessage({
        type: "confirm_action",
        action_id: confirmation.actionId,
        approved,
      });
    }
    setPendingConfirmation(null);
  };

  return (
    <Modal visible transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <Text style={styles.title}>⚠️ Confirmation Required</Text>
          <Text style={styles.prompt}>{confirmation.prompt}</Text>
          <ScrollView style={styles.detailsContainer}>
            <Text style={styles.details} selectable>
              {confirmation.details}
            </Text>
          </ScrollView>
          <View style={styles.buttons}>
            <TouchableOpacity
              style={[styles.button, styles.denyButton]}
              onPress={() => handleResponse(false)}
            >
              <Text style={styles.buttonText}>Deny</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.allowButton]}
              onPress={() => handleResponse(true)}
            >
              <Text style={styles.buttonText}>Allow</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  dialog: {
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 20,
    width: "100%",
    maxWidth: 400,
    borderWidth: 1,
    borderColor: "#f0a500",
  },
  title: {
    color: "#f0a500",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
    textAlign: "center",
  },
  prompt: {
    color: "#e0e0e0",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 10,
  },
  detailsContainer: {
    maxHeight: 200,
    marginBottom: 16,
    backgroundColor: "#0f0f23",
    borderRadius: 6,
    padding: 10,
  },
  details: {
    color: "#aaa",
    fontSize: 12,
    fontFamily: "monospace",
  },
  buttons: {
    flexDirection: "row",
    gap: 10,
  },
  button: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  denyButton: {
    backgroundColor: "#c0392b",
  },
  allowButton: {
    backgroundColor: "#27ae60",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
});
