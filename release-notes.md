## v1.0.2-alpha - Tailscale connection test build

### Patch update
- Moved the prompt bar above Android system navigation by applying the bottom safe-area inset.
- Added an explicit Android keyboard-height spacer so the prompt bar moves above Samsung keyboards.
- Switched Android keyboard layout mode to pan while the app handles the prompt offset itself.
- Kept Claude runs alive across brief WebSocket drops and reattached after reconnecting.
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
