import http from "http";
import { WebSocketServer } from "ws";
import { app } from "./server.js";
import { setActiveClientsGetter } from "./server.js";
import { handleConnection, getActiveClientCount } from "./ws/handler.js";
import { appConfig } from "./config.js";
import { logger } from "./logger.js";

// Create HTTP server from Express app
const server = http.createServer(app);

// Attach WebSocket server
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  handleConnection(ws);
});

// Wire up active client count for /health endpoint
setActiveClientsGetter(getActiveClientCount);

server.listen(appConfig.port, () => {
  logger.info(`Claude Remote Server started`, {
    port: appConfig.port,
    projectDir: appConfig.projectDir,
    model: appConfig.model,
    destructiveActionsAllowed: appConfig.allowDestructiveActions,
  });
  console.log(`
╔═══════════════════════════════════════════════════╗
║     Claude Code Remote Control Server             ║
╠═══════════════════════════════════════════════════╣
║  HTTP:  http://localhost:${appConfig.port}                  ║
║  WS:    ws://localhost:${appConfig.port}                     ║
║  Health: http://localhost:${appConfig.port}/health            ║
║  Model: ${appConfig.model.padEnd(32)}║
║  Project: ${appConfig.projectDir.split("/").pop()?.slice(0, 30).padEnd(28)}║
╠═══════════════════════════════════════════════════╣
║  ⚠️  WARNING: This provides remote shell access. ║
║  Do NOT expose this server to the public internet.║
║  Use Tailscale, VPN, or Cloudflare Tunnel.        ║
╚═══════════════════════════════════════════════════╝
`);
});

// Graceful shutdown
function shutdown() {
  logger.info("Shutting down...");
  wss.close();
  server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
