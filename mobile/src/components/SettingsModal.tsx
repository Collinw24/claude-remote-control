import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useAppStore } from "../state/store";
import { validateBackendUrl, normalizeBackendUrl } from "../utils/connection";

interface Props {
  visible: boolean;
  onClose: () => void;
  onReconnect: () => void;
}

export function SettingsModal({ visible, onClose, onReconnect }: Props) {
  const backendUrl = useAppStore((s) => s.backendUrl);
  const setBackendUrl = useAppStore((s) => s.setBackendUrl);
  const token = useAppStore((s) => s.token);
  const setToken = useAppStore((s) => s.setToken);
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const serverModel = useAppStore((s) => s.serverModel);
  const serverVersion = useAppStore((s) => s.serverVersion);
  const isConnected = connectionStatus === "connected";

  const [draftUrl, setDraftUrl] = useState(backendUrl);
  const [draftToken, setDraftToken] = useState(token);
  const [showToken, setShowToken] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setDraftUrl(backendUrl);
      setDraftToken(token);
      setUrlError(null);
    }
  }, [visible, backendUrl, token]);

  const handleUrlChange = useCallback((value: string) => {
    setDraftUrl(value);
    if (value.trim()) {
      const error = validateBackendUrl(value);
      setUrlError(error);
    } else {
      setUrlError(null);
    }
  }, []);

  const urlChanged = draftUrl !== backendUrl;
  const tokenChanged = draftToken !== token;
  const hasChanges = urlChanged || tokenChanged;
  const canSave = draftUrl.trim() && draftToken.trim() && !urlError;

  const handleSave = useCallback(() => {
    if (!canSave) return;
    const normalized = normalizeBackendUrl(draftUrl);
    setBackendUrl(normalized);
    setToken(draftToken);
    onClose();
    onReconnect();
  }, [canSave, draftUrl, draftToken, setBackendUrl, setToken, onClose, onReconnect]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={S.shell}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header */}
        <View style={S.header}>
          <Text style={S.headerTitle}>Server Configuration</Text>
          <TouchableOpacity onPress={onClose} style={S.closeBtn}>
            <Text style={S.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={S.body}
          contentContainerStyle={S.bodyInner}
          keyboardShouldPersistTaps="handled"
        >
          {/* Connection status */}
          <View style={S.section}>
            <Text style={S.label}>STATUS</Text>
            <View style={S.statusRow}>
              <View
                style={[
                  S.statusDot,
                  { backgroundColor: isConnected ? "#3fb950" : "#f85149" },
                ]}
              />
              <Text style={S.statusText}>
                {isConnected ? "Connected" : "Disconnected"}
              </Text>
            </View>
          </View>

          {/* Server URL */}
          <View style={S.section}>
            <Text style={S.label}>SERVER URL</Text>
            <TextInput
              style={[S.input, urlError ? S.inputError : null]}
              value={draftUrl}
              onChangeText={handleUrlChange}
              placeholder="ws://192.168.1.X:3001"
              placeholderTextColor="#30363d"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="next"
            />
            {urlError && <Text style={S.errorText}>{urlError}</Text>}
            <Text style={S.hint}>
              LAN IP of the computer running the server. Use Tailscale IP for remote access.
            </Text>
          </View>

          {/* Auth Token */}
          <View style={S.section}>
            <Text style={S.label}>AUTH TOKEN</Text>
            <View style={S.tokenRow}>
              <TextInput
                style={[S.input, S.tokenInput]}
                value={draftToken}
                onChangeText={setDraftToken}
                placeholder="Enter your REMOTE_TOKEN"
                placeholderTextColor="#30363d"
                secureTextEntry={!showToken}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={handleSave}
              />
              <TouchableOpacity
                style={S.tokenToggle}
                onPress={() => setShowToken((v) => !v)}
              >
                <Text style={S.tokenToggleText}>
                  {showToken ? "Hide" : "Show"}
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={S.hint}>
              Matches REMOTE_TOKEN in the server's .env file.
            </Text>
          </View>

          {/* Server info — shown when connected */}
          {isConnected && (
            <View style={S.section}>
              <Text style={S.label}>SERVER INFO</Text>
              <View style={S.infoRow}>
                <Text style={S.infoKey}>Model</Text>
                <Text style={S.infoValue}>{serverModel || "—"}</Text>
              </View>
              {serverVersion ? (
                <View style={S.infoRow}>
                  <Text style={S.infoKey}>Version</Text>
                  <Text style={S.infoValue}>{serverVersion}</Text>
                </View>
              ) : null}
            </View>
          )}
        </ScrollView>

        {/* Footer */}
        <View style={S.footer}>
          <TouchableOpacity
            style={[
              S.saveBtn,
              (!canSave || !hasChanges) && S.saveBtnDisabled,
            ]}
            onPress={handleSave}
            disabled={!canSave || !hasChanges}
          >
            <Text style={S.saveBtnText}>
              {isConnected ? "Save & Reconnect" : "Save & Connect"}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const S = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: "#0d1117",
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#21262d",
  },
  headerTitle: {
    color: "#e6edf3",
    fontFamily: "monospace",
    fontSize: 15,
    fontWeight: "600",
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#21262d",
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: {
    color: "#8b949e",
    fontSize: 14,
    fontWeight: "600",
  },

  body: {
    flex: 1,
  },
  bodyInner: {
    padding: 16,
    gap: 20,
  },

  section: {
    gap: 8,
  },
  label: {
    color: "#484f58",
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
  },

  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    color: "#c9d1d9",
    fontFamily: "monospace",
    fontSize: 13,
  },

  input: {
    backgroundColor: "#161b22",
    color: "#c9d1d9",
    fontFamily: "monospace",
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#30363d",
    borderRadius: 8,
  },
  inputError: {
    borderColor: "#f85149",
  },
  errorText: {
    color: "#f85149",
    fontFamily: "monospace",
    fontSize: 11,
  },
  hint: {
    color: "#484f58",
    fontFamily: "monospace",
    fontSize: 11,
    lineHeight: 16,
  },

  tokenRow: {
    flexDirection: "row",
    gap: 8,
  },
  tokenInput: {
    flex: 1,
  },
  tokenToggle: {
    backgroundColor: "#21262d",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  tokenToggleText: {
    color: "#58a6ff",
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "600",
  },

  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#21262d",
  },
  infoKey: {
    color: "#8b949e",
    fontFamily: "monospace",
    fontSize: 12,
  },
  infoValue: {
    color: "#c9d1d9",
    fontFamily: "monospace",
    fontSize: 12,
  },

  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#21262d",
  },
  saveBtn: {
    backgroundColor: "#238636",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  saveBtnDisabled: {
    opacity: 0.4,
  },
  saveBtnText: {
    color: "#ffffff",
    fontFamily: "monospace",
    fontSize: 13,
    fontWeight: "700",
  },
});
