import { config } from "dotenv";
import { resolve } from "path";

// Load .env from the server directory
config({ path: resolve(__dirname, "..", ".env") });

export interface AppConfig {
  port: number;
  remoteToken: string;
  projectDir: string;
  deepseekApiKey: string;
  allowDestructiveActions: boolean;
  logLevel: string;
  model: string;
  smallModel: string;
  claudePath: string;
}

function mustEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === "") {
    console.error(`FATAL: Required environment variable ${key} is not set.`);
    console.error("Copy .env.example to .env and fill in the required values.");
    process.exit(1);
  }
  return value.trim();
}

function optionalEnv(key: string, fallback: string): string {
  const value = process.env[key];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

function optionalBoolEnv(key: string, fallback: boolean): boolean {
  const value = process.env[key];
  if (!value || value.trim() === "") return fallback;
  return value.toLowerCase() === "true" || value === "1";
}

export const appConfig: AppConfig = {
  port: parseInt(optionalEnv("PORT", "3001"), 10),
  remoteToken: mustEnv("REMOTE_TOKEN"),
  projectDir: resolve(mustEnv("PROJECT_DIR")),
  deepseekApiKey: mustEnv("DEEPSEEK_API_KEY"),
  allowDestructiveActions: optionalBoolEnv("ALLOW_DESTRUCTIVE_ACTIONS", false),
  logLevel: optionalEnv("LOG_LEVEL", "info"),
  model: optionalEnv("ANTHROPIC_MODEL", "deepseek-v4-pro"),
  smallModel: optionalEnv("ANTHROPIC_SMALL_FAST_MODEL", "deepseek-v4-flash"),
  claudePath: optionalEnv("CLAUDE_PATH", "claude"),
};
