import { spawn, ChildProcess } from "child_process";
import { appConfig } from "../config.js";
import { logger } from "../logger.js";

/**
 * Spawn Claude Code in headless text mode.
 * Raw stdout is streamed directly to the client as terminal output.
 */
export function spawnClaude(prompt: string, sessionId: string): ChildProcess {
  const args = [
    "-p", prompt,
    "--session-id", sessionId,
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
    ANTHROPIC_API_KEY: "",
  };

  logger.debug("Spawning Claude (text mode)", {
    cwd: appConfig.projectDir,
    model: appConfig.model,
    promptLength: prompt.length,
  });

  const child = spawn(appConfig.claudePath, args, {
    cwd: appConfig.projectDir,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    shell: false,
  });

  logger.info("Claude process spawned", { pid: child.pid });

  // Close stdin — we pass the prompt via -p
  if (child.stdin) {
    child.stdin.end();
  }

  return child;
}

/**
 * Stop a running Claude process.
 */
export function stopRun(child: ChildProcess): void {
  if (child.exitCode !== null || child.killed) return;
  logger.info("Stopping Claude process", { pid: child.pid });
  child.kill("SIGTERM");
  const forceTimer = setTimeout(() => {
    if (child.exitCode === null && !child.killed) {
      try { child.kill("SIGKILL"); } catch {}
    }
  }, 5000);
  if (forceTimer.unref) forceTimer.unref();
}
