import { appConfig } from "../config.js";

/**
 * Guardrails for dangerous commands and prompts.
 *
 * SECURITY WARNING:
 * This is a best-effort safety layer. It uses regex pattern matching,
 * which is NOT foolproof. A determined adversary or a sufficiently
 * creative prompt can bypass these checks.
 *
 * This server provides remote shell access — treat it accordingly.
 * Do NOT expose it to the public internet.
 */

interface ScanResult {
  action: "allow" | "block" | "confirm";
  reason?: string;
}

// ── Prompt-level patterns (blocked before spawning Claude) ──

const PROMPT_BLOCKED_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  {
    regex: /(?:ignore|override|bypass|disable|skip)\s+(?:all\s+)?(?:previous|above|prior|earlier|these)\s+(?:instructions?|rules?|guidelines?|guardrails?|safety|restrictions?)/i,
    reason: "Attempt to override safety instructions detected",
  },
  {
    regex: /pretend\s+(?:you\s+(?:are|have)|to\s+be)\s+(?:an?\s+)?(?:unrestricted|unfiltered|evil|malicious|DAN)/i,
    reason: "Jailbreak attempt detected",
  },
  {
    regex: /\b(?:sudo|shutdown|reboot|init\s+[0-6])\b/i,
    reason: "System administration commands blocked",
  },
  {
    regex: /(?:format|mkfs)\s+(?:c:|d:|e:|f:|\/dev\/)/i,
    reason: "Disk formatting commands blocked",
  },
];

// ── Command-level patterns ──

interface PatternEntry {
  regex: RegExp;
  reason: string;
}

const BLOCKED_PATTERNS: PatternEntry[] = [
  { regex: /rm\s+-rf\s+\//, reason: "Recursive root delete blocked (rm -rf /)" },
  { regex: /rm\s+-rf\s+\/\*/, reason: "Recursive root delete blocked" },
  { regex: /rm\s+-rf\s+~/, reason: "Home directory recursive delete blocked" },
  { regex: /rm\s+-rf\s+\$HOME/, reason: "Home directory recursive delete blocked" },
  { regex: /\bdd\s+if=/, reason: "Raw disk write blocked (dd)" },
  { regex: /\bmkfs\.?\s/, reason: "Filesystem format blocked (mkfs)" },
  { regex: />\s*\/dev\/sd[a-z]/, reason: "Block device write blocked" },
  { regex: /:\(\)\s*\{\s*:\|:&\s*\};:/, reason: "Fork bomb blocked" },
  { regex: />\s*\/etc\/(passwd|shadow|sudoers)/, reason: "System file overwrite blocked" },
  { regex: /\bchmod\s+777\s+\//, reason: "World-writable root blocked" },
  { regex: /\bcurl.*\|\s*(?:ba)?sh/, reason: "curl-pipe-bash blocked" },
  { regex: /\bwget.*-O\s*-\s*\|/, reason: "wget-pipe blocked" },
  { regex: /Remove-Item\s+.*-Recurse\s+-Path\s+[C-Z]:\\/i, reason: "PowerShell recursive delete blocked" },
  { regex: /Format-Volume\s+-DriveLetter/i, reason: "PowerShell format blocked" },
  { regex: /\bdel\s+\/[sS]\s+[C-Z]:\\/i, reason: "Windows recursive delete blocked (del /s)" },
  { regex: /\bDROP\s+(?:TABLE|DATABASE)\b/i, reason: "SQL DROP blocked" },
  { regex: /\bTRUNCATE\s+(?:TABLE\s+)?\w+/i, reason: "SQL TRUNCATE blocked" },
  { regex: /\bgit\s+push\s+.*(--force-with-lease)\s+.*production/i, reason: "Force push to production blocked" },
  { regex: /\bnpm\s+publish\s+--tag\s+latest/i, reason: "npm publish to latest blocked" },
];

const CONFIRM_PATTERNS: PatternEntry[] = [
  { regex: /git\s+push\s+.*--force/, reason: "Force push requires confirmation" },
  { regex: /git\s+push\s+.*-f\b/, reason: "Force push (-f) requires confirmation" },
  { regex: /git\s+reset\s+--hard/, reason: "Hard reset requires confirmation" },
  { regex: /git\s+clean\s+-[fdx]/, reason: "Git clean requires confirmation" },
  { regex: /\bnpm\s+publish\b/, reason: "npm publish requires confirmation" },
];

/**
 * Scan user prompt text before spawning Claude.
 * Returns whether the prompt is safe to pass to Claude.
 */
export function scanPrompt(text: string): { safe: boolean; reason?: string } {
  for (const { regex, reason } of PROMPT_BLOCKED_PATTERNS) {
    if (regex.test(text)) {
      return { safe: false, reason };
    }
  }
  return { safe: true };
}

/**
 * Scan a shell command being executed by Claude.
 * Returns whether to allow, block, or require confirmation.
 */
export function scanCommand(command: string): ScanResult {
  // Check blocked patterns first
  for (const { regex, reason } of BLOCKED_PATTERNS) {
    if (regex.test(command)) {
      return { action: "block", reason };
    }
  }

  // Check confirmation patterns
  // If ALLOW_DESTRUCTIVE_ACTIONS is true, skip confirmation
  if (appConfig.allowDestructiveActions) {
    return { action: "allow" };
  }

  for (const { regex, reason } of CONFIRM_PATTERNS) {
    if (regex.test(command)) {
      return { action: "confirm", reason };
    }
  }

  return { action: "allow" };
}
