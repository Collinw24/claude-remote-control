import { spawn } from "child_process";

export interface GitDiffResult {
  diff: string;
  files: string[];
  stats: string;
}

/**
 * Run git diff directly (bypasses Claude Code).
 * Shows both --stat summary and full diff.
 */
export function runGitDiff(projectDir: string): Promise<GitDiffResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["diff", "--stat"], {
      cwd: projectDir,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });

    let statsOut = "";
    let statsErr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      statsOut += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      statsErr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(statsErr || `git diff --stat exited with code ${code}`));
        return;
      }

      const stats = statsOut.trim() || "No changes";

      // Now get the full diff
      const diffChild = spawn("git", ["diff"], {
        cwd: projectDir,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      });

      let diffOut = "";
      let diffErr = "";

      diffChild.stdout.on("data", (chunk: Buffer) => { diffOut += chunk.toString(); });
      diffChild.stderr.on("data", (chunk: Buffer) => { diffErr += chunk.toString(); });

      diffChild.on("close", (diffCode) => {
        if (diffCode !== 0 && diffCode !== null) {
          reject(new Error(diffErr || `git diff exited with code ${diffCode}`));
          return;
        }

        const diff = diffOut.trim() || "No changes";
        const files: string[] = [];
        const fileRegex = /^diff --git a\/(.+) b\/(.+)$/gm;
        let match;
        while ((match = fileRegex.exec(diff)) !== null) {
          files.push(match[1]);
        }

        resolve({ diff, files, stats });
      });

      diffChild.on("error", (err) => {
        reject(new Error(`Failed to run git diff: ${err.message}`));
      });
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to run git diff --stat: ${err.message}`));
    });
  });
}
