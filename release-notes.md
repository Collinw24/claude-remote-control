## v1.0.4-alpha - Sessions as first-class objects

### Server
- Pass `--session-id <runId>` to Claude Code so the on-disk `.jsonl` filename
  matches the mobile session ID. Desktop `claude --resume <id>` works with the
  same UUID.
- Generate a persistent server session UUID (once at startup) instead of
  a fresh UUID per `auth_ok`. Reconnects no longer appear as new sessions.
- Include `session_id` in `run_started` messages for client-side grouping.

### Mobile
- **Sessions are now first-class objects** mirroring desktop's `sessions-index.json`:
  `SessionRecord` with `id`, `name` (auto-derived from first prompt), `summary`,
  `firstPrompt`, `messageCount`, `created`/`modified` timestamps, and `messages`.
- Store refactored: `sessions[]` array replaces the flat `messages[]` list.
  `activeSessionId` tracks which session is displayed. All persisted to AsyncStorage
  (capped at 50 sessions, 200 messages each).
- **Run lifecycle events produce visible log entries:**
  - `▸ Run started` (system) on `run_started`
  - `▾ Run completed · N turns · X.Xs` (system) on `run_completed`
  - `◼ Run stopped (reason)` (system) on `run_stopped`
  - `✗ Run failed: error` (error) on `run_failed`
- **New session commands** mirroring desktop Claude Code:
  - `/new` — create a fresh session
  - `/sessions` — list past sessions with name, message count, date
  - `/resume <index|id>` — switch to a different session
  - `/rename <name>` — rename the active session
  - `/clear` — unchanged, clears active session only
- Session name shown in the status bar.
- Server session change detected on reconnect; boundary marker injected.
- "Thinking…" placeholder removed — run lifecycle messages now provide the structure.
- System messages rendered in muted gray italic.

### Build
```bash
cd mobile/android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

APK: `mobile/android/app/build/outputs/apk/release/app-release.apk`

---

## v1.0.3-alpha - Session persistence & conversation caching

### Server
- Removed `--no-session-persistence` from the Claude spawn so every prompt from the
  mobile app creates a persistent, resumable session on disk.  Sessions can be
  resumed from the desktop with `claude -r <session-id>` or `claude --continue`.

### Mobile
- Conversation output (`messages`) is now persisted to AsyncStorage so the log
  survives app restarts.  Capped at 200 latest entries; oldest messages are
  trimmed automatically.
- Added `lastSessionId` tracking so the app remembers which Claude session the
  current conversation is linked to.  `clearMessages` resets both the log and the
  session pointer.

### Build
```bash
cd mobile/android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

APK: `mobile/android/app/build/outputs/apk/release/app-release.apk`

---

## v1.0.2-alpha - Tailscale connection test build

### Patch update
- Renamed the app to `RemoteClaudetrol` and refreshed the launcher icon for the Claude remote-control workflow.
- Moved the prompt bar above Android system navigation by applying the bottom safe-area inset.
- Added an explicit Android keyboard-height spacer so the prompt bar moves above Samsung keyboards.
- Switched Android keyboard layout mode to pan while the app handles the prompt offset itself.
- Kept Claude runs alive across brief WebSocket drops and reattached after reconnecting.
- Synced mobile run state from server status so the prompt unlocks after missed completion events.
- Suppressed noisy `Connection lost (NORMAL)` UI messages from normal WebSocket closes.
- Replaced sockets no longer mark the app disconnected or schedule reconnects after a newer socket is already active.
- Abnormal unintentional closes still show an error and reconnect.

### Connection fixes
- Default backend URL now points at the current Tailscale server: `ws://100.81.211.88:3001`.
- Backend URL and token persist locally with AsyncStorage, so the app no longer falls back to the Android emulator URL.
- Backend input is normalized before connecting:
  - `100.81.211.88` -> `ws://100.81.211.88:3001`
  - `100.81.211.88:3001` -> `ws://100.81.211.88:3001`
  - `http://...` -> `ws://...`
  - `https://...` -> `wss://...`
- Invalid backend URLs now show a visible app error instead of creating a doomed WebSocket.
- Server now responds to heartbeat `get_status` messages so the mobile pong watchdog has real traffic to observe.

### Mobile reliability
- Reconnects are capped at 15 seconds and refresh when the app returns to the foreground.
- The connection screen stays visible while disconnected and shows the current handshake target.
- Android cleartext WebSocket support remains enabled.
- iOS app config now allows local cleartext networking for standalone builds.

### Build
```bash
cd mobile/android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

APK: `mobile/android/app/build/outputs/apk/release/app-release.apk`

Alpha build for private tailnet testing only. Do not expose the server directly to the public internet.
