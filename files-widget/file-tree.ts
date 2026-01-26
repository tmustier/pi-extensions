import { join } from "node:path";

import { MAX_TREE_DEPTH } from "./constants";
import type { DiffStats, FileNode, FlatNode } from "./types";

const collator = new Intl.Collator(undefined, { sensitivity: "base" });

function compareNodes(a: FileNode, b: FileNode): number {
  if (a.isDirectory !== b.isDirectory) {
    return a.isDirectory ? -1 : 1;
  }
  return collator.compare(a.name, b.name);
}

function shouldIgnoreSegment(segment: string, ignored: Set<string>): boolean {
  return ignored.has(segment) || segment.startsWith(".");
}

export function sortChildren(node: FileNode): void {
  if (!node.children || node.children.length === 0) return;
  node.children.sort(compareNodes);
}

function sortTree(node: FileNode): void {
  sortChildren(node);
  if (node.children) {
    for (const child of node.children) {
      if (child.isDirectory) {
        sortTree(child);
      }
    }
  }
}

export function updateTreeStats(root: FileNode | null): void {
  if (!root) return;

  function traverse(node: FileNode): {
    totalLines: number;
    totalAdditions: number;
    totalDeletions: number;
    lineCountComplete: boolean;
    hasChanges: boolean;
  } {
    if (!node.isDirectory) {
      const totalLines = node.lineCount ?? 0;
      const totalAdditions = node.diffStats?.additions ?? 0;
      const totalDeletions = node.diffStats?.deletions ?? 0;
      const lineCountComplete = node.lineCount !== undefined;
      const hasChanges = Boolean(node.gitStatus || node.agentModified);
      return { totalLines, totalAdditions, totalDeletions, lineCountComplete, hasChanges };
    }

    let totalLines = 0;
    let totalAdditions = 0;
    let totalDeletions = 0;
    let lineCountComplete = true;
    let hasChanges = false;

    if (node.children) {
      for (const child of node.children) {
        const stats = traverse(child);
        totalLines += stats.totalLines;
        totalAdditions += stats.totalAdditions;
        totalDeletions += stats.totalDeletions;
        if (!stats.lineCountComplete) {
          lineCountComplete = false;
        }
        if (stats.hasChanges) {
          hasChanges = true;
        }
      }
    }

    node.totalLines = totalLines;
    node.totalAdditions = totalAdditions;
    node.totalDeletions = totalDeletions;
    node.lineCountComplete = lineCountComplete;
    node.hasChangedChildren = hasChanges;

    return { totalLines, totalAdditions, totalDeletions, lineCountComplete, hasChanges };
  }

  traverse(root);
}

export function buildFileTreeFromPaths(
  cwd: string,
  filePaths: string[],
  gitStatus: Map<string, string>,
  diffStats: Map<string, DiffStats>,
  ignored: Set<string>,
  agentModified: Set<string>
): FileNode {
  const root: FileNode = {
    name: ".",
    path: cwd,
    isDirectory: true,
    children: [],
    expanded: true,
    hasChangedChildren: false,
  };

  const directoryMap = new Map<string, FileNode>();
  directoryMap.set("", root);
  const seenFiles = new Set<string>();

  for (const rawPath of filePaths) {
    let normalized = rawPath.trim();
    if (!normalized) continue;
    if (normalized.startsWith("./")) {
      normalized = normalized.slice(2);
    }
    normalized = normalized.replace(/\\/g, "/");

    const parts = normalized.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    const dirDepth = parts.length - 1;
    if (dirDepth > MAX_TREE_DEPTH) continue;

    let current = root;
    let relPath = "";
    let skip = false;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (shouldIgnoreSegment(part, ignored)) {
        skip = true;
        break;
      }
      relPath = relPath ? `${relPath}/${part}` : part;
      let dirNode = directoryMap.get(relPath);
      if (!dirNode) {
        const depth = i + 1;
        dirNode = {
          name: part,
          path: join(cwd, relPath),
          isDirectory: true,
          children: [],
          expanded: depth < 1,
          hasChangedChildren: false,
        };
        directoryMap.set(relPath, dirNode);
        current.children?.push(dirNode);
      }
      current = dirNode;
    }

    if (skip) continue;

    const fileName = parts[parts.length - 1];
    if (shouldIgnoreSegment(fileName, ignored)) continue;

    const fileRelPath = parts.join("/");
    if (seenFiles.has(fileRelPath)) continue;
    seenFiles.add(fileRelPath);

    const filePath = join(cwd, fileRelPath);
    const fileGitStatus = gitStatus.get(fileRelPath);
    const fileDiffStats = diffStats.get(fileRelPath);

    current.children?.push({
      name: fileName,
      path: filePath,
      isDirectory: false,
      gitStatus: fileGitStatus,
      agentModified: agentModified.has(filePath),
      diffStats: fileDiffStats,
    });
  }

  sortTree(root);
  updateTreeStats(root);
  return root;
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
