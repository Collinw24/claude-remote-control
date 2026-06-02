import { spawn, ChildProcess } from "child_process";
import { appConfig } from "../config.js";
import { logger } from "../logger.js";
import type { SpawnOptions } from "../types.js";

/**
 * Spawn a Claude Code process in headless mode with DeepSeek routing.
 *
 * SECURITY WARNING: This spawns a process that can execute arbitrary shell
 * commands and edit files. The --dangerously-skip-permissions flag means
 * Claude will NOT prompt for approval. Guardrails are handled by the
 * WebSocket handler layer before forwarding to the client.
 */
export function spawnClaude(
  prompt: string,
  options: SpawnOptions
): ChildProcess {
  const args = [
    "-p", prompt,
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--no-session-persistence",
    "--dangerously-skip-permissions",
    "--allowedTools",
    [
      "Bash(git *)",
      "Bash(npm *)",
      "Bash(npx *)",
      "Bash(ls *)",
      "Bash(cat *)",
      "Bash(find *)",
      "Bash(grep *)",
      "Bash(head *)",
      "Bash(tail *)",
      "Bash(node *)",
      "Bash(tsc *)",
      "Read",
      "Edit",
      "WebSearch",
      "WebFetch",
    ].join(","),
  ];

  // DeepSeek Anthropic-compatible routing
  const env = {
    ...process.env,
    ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
    ANTHROPIC_AUTH_TOKEN: appConfig.deepseekApiKey,
    ANTHROPIC_MODEL: appConfig.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: appConfig.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: appConfig.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: appConfig.smallModel,
    CLAUDE_CODE_SUBAGENT_MODEL: appConfig.smallModel,
    API_TIMEOUT_MS: "600000",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    ANTHROPIC_API_KEY: "", // explicitly empty — use AUTH_TOKEN
  };

  logger.debug("Spawning Claude", {
    claudePath: appConfig.claudePath,
    cwd: options.projectDir || appConfig.projectDir,
    model: appConfig.model,
    promptLength: prompt.length,
  });

  const child = spawn(appConfig.claudePath, args, {
    cwd: options.projectDir || appConfig.projectDir,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    shell: false,
  });

  logger.info("Claude process spawned", { pid: child.pid });

  return child;
}

/**
 * Stop a running Claude process.
 * Sends SIGTERM first, escalates to SIGKILL after 5 seconds.
 */
export function stopRun(child: ChildProcess): void {
  if (child.exitCode !== null || child.killed) return;

  logger.info("Stopping Claude process", { pid: child.pid });
  child.kill("SIGTERM");

  const forceTimer = setTimeout(() => {
    if (child.exitCode === null && !child.killed) {
      logger.warn("Force killing Claude process", { pid: child.pid });
      try {
        child.kill("SIGKILL");
      } catch {
        // Process may have exited between check and kill
      }
    }
  }, 5000);

  // Don't let the timer keep the process alive
  if (forceTimer.unref) {
    forceTimer.unref();
  }
}
