# Claude Code Remote Control — Mobile MVP

Control a Claude Code coding agent from your phone. The mobile app sends prompts
over WebSocket to a backend running on your development machine, which spawns
Claude Code in headless mode against a local project and streams output back.

**Works with DeepSeek V4** via Anthropic-compatible environment variables.

```
Phone (Expo RN)  <--WebSocket-->  Backend (Express+ws)  --spawn-->  claude -p
                                       |                              |
                                  localhost:3001              DeepSeek API
```

---

## ⚠️ Security Warning

This project provides **remote shell access** to your development machine.
Do NOT expose the server directly to the public internet. Use one of these
instead:

- **[Tailscale](https://tailscale.com/)** — VPN between your phone and dev machine
- **[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)** — with Access for authentication
- **LAN-only** — only use on your local network behind a firewall

The auth token is a shared secret sent over the WebSocket. Without TLS (which
you get from Tailscale or Cloudflare), it's sent in plaintext over the network.

---

## Prerequisites

- **Node.js** 18+ with npm
- **Claude Code CLI** installed and configured: `claude --version`
- **DeepSeek API key** (or other Anthropic-compatible provider)
- **Expo Go** on your phone (iOS/Android) or a mobile simulator
- The server and phone must be on the same network, or connected via Tailscale

---

## Server Setup

```bash
cd server
npm install
cp .env.example .env
# Edit .env with your real values (see below)
npm run dev
```

### .env Configuration

```env
# REQUIRED
REMOTE_TOKEN=generate-a-random-token-here
PROJECT_DIR=/absolute/path/to/your/project
DEEPSEEK_API_KEY=sk-your-deepseek-key-here

# OPTIONAL
PORT=3001
ALLOW_DESTRUCTIVE_ACTIONS=false
LOG_LEVEL=info
```

Generate a secure token:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Mobile Setup

```bash
cd mobile
npm install
npm start
```

This starts the Expo dev server. Scan the QR code with Expo Go on your phone,
or press `a` for Android emulator / `i` for iOS simulator.

### Connecting to the Server

1. Open the app
2. Enter the server WebSocket URL: `ws://<your-dev-machine-ip>:3001`
   - On same LAN: use your machine's local IP (e.g., `ws://192.168.1.50:3001`)
   - With Tailscale: use the Tailscale IP (e.g., `ws://100.x.x.x:3001`)
3. Enter the same `REMOTE_TOKEN` you set in `.env`
4. Tap **Connect**
5. Status should show green "Connected" with the model name

---

## Usage

### Sending Prompts
Type a prompt in the text box and tap **Send**. The output streams live in the
log panel below. The agent has access to:
- `Read`, `Edit` — file operations
- `Bash` — git, npm, npx, ls, cat, find, grep, head, tail, node, tsc
- `WebSearch`, `WebFetch` — web access

### Stopping a Run
Tap **Stop** to kill the current Claude process. The run will be marked as
"Stopped" in the status display.

### Quick Actions

| Button | What it does |
|--------|-------------|
| **Continue** | Sends "Continue from where you left off." |
| **Run Tests** | Sends "Run the test suite, summarize failures, fix if safe." |
| **Git Diff** | Shows `git diff` output directly (no Claude involved) |
| **Explain Error** | Sends the last error to Claude for explanation |
| **Commit** | Shows staged changes, asks confirmation, then commits |
| **Revert** | Shows uncommitted changes, requires confirmation + `ALLOW_DESTRUCTIVE_ACTIONS=true` |

---

## Architecture

```
remote-control/
├── server/                  # Node.js + TypeScript backend
│   ├── src/
│   │   ├── index.ts         # Entry point
│   │   ├── config.ts        # Environment config
│   │   ├── server.ts        # Express app + /health
│   │   ├── logger.ts        # Winston logger
│   │   ├── types.ts         # Shared types
│   │   ├── ws/
│   │   │   ├── handler.ts   # WebSocket lifecycle + message routing
│   │   │   └── protocol.ts  # Zod schemas for all messages
│   │   ├── claude/
│   │   │   ├── spawn.ts     # Claude CLI spawn with DeepSeek env vars
│   │   │   ├── parser.ts    # stream-json line parser
│   │   │   └── guardrails.ts # Dangerous command detection
│   │   └── quick-actions/
│   │       ├── git-diff.ts   # Git diff runner
│   │       ├── commit.ts     # Git commit workflow
│   │       └── revert.ts     # Git revert workflow
│   └── .env.example
├── mobile/                  # Expo React Native app
│   ├── App.tsx              # Root component
│   └── src/
│       ├── types.ts         # Message types
│       ├── state/store.ts   # Zustand store
│       ├── hooks/
│       │   ├── useWebSocket.ts  # WebSocket connection hook
│       │   └── useAppState.ts   # Derived state hook
│       └── components/
│           ├── ConnectionBar.tsx
│           ├── StatusBadge.tsx
│           ├── RunStatus.tsx
│           ├── PromptInput.tsx
│           ├── QuickActions.tsx
│           ├── OutputLog.tsx
│           ├── LogEntry.tsx
│           └── ConfirmDialog.tsx
└── README.md
```

---

## WebSocket Protocol

The server and mobile app communicate over a WebSocket connection using JSON messages.

### Client → Server

| Type | Fields | Description |
|------|--------|-------------|
| `auth` | `token` | Authenticate with REMOTE_TOKEN |
| `prompt` | `text`, `request_id` | Send a prompt to Claude |
| `quick_action` | `action`, `request_id` | Run a quick action |
| `stop` | — | Kill the current Claude process |
| `confirm_action` | `action_id`, `approved` | Respond to confirmation dialog |
| `get_status` | — | Request current status |

### Server → Client

| Type | Description |
|------|-------------|
| `auth_ok` | Authentication succeeded |
| `auth_error` | Authentication failed |
| `status` | Connection and run state |
| `run_started` | Claude process spawned |
| `agent_output` | Streaming output (thinking, text, tool_use, tool_result) |
| `agent_error` | stderr line or API error |
| `run_completed` | Run finished successfully |
| `run_stopped` | Run was stopped by user or guardrails |
| `run_failed` | Run exited with error |
| `confirmation_required` | Destructive action needs confirmation |
| `git_diff` | Git diff output |
| `server_error` | Internal server error |

---

## Guardrails

The server blocks dangerous prompts and commands:

### Blocked (refused immediately)
- `rm -rf /`, `rm -rf /*`, `rm -rf ~`
- `dd if=`, `mkfs`, block device writes
- `chmod 777 /`, fork bombs, curl-pipe-bash
- `sudo`, `shutdown`, `reboot`
- PowerShell `Remove-Item -Recurse`, `Format-Volume`
- SQL `DROP TABLE`, `DROP DATABASE`
- System file overwrites (`> /etc/passwd`, etc.)
- Jailbreak attempts

### Require Confirmation
- `git push --force`, `git push -f`
- `git reset --hard`
- `git clean -fdx`
- `npm publish`

Set `ALLOW_DESTRUCTIVE_ACTIONS=true` in `.env` to skip confirmation prompts
(use only in safe, isolated environments).

**Important caveat:** With `--dangerously-skip-permissions`, Claude executes
tools immediately. Guardrails detect dangerous commands in the output stream
*after* execution begins, then kill the process. For production use, a more
robust approach would be to use `--input-format stream-json` to intercept
tool calls before they reach Claude.

---

## Quick Actions in Detail

### Continue
Spawns a fresh Claude process with: "Continue from where you left off."

### Run Tests
Spawns Claude with: "Run the project's test suite, summarize failures, and fix
them if safe."

### Git Diff
Runs `git diff --stat` and `git diff` directly on the server. Does NOT invoke
Claude Code. Output is sent as a `git_diff` message.

### Explain Error
Sends the last captured stderr output to Claude: "Explain what went wrong and
propose the smallest safe fix."

### Commit
1. Runs `git diff --cached` to preview staged changes
2. Sends a `confirmation_required` message to the mobile app
3. On approval, runs `git commit -m "Update N file(s): ..."`
4. On denial or timeout (60s), cancels the commit

### Revert
1. Runs `git diff` to show uncommitted changes
2. Requires `ALLOW_DESTRUCTIVE_ACTIONS=true` in server `.env`
3. Sends `confirmation_required` to the mobile app
4. On approval, runs `git checkout -- .`
5. On denial or timeout, cancels

---

## Development

### Server
```bash
cd server
npm run dev       # Start with tsx watch (auto-reload)
npm run build     # Compile TypeScript
npm start         # Run compiled JS
```

### Mobile
```bash
cd mobile
npm start         # Start Expo dev server
npm run web       # Run in browser (for testing)
```

### Health Check
```bash
curl http://localhost:3001/health
# {"status":"ok","uptime":123,"active_clients":0,"version":"1.0.0"}
```

---

## Troubleshooting

**"Remote Control environments are not available" error from Claude CLI:**
This means the `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` env var or
telemetry disabling is affecting Claude's feature flags. The spawn.ts sets
this intentionally. If Claude fails to run with it, try removing it from
the env in `spawn.ts`.

**WebSocket connection refused:**
- Make sure the server is running
- Check the IP address is correct (use `ipconfig` on Windows, `ifconfig` on Mac/Linux)
- Check firewall settings — port 3001 may need to be allowed on local network

**Auth fails:**
- Verify the token in the app matches `REMOTE_TOKEN` in server `.env`
- Tokens are case-sensitive and whitespace-sensitive

**Claude process not found:**
- Set `CLAUDE_PATH` in `.env` to the full path of the `claude` binary
- On Windows: `C:/Users/<user>/.local/bin/claude`
- Verify with: `claude --version`

---

## Future Improvements (Beyond MVP)

- [ ] Per-user authentication with proper token management
- [ ] Multiple concurrent agents
- [ ] Session persistence and resume
- [ ] Project switching from the mobile app
- [ ] File browser tab in the mobile app
- [ ] Push notifications when runs complete
- [ ] `--input-format stream-json` for proper pre-execution tool interception
- [ ] TLS/HTTPS support for the WebSocket server
- [ ] Structured agent output (tool_use approvals inline in chat)
- [ ] Multi-model support (switch between providers from the app)
- [ ] Prompt streaming (typeahead from mobile to server)

---

## License

Private use. Not for distribution without security hardening.
