import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

import { MAX_LINE_COUNT_BYTES, MAX_TREE_DEPTH } from "./constants";
import type { DiffStats, FileNode, FlatNode } from "./types";

const lineCountCache = new Map<string, { mtimeMs: number; size: number; count: number }>();

export function getFileLineCount(filePath: string, size: number, mtimeMs: number): number | undefined {
  const cached = lineCountCache.get(filePath);
  if (cached && cached.size === size && cached.mtimeMs === mtimeMs) {
    return cached.count;
  }

  if (size > MAX_LINE_COUNT_BYTES) {
    return undefined;
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const count = content.split("\n").length;
    lineCountCache.set(filePath, { mtimeMs, size, count });
    return count;
  } catch {
    return undefined;
  }
}

export function getIgnoredNames(): Set<string> {
  return new Set([
    "node_modules",
    ".git",
    ".DS_Store",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".next",
    ".nuxt",
    "dist",
    "build",
    ".venv",
    "venv",
    ".env",
    "coverage",
    ".nyc_output",
    ".turbo",
    ".cache",
  ]);
}

export function buildFileTree(
  dir: string,
  cwd: string,
  gitStatus: Map<string, string>,
  diffStats: Map<string, DiffStats>,
  ignored: Set<string>,
  agentModified: Set<string>,
  depth = 0
): FileNode | null {
  if (depth > MAX_TREE_DEPTH) return null;

  const name = basename(dir) || dir;
  if (ignored.has(name)) return null;

  const node: FileNode = {
    name: depth === 0 ? "." : name,
    path: dir,
    isDirectory: true,
    children: [],
    expanded: depth < 1,
    hasChangedChildren: false,
  };

  try {
    const entries = readdirSync(dir);
    const dirs: FileNode[] = [];
    const files: FileNode[] = [];

    for (const entry of entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))) {
      if (ignored.has(entry) || entry.startsWith(".")) continue;

      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        const child = buildFileTree(fullPath, cwd, gitStatus, diffStats, ignored, agentModified, depth + 1);
        if (child) {
          dirs.push(child);
          // Propagate hasChangedChildren up
          if (child.hasChangedChildren || child.gitStatus) {
            node.hasChangedChildren = true;
          }
        }
      } else {
        const relPath = relative(cwd, fullPath);
        const fileGitStatus = gitStatus.get(relPath);
        const fileDiffStats = diffStats.get(relPath);

        if (fileGitStatus) {
          node.hasChangedChildren = true;
        }

        files.push({
          name: entry,
          path: fullPath,
          isDirectory: false,
          gitStatus: fileGitStatus,
          agentModified: agentModified.has(fullPath),
          lineCount: getFileLineCount(fullPath, stat.size, stat.mtimeMs),
          diffStats: fileDiffStats,
        });
      }
    }

    node.children = [...dirs, ...files];

    // Calculate aggregated stats for this directory
    let totalLines = 0;
    let totalAdditions = 0;
    let totalDeletions = 0;
    let lineCountComplete = true;

    for (const child of node.children) {
      if (child.isDirectory) {
        totalLines += child.totalLines ?? 0;
        totalAdditions += child.totalAdditions ?? 0;
        totalDeletions += child.totalDeletions ?? 0;
        if (child.lineCountComplete === false) {
          lineCountComplete = false;
        }
      } else {
        if (child.lineCount === undefined) {
          lineCountComplete = false;
        } else {
          totalLines += child.lineCount;
        }
        if (child.diffStats) {
          totalAdditions += child.diffStats.additions;
          totalDeletions += child.diffStats.deletions;
        }
      }
    }

    node.totalLines = totalLines;
    node.totalAdditions = totalAdditions;
    node.totalDeletions = totalDeletions;
    node.lineCountComplete = lineCountComplete;
  } catch {}

  return node;
}

export function flattenTree(
  node: FileNode,
  depth = 0,
  isRoot = true,
  includeCollapsed = false
): FlatNode[] {
  const result: FlatNode[] = [];

  // Skip the root "." node itself, just process its children
  if (isRoot && node.name === ".") {
    for (const child of node.children || []) {
      result.push(...flattenTree(child, 0, false, includeCollapsed));
    }
    return result;
  }

  result.push({ node, depth });

  if (node.isDirectory && node.children && (includeCollapsed || node.expanded)) {
    for (const child of node.children) {
      result.push(...flattenTree(child, depth + 1, false, includeCollapsed));
    }
  }

  return result;
}
