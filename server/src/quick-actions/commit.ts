import { spawn } from "child_process";

export interface CommitResult {
  needsConfirmation: boolean;
  committed?: boolean;
  commitMessage?: string;
  diff?: string;
  files?: string[];
  error?: string;
}

/**
 * Show staged changes and optionally commit.
 *
 * First call (without confirm=true): shows what would be committed,
 * returns diff & files. Requires confirmation from user.
 *
 * Second call (confirm=true): actually commits with a generated message.
 *
 * MVP limitation: commit message is auto-generated; future versions
 * could accept a custom message from the mobile app.
 */
export function runCommit(projectDir: string, confirm?: boolean): Promise<CommitResult> {
  if (confirm) {
    return executeCommit(projectDir);
  }
  return previewCommit(projectDir);
}

function previewCommit(projectDir: string): Promise<CommitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["diff", "--cached", "--stat"], {
      cwd: projectDir,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });

    let statsOut = "";
    let statsErr = "";

    child.stdout.on("data", (chunk: Buffer) => { statsOut += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { statsErr += chunk.toString(); });

    child.on("close", (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(statsErr || `git diff --cached failed with code ${code}`));
        return;
      }

      const stats = statsOut.trim();
      if (!stats) {
        resolve({
          needsConfirmation: false,
          committed: false,
          error: "Nothing to commit (no staged changes). Use git add first.",
        });
        return;
      }

      // Get full diff
      const diffChild = spawn("git", ["diff", "--cached"], {
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
          reject(new Error(diffErr || `git diff --cached failed with code ${diffCode}`));
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

      diffChild.on("error", (err) => {
        reject(new Error(`Failed to run git diff --cached: ${err.message}`));
      });
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to run git diff --cached --stat: ${err.message}`));
    });
  });
}

function executeCommit(projectDir: string): Promise<CommitResult> {
  return new Promise((resolve, reject) => {
    // Generate a commit message from the diff
    const msgChild = spawn(
      "git",
      ["diff", "--cached", "--name-only"],
      {
        cwd: projectDir,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      }
    );

    let fileList = "";
    msgChild.stdout.on("data", (chunk: Buffer) => { fileList += chunk.toString(); });

    msgChild.on("close", (code) => {
      const files = fileList.trim().split("\n").filter(Boolean);
      if (files.length === 0) {
        resolve({
          needsConfirmation: false,
          committed: false,
          error: "Nothing to commit.",
        });
        return;
      }

      const message = `Update ${files.length} file(s): ${files.slice(0, 3).join(", ")}${files.length > 3 ? ` and ${files.length - 3} more` : ""}`;

      const commitChild = spawn("git", ["commit", "-m", message], {
        cwd: projectDir,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      });

      let commitOut = "";
      let commitErr = "";

      commitChild.stdout.on("data", (chunk: Buffer) => { commitOut += chunk.toString(); });
      commitChild.stderr.on("data", (chunk: Buffer) => { commitErr += chunk.toString(); });

      commitChild.on("close", (commitCode) => {
        if (commitCode !== 0 && commitCode !== null) {
          reject(new Error(commitErr || `git commit failed with code ${commitCode}`));
          return;
        }

        resolve({
          needsConfirmation: false,
          committed: true,
          commitMessage: commitOut.trim() || message,
        });
      });

      commitChild.on("error", (err) => {
        reject(new Error(`Failed to run git commit: ${err.message}`));
      });
    });

    msgChild.on("error", (err) => {
      reject(new Error(`Failed to list staged files: ${err.message}`));
    });
  });
}
