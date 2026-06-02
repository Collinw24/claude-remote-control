import { spawn } from "child_process";
import { appConfig } from "../config.js";

export interface RevertResult {
  needsConfirmation: boolean;
  reverted?: boolean;
  message?: string;
  diff?: string;
  files?: string[];
}

/**
 * Show uncommitted changes and optionally revert them.
 *
 * SECURITY: Reverting is destructive — it discards uncommitted work.
 * This function requires ALLOW_DESTRUCTIVE_ACTIONS=true in the server
 * environment to actually execute the revert.
 *
 * First call (without confirm=true): shows what would be reverted.
 * Second call (confirm=true): executes git checkout -- . (safe revert)
 * or git reset --hard HEAD (if ALLOW_DESTRUCTIVE_ACTIONS is true).
 */
export function runRevert(projectDir: string, confirm?: boolean): Promise<RevertResult> {
  if (!appConfig.allowDestructiveActions && confirm) {
    return Promise.resolve({
      needsConfirmation: false,
      reverted: false,
      message: "Revert blocked: ALLOW_DESTRUCTIVE_ACTIONS is not enabled.",
    });
  }

  if (confirm) {
    return executeRevert(projectDir);
  }
  return previewRevert(projectDir);
}

function previewRevert(projectDir: string): Promise<RevertResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["diff", "--stat"], {
      cwd: projectDir,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });

    let statsOut = "";
    child.stdout.on("data", (chunk: Buffer) => { statsOut += chunk.toString(); });

    child.on("close", (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`git diff --stat failed with code ${code}`));
        return;
      }

      const stats = statsOut.trim();
      if (!stats) {
        resolve({
          needsConfirmation: false,
          reverted: false,
          message: "Nothing to revert (working tree clean).",
        });
        return;
      }

      // Get full diff
      const diffChild = spawn("git", ["diff"], {
        cwd: projectDir,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      });

      let diffOut = "";
      diffChild.stdout.on("data", (chunk: Buffer) => { diffOut += chunk.toString(); });

      diffChild.on("close", (diffCode) => {
        if (diffCode !== 0 && diffCode !== null) {
          reject(new Error(`git diff failed with code ${diffCode}`));
          return;
        }

        const diff = diffOut.trim();
        const files: string[] = [];
        const fileRegex = /^diff --git a\/(.+) b\/(.+)$/gm;
        let match;
        while ((match = fileRegex.exec(diff)) !== null) {
          files.push(match[1]);
        }

        resolve({
          needsConfirmation: true,
          diff,
          files,
        });
      });
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to run git diff: ${err.message}`));
    });
  });
}

function executeRevert(projectDir: string): Promise<RevertResult> {
  return new Promise((resolve, reject) => {
    // Use git checkout -- . to revert unstaged changes (safer than reset --hard)
    const child = spawn("git", ["checkout", "--", "."], {
      cwd: projectDir,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on("close", (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(stderr || `git checkout failed with code ${code}`));
        return;
      }

      resolve({
        needsConfirmation: false,
        reverted: true,
        message: "Changes reverted successfully (git checkout -- .).",
      });
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to run git checkout: ${err.message}`));
    });
  });
}
