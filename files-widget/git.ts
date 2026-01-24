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

export function getGitStatus(cwd: string): Map<string, string> {
  const status = new Map<string, string>();
  try {
    // Include ignored files with --ignored flag
    const output = execSync("git status --porcelain --ignored", { cwd, encoding: "utf-8", timeout: 5000, stdio: "pipe" });
    for (const line of output.split("\n")) {
      if (line.length < 3) continue;
      const statusCode = line.slice(0, 2).trim() || "?";
      const filePath = line.slice(3);
      status.set(filePath, statusCode);
    }
  } catch {}
  return status;
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
