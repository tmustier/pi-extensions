import { execFile, execSync } from "node:child_process";
import { promisify } from "node:util";

import type { DiffStats } from "./types";

const execFileAsync = promisify(execFile);

export function isGitRepo(cwd: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd, encoding: "utf-8", timeout: 2000, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/** Run git without blocking the event loop. */
async function git(cwd: string, args: string[], timeout = 5000): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf-8", timeout });
  return stdout;
}

/**
 * Path of `cwd` relative to the repository top-level (e.g. "app/"), or "" when
 * `cwd` is the top-level itself. `git status --porcelain` reports paths relative
 * to the repository root, while `git ls-files` (and this widget's node keys) are
 * relative to `cwd` — this prefix lets us translate between the two.
 */
async function getGitPathPrefix(cwd: string): Promise<string> {
  try {
    return (await git(cwd, ["rev-parse", "--show-prefix"], 2000)).trim();
  } catch {
    return "";
  }
}

/** Convert a repo-root-relative path to a cwd-relative one; null if outside cwd. */
function stripPathPrefix(filePath: string, prefix: string): string | null {
  if (!prefix) return filePath;
  if (filePath.startsWith(prefix)) return filePath.slice(prefix.length);
  return null;
}

export async function getGitStatus(cwd: string): Promise<Map<string, string>> {
  const status = new Map<string, string>();
  try {
    const [prefix, output] = await Promise.all([getGitPathPrefix(cwd), git(cwd, ["status", "--porcelain", "--ignored"])]);
    for (const line of output.split("\n")) {
      if (line.length < 3) continue;
      const statusCode = line.slice(0, 2).trim() || "?";
      const filePath = stripPathPrefix(line.slice(3), prefix);
      if (filePath === null || !filePath) continue;
      status.set(filePath, statusCode);
    }
  } catch {}
  return status;
}

export async function getGitFileList(cwd: string): Promise<string[]> {
  const [tracked, prefix, statusOutput] = await Promise.all([
    git(cwd, ["ls-files", "-z"]).catch(() => ""),
    getGitPathPrefix(cwd),
    git(cwd, ["status", "--porcelain", "-uall", "-z"]).catch(() => ""),
  ]);
  const files = new Set<string>();
  for (const entry of tracked.split("\0")) {
    if (entry) files.add(entry);
  }

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
    const relPath = filePath ? stripPathPrefix(filePath, prefix) : null;
    if (relPath) {
      files.add(relPath);
    }
  }

  return Array.from(files);
}

export async function getGitBranch(cwd: string): Promise<string> {
  try {
    return (await git(cwd, ["branch", "--show-current"], 2000)).trim();
  } catch {
    return "";
  }
}

export async function getGitDiffStats(cwd: string): Promise<Map<string, DiffStats>> {
  const stats = new Map<string, DiffStats>();
  try {
    // Unstaged and staged changes. --relative keeps paths relative to cwd (and
    // scoped to it) so they match the widget's cwd-relative node keys even when
    // cwd is a subdirectory of the repository.
    const outputs = await Promise.all([
      git(cwd, ["diff", "--relative", "--numstat", "HEAD"]),
      git(cwd, ["diff", "--relative", "--numstat", "--cached"]),
    ]);
    for (const output of outputs) {
      for (const line of output.split("\n")) {
        const parts = line.split("\t");
        if (parts.length < 3) continue;
        const additions = parseInt(parts[0], 10) || 0;
        const deletions = parseInt(parts[1], 10) || 0;
        const existing = stats.get(parts[2]);
        stats.set(parts[2], {
          additions: (existing?.additions ?? 0) + additions,
          deletions: (existing?.deletions ?? 0) + deletions,
        });
      }
    }
  } catch {}
  return stats;
}
