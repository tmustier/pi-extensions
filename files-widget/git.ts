import { execSync } from "node:child_process";

import type { DiffStats } from "./types";

export function isGitRepo(cwd: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd, encoding: "utf-8", timeout: 2000, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function getGitStatus(cwd: string, options: { includeIgnored?: boolean } = {}): Map<string, string> {
  const status = new Map<string, string>();
  try {
    const flags = ["--porcelain"];
    if (options.includeIgnored !== false) {
      flags.push("--ignored");
    }
    const output = execSync(`git status ${flags.join(" ")}`, { cwd, encoding: "utf-8", timeout: 5000, stdio: "pipe" });
    for (const line of output.split("\n")) {
      if (line.length < 3) continue;
      const statusCode = line.slice(0, 2).trim() || "?";
      const filePath = line.slice(3);
      status.set(filePath, statusCode);
    }
  } catch {}
  return status;
}

export function getGitFileList(cwd: string): string[] {
  const files = new Set<string>();
  try {
    const tracked = execSync("git ls-files -z", { cwd, encoding: "utf-8", timeout: 5000, stdio: "pipe" });
    for (const entry of tracked.split("\0")) {
      if (entry) files.add(entry);
    }
  } catch {}

  try {
    const statusOutput = execSync("git status --porcelain -uall -z", { cwd, encoding: "utf-8", timeout: 5000, stdio: "pipe" });
    const entries = statusOutput.split("\0");
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;
      const statusCode = entry.slice(0, 2).trim();
      let filePath = entry.slice(3);
      if ((statusCode.startsWith("R") || statusCode.startsWith("C")) && entries[i + 1]) {
        i += 1;
        filePath = entries[i];
      } else if (filePath.includes(" -> ")) {
        filePath = filePath.split(" -> ").pop() || filePath;
      }
      if (filePath) {
        files.add(filePath);
      }
    }
  } catch {}

  return Array.from(files);
}

export function getGitBranch(cwd: string): string {
  try {
    return execSync("git branch --show-current", { cwd, encoding: "utf-8", timeout: 2000, stdio: "pipe" }).trim();
  } catch {
    return "";
  }
}

export function getGitDiffStats(cwd: string): Map<string, DiffStats> {
  const stats = new Map<string, DiffStats>();
  try {
    // Get diff stats for modified files
    const output = execSync("git diff --numstat HEAD", { cwd, encoding: "utf-8", timeout: 5000, stdio: "pipe" });
    for (const line of output.split("\n")) {
      const parts = line.split("\t");
      if (parts.length >= 3) {
        const additions = parseInt(parts[0], 10) || 0;
        const deletions = parseInt(parts[1], 10) || 0;
        const filePath = parts[2];
        stats.set(filePath, { additions, deletions });
      }
    }
    // Also get stats for staged files
    const stagedOutput = execSync("git diff --numstat --cached", { cwd, encoding: "utf-8", timeout: 5000, stdio: "pipe" });
    for (const line of stagedOutput.split("\n")) {
      const parts = line.split("\t");
      if (parts.length >= 3) {
        const additions = parseInt(parts[0], 10) || 0;
        const deletions = parseInt(parts[1], 10) || 0;
        const filePath = parts[2];
        const existing = stats.get(filePath);
        if (existing) {
          stats.set(filePath, {
            additions: existing.additions + additions,
            deletions: existing.deletions + deletions,
          });
        } else {
          stats.set(filePath, { additions, deletions });
        }
      }
    }
  } catch {}
  return stats;
}
