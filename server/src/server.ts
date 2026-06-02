import express, { Request, Response } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";

const app = express();

// CORS — allow mobile app origins. In production, restrict to your LAN/VPN IPs.
app.use(
  cors({
    origin: "*", // MVP: allow all. Restrict in production.
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

// Rate limiting for HTTP endpoints
const healthLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

export interface HealthResponse {
  status: "ok" | "error";
  uptime: number;
  active_clients: number;
  version: string;
}

let activeClientsGetter: () => number = () => 0;

export function setActiveClientsGetter(fn: () => number): void {
  activeClientsGetter = fn;
}

// Health check endpoint
app.get("/health", healthLimiter, (_req: Request, res: Response) => {
  const response: HealthResponse = {
    status: "ok",
    uptime: Math.floor(process.uptime()),
    active_clients: activeClientsGetter(),
    version: "1.0.0",
  };
  res.json(response);
});

export { app };
