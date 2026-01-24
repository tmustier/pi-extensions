/**
 * Pi Editor Extension
 *
 * Provides an in-terminal file browser, viewer, and review workflow.
 * Use /files to open the file browser, navigate with j/k, Enter to view.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, Text, matchesKey, Key, truncateToWidth } from "@mariozechner/pi-tui";
import { execSync, spawnSync } from "node:child_process";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, basename } from "node:path";

// =============================================================================
// Types
// =============================================================================

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
  expanded?: boolean;
  gitStatus?: string;
  agentModified?: boolean;
  lineCount?: number;
  diffStats?: DiffStats;
  hasChangedChildren?: boolean; // For directories
  // Aggregated stats for directories
  totalLines?: number;
  totalAdditions?: number;
  totalDeletions?: number;
}

interface FlatNode {
  node: FileNode;
  depth: number;
}

// =============================================================================
// Utility Functions
// =============================================================================

function hasCommand(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function isGitRepo(cwd: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd, encoding: "utf-8", timeout: 2000, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function getGitStatus(cwd: string): Map<string, string> {
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

function getGitBranch(cwd: string): string {
  try {
    return execSync("git branch --show-current", { cwd, encoding: "utf-8", timeout: 2000, stdio: "pipe" }).trim();
  } catch {
    return "";
  }
}

interface DiffStats {
  additions: number;
  deletions: number;
}

function getGitDiffStats(cwd: string): Map<string, DiffStats> {
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
            deletions: existing.deletions + deletions 
          });
        } else {
          stats.set(filePath, { additions, deletions });
        }
      }
    }
  } catch {}
  return stats;
}

function getFileLineCount(filePath: string): number {
  try {
    const content = readFileSync(filePath, "utf-8");
    return content.split("\n").length;
  } catch {
    return 0;
  }
}

function getIgnoredNames(): Set<string> {
  return new Set([
    "node_modules", ".git", ".DS_Store", "__pycache__", ".pytest_cache",
    ".mypy_cache", ".next", ".nuxt", "dist", "build", ".venv", "venv",
    ".env", "coverage", ".nyc_output", ".turbo", ".cache",
  ]);
}



function buildFileTree(
  dir: string,
  cwd: string,
  gitStatus: Map<string, string>,
  diffStats: Map<string, DiffStats>,
  ignored: Set<string>,
  agentModified: Set<string>,
  depth = 0
): FileNode | null {
  if (depth > 6) return null;

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
          lineCount: getFileLineCount(fullPath),
          diffStats: fileDiffStats,
        });
      }
    }

    node.children = [...dirs, ...files];
    
    // Calculate aggregated stats for this directory
    let totalLines = 0;
    let totalAdditions = 0;
    let totalDeletions = 0;
    
    for (const child of node.children) {
      if (child.isDirectory) {
        totalLines += child.totalLines || 0;
        totalAdditions += child.totalAdditions || 0;
        totalDeletions += child.totalDeletions || 0;
      } else {
        totalLines += child.lineCount || 0;
        if (child.diffStats) {
          totalAdditions += child.diffStats.additions;
          totalDeletions += child.diffStats.deletions;
        }
      }
    }
    
    node.totalLines = totalLines;
    node.totalAdditions = totalAdditions;
    node.totalDeletions = totalDeletions;
  } catch {}

  return node;
}

function flattenTree(node: FileNode, depth = 0, isRoot = true): FlatNode[] {
  const result: FlatNode[] = [];

  // Skip the root "." node itself, just process its children
  if (isRoot && node.name === ".") {
    for (const child of node.children || []) {
      result.push(...flattenTree(child, 0, false));
    }
    return result;
  }

  result.push({ node, depth });

  if (node.isDirectory && node.expanded && node.children) {
    for (const child of node.children) {
      result.push(...flattenTree(child, depth + 1, false));
    }
  }

  return result;
}

function loadFileContent(filePath: string, cwd: string, diffMode: boolean, hasChanges: boolean, width?: number): string[] {
  const isMarkdown = filePath.endsWith(".md");
  const termWidth = width || process.stdout.columns || 80;

  try {
    if (diffMode && hasChanges && isGitRepo(cwd)) {
      try {
        // Try different diff strategies
        let diffOutput = "";
        
        // First try: unstaged changes
        const unstaged = execSync(`git diff -- "${filePath}"`, { cwd, encoding: "utf-8", timeout: 10000, stdio: "pipe" });
        if (unstaged.trim()) {
          diffOutput = unstaged;
        } else {
          // Second try: staged changes
          const staged = execSync(`git diff --cached -- "${filePath}"`, { cwd, encoding: "utf-8", timeout: 10000, stdio: "pipe" });
          if (staged.trim()) {
            diffOutput = staged;
          } else {
            // Third try: diff against HEAD (for new files that are staged)
            const headDiff = execSync(`git diff HEAD -- "${filePath}"`, { cwd, encoding: "utf-8", timeout: 10000, stdio: "pipe" });
            if (headDiff.trim()) {
              diffOutput = headDiff;
            }
          }
        }
        
        if (!diffOutput.trim()) {
          return ["No diff available - file may be untracked or unchanged"];
        }
        
        if (hasCommand("delta")) {
          // Pipe through delta with line numbers for better readability
          try {
            const deltaOutput = execSync(
              `delta --no-gitconfig --width=${termWidth} --line-numbers`, 
              { 
                cwd, 
                encoding: "utf-8", 
                timeout: 10000,
                input: diffOutput,
                stdio: ["pipe", "pipe", "pipe"],
              }
            );
            // Remove leading empty lines
            const lines = deltaOutput.split("\n");
            let startIdx = 0;
            while (startIdx < lines.length && !lines[startIdx].trim()) {
              startIdx++;
            }
            return lines.slice(startIdx);
          } catch {
            // Fall back to raw diff
          }
        }
        
        return diffOutput.split("\n");
      } catch (e: any) {
        return [`Diff error: ${e.message}`];
      }
    }

    if (isMarkdown && hasCommand("glow")) {
      try {
        const output = execSync(`glow -s dark -w ${termWidth} "${filePath}"`, { encoding: "utf-8", timeout: 10000 });
        if (output.trim()) {
          // Remove leading empty lines from glow output
          const lines = output.split("\n");
          let startIdx = 0;
          while (startIdx < lines.length && !lines[startIdx].trim()) {
            startIdx++;
          }
          return lines.slice(startIdx);
        }
      } catch {
        // Fall through to bat
      }
    }

    if (hasCommand("bat")) {
      return execSync(
        `bat --style=numbers --color=always --paging=never --wrap=auto --terminal-width=${termWidth} "${filePath}"`,
        { encoding: "utf-8", timeout: 10000 }
      ).split("\n");
    }

    const raw = readFileSync(filePath, "utf-8");
    return raw.split("\n").map((line, i) => `${String(i + 1).padStart(4)} │ ${line}`);
  } catch (e: any) {
    return [`Error loading file: ${e.message}`];
  }
}

// =============================================================================
// File Browser Component
// =============================================================================

function createFileBrowser(
  cwd: string,
  agentModifiedFiles: Set<string>,
  theme: Theme,
  pi: ExtensionAPI,
  onClose: () => void
) {
  let gitStatus = getGitStatus(cwd);
  let diffStats = getGitDiffStats(cwd);
  const gitBranch = getGitBranch(cwd);
  const ignored = getIgnoredNames();
  let root = buildFileTree(cwd, cwd, gitStatus, diffStats, ignored, agentModifiedFiles);
  let flatList = root ? flattenTree(root) : [];
  let selectedIndex = 0;
  let searchQuery = "";
  let searchMode = false;
  
  // Polling for git status updates
  let lastPollTime = Date.now();
  const POLL_INTERVAL = 3000; // 3 seconds
  
  function refreshGitStatus(): void {
    const currentPath = flatList[selectedIndex]?.node.path;
    const viewingFilePath = viewingFile?.path;
    
    // Capture current expansion state
    const expandedPaths = new Set<string>();
    function captureExpanded(node: FileNode): void {
      if (node.isDirectory && node.expanded) {
        expandedPaths.add(node.path);
      }
      if (node.children) {
        for (const child of node.children) {
          captureExpanded(child);
        }
      }
    }
    if (root) captureExpanded(root);
    
    gitStatus = getGitStatus(cwd);
    diffStats = getGitDiffStats(cwd);
    root = buildFileTree(cwd, cwd, gitStatus, diffStats, ignored, agentModifiedFiles);
    
    // Restore expansion state
    function restoreExpanded(node: FileNode): void {
      if (node.isDirectory) {
        node.expanded = expandedPaths.has(node.path);
      }
      if (node.children) {
        for (const child of node.children) {
          restoreExpanded(child);
        }
      }
    }
    if (root) restoreExpanded(root);
    
    flatList = root ? flattenTree(root) : [];
    
    // Try to preserve selection
    if (currentPath) {
      const newIdx = flatList.findIndex(f => f.node.path === currentPath);
      if (newIdx !== -1) {
        selectedIndex = newIdx;
      }
    }
    selectedIndex = Math.min(selectedIndex, Math.max(0, flatList.length - 1));
    
    // Update viewingFile reference if we're viewing a file (search entire tree, not just flatList)
    if (viewingFilePath && root) {
      function findNode(node: FileNode): FileNode | null {
        if (node.path === viewingFilePath) return node;
        if (node.children) {
          for (const child of node.children) {
            const found = findNode(child);
            if (found) return found;
          }
        }
        return null;
      }
      const newNode = findNode(root);
      if (newNode) {
        viewingFile = newNode;
      }
    }
  }

  // Viewer state
  let viewingFile: FileNode | null = null;
  let viewerContent: string[] = [];
  let viewerRawContent = "";
  let viewerScroll = 0;
  let viewerDiffMode = false;
  let selectMode = false;
  let selectStart = 0;
  let selectEnd = 0;
  let viewerSearchMode = false;
  let viewerSearchQuery = "";
  let viewerSearchMatches: number[] = []; // Line indices with matches
  let viewerSearchIndex = 0; // Current match index

  // UI state
  let viewerHeight = 18;
  let browserHeight = 15;
  let showOnlyChanged = false;

  function getDisplayList(): FlatNode[] {
    let list = flatList;
    
    // Filter to only changed files if toggled
    if (showOnlyChanged) {
      list = list.filter(f => 
        f.node.gitStatus || 
        f.node.agentModified || 
        (f.node.isDirectory && f.node.hasChangedChildren)
      );
    }
    
    // Apply search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(f => f.node.name.toLowerCase().includes(q));
    }
    
    return list;
  }
  
  // Collect all changed files from tree (regardless of expansion state)
  function getAllChangedFiles(node: FileNode, path: FileNode[] = []): { file: FileNode; ancestors: FileNode[] }[] {
    const results: { file: FileNode; ancestors: FileNode[] }[] = [];
    
    if (!node.isDirectory && (node.gitStatus || node.agentModified)) {
      results.push({ file: node, ancestors: [...path] });
    }
    
    if (node.children) {
      for (const child of node.children) {
        results.push(...getAllChangedFiles(child, [...path, node]));
      }
    }
    
    return results;
  }
  
  // Calculate total stats for the project (traverses entire tree)
  function getTotalStats(): { totalLines: number; additions: number; deletions: number } {
    let totalLines = 0;
    let additions = 0;
    let deletions = 0;
    
    function traverse(node: FileNode): void {
      if (!node.isDirectory) {
        totalLines += node.lineCount || 0;
        if (node.diffStats) {
          additions += node.diffStats.additions;
          deletions += node.diffStats.deletions;
        }
      }
      if (node.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    }
    
    if (root) traverse(root);
    return { totalLines, additions, deletions };
  }
  
  // Collapse all directories except those in the given set
  function collapseAllExcept(node: FileNode, keep: Set<FileNode>): void {
    if (node.isDirectory) {
      node.expanded = keep.has(node);
      if (node.children) {
        for (const child of node.children) {
          collapseAllExcept(child, keep);
        }
      }
    }
  }
  
  function navigateToChange(direction: 1 | -1): void {
    if (!root) return;
    
    const changedFiles = getAllChangedFiles(root);
    if (changedFiles.length === 0) return;
    
    // Find current file in changed list
    const displayList = getDisplayList();
    const currentNode = displayList[selectedIndex]?.node;
    
    let currentIdx = -1;
    if (currentNode && !currentNode.isDirectory) {
      currentIdx = changedFiles.findIndex(c => c.file.path === currentNode.path);
    }
    
    // Calculate next index
    let nextIdx: number;
    if (currentIdx === -1) {
      // Not on a changed file, go to first (or last if going backwards)
      nextIdx = direction === 1 ? 0 : changedFiles.length - 1;
    } else {
      nextIdx = currentIdx + direction;
      if (nextIdx < 0) nextIdx = changedFiles.length - 1; // Wrap around
      if (nextIdx >= changedFiles.length) nextIdx = 0;
    }
    
    const target = changedFiles[nextIdx];
    
    // Collapse all folders, then expand only ancestors of target
    const ancestorSet = new Set(target.ancestors);
    collapseAllExcept(root, ancestorSet);
    
    // Expand all ancestors
    for (const ancestor of target.ancestors) {
      ancestor.expanded = true;
    }
    
    // Rebuild flat list
    flatList = flattenTree(root);
    
    // Find target in new display list and select it
    const newDisplayList = getDisplayList();
    const targetIdx = newDisplayList.findIndex(f => f.node.path === target.file.path);
    if (targetIdx !== -1) {
      selectedIndex = targetIdx;
    }
  }

  function toggleDir(node: FileNode): void {
    if (node.isDirectory) {
      node.expanded = !node.expanded;
      flatList = root ? flattenTree(root) : [];
    }
  }

  let lastRenderWidth = 0;

  function openFile(node: FileNode): void {
    viewingFile = node;
    viewerScroll = 0;
    // Default to diff mode if file has tracked changes (not untracked files)
    const isUntracked = node.gitStatus === "?" || node.gitStatus === "??";
    viewerDiffMode = !!node.gitStatus && !isUntracked;
    selectMode = false;
    viewerContent = []; // Will be loaded on first render with correct width
    lastRenderWidth = 0; // Force reload
    try {
      viewerRawContent = readFileSync(node.path, "utf-8");
    } catch {
      viewerRawContent = "";
    }
  }

  function reloadViewerContent(width: number): void {
    if (!viewingFile) return;
    const hasChanges = !!viewingFile.gitStatus;
    viewerContent = loadFileContent(viewingFile.path, cwd, viewerDiffMode, hasChanges, width);
    lastRenderWidth = width;
  }

  function closeViewer(): void {
    viewingFile = null;
    viewerContent = [];
    selectMode = false;
    viewerSearchMode = false;
    viewerSearchQuery = "";
    viewerSearchMatches = [];
  }

  function updateViewerSearch(): void {
    viewerSearchMatches = [];
    if (!viewerSearchQuery) return;
    
    const q = viewerSearchQuery.toLowerCase();
    // Search in raw content (without ANSI codes) for better matching
    const rawLines = viewerRawContent.split("\n");
    for (let i = 0; i < rawLines.length; i++) {
      if (rawLines[i].toLowerCase().includes(q)) {
        viewerSearchMatches.push(i);
      }
    }
    viewerSearchIndex = 0;
    
    // Jump to first match
    if (viewerSearchMatches.length > 0) {
      viewerScroll = Math.max(0, viewerSearchMatches[0] - 3);
    }
  }

  function jumpToNextMatch(direction: 1 | -1): void {
    if (viewerSearchMatches.length === 0) return;
    viewerSearchIndex += direction;
    if (viewerSearchIndex < 0) viewerSearchIndex = viewerSearchMatches.length - 1;
    if (viewerSearchIndex >= viewerSearchMatches.length) viewerSearchIndex = 0;
    viewerScroll = Math.max(0, viewerSearchMatches[viewerSearchIndex] - 3);
  }

  function sendComment(): void {
    if (!viewingFile || !selectMode) return;

    const rawLines = viewerRawContent.split("\n");
    const selectedText = rawLines.slice(selectStart, selectEnd + 1).join("\n");
    const relPath = relative(cwd, viewingFile.path);
    const lineRange = selectStart === selectEnd
      ? `line ${selectStart + 1}`
      : `lines ${selectStart + 1}-${selectEnd + 1}`;
    const ext = viewingFile.name.split(".").pop() || "";

    const message = `In \`${relPath}\` (${lineRange}):
\`\`\`${ext}
${selectedText}
\`\`\`

`;

    onClose();
    setTimeout(() => {
      pi.sendUserMessage(message, { deliverAs: "steer" });
    }, 100);
  }

  return {
    render(width: number): string[] {
      // Poll for git status updates every 3 seconds
      const now = Date.now();
      if (now - lastPollTime > POLL_INTERVAL) {
        lastPollTime = now;
        refreshGitStatus();
      }
      
      const lines: string[] = [];

      if (viewingFile) {
        // ===== FILE VIEWER =====
        // Reload content if width changed or not loaded yet
        if (lastRenderWidth !== width || viewerContent.length === 0) {
          reloadViewerContent(width);
        }

        // Header with file stats
        const isUntracked = viewingFile.gitStatus === "?" || viewingFile.gitStatus === "??";
        let header = theme.bold(viewingFile.name);
        if (isUntracked) {
          header += theme.fg("dim", " [UNTRACKED]");
        } else if (viewerDiffMode) {
          header += theme.fg("warning", " [DIFF]");
        }
        if (selectMode) {
          header += theme.fg("accent", ` [SELECT ${selectStart + 1}-${selectEnd + 1}]`);
        }
        // Show diff stats and line count
        if (viewingFile.diffStats) {
          if (viewingFile.diffStats.additions > 0) {
            header += theme.fg("success", ` +${viewingFile.diffStats.additions}`);
          }
          if (viewingFile.diffStats.deletions > 0) {
            header += theme.fg("error", ` -${viewingFile.diffStats.deletions}`);
          }
        } else if (isUntracked && viewingFile.lineCount) {
          // For untracked files, show line count as additions
          header += theme.fg("success", ` +${viewingFile.lineCount}`);
        }
        if (viewingFile.lineCount) {
          header += theme.fg("dim", ` ${viewingFile.lineCount}L`);
        }
        // Show search indicator
        if (viewerSearchMode) {
          header += theme.fg("accent", `  /${viewerSearchQuery}█`);
        } else if (viewerSearchQuery && viewerSearchMatches.length > 0) {
          header += theme.fg("dim", ` [${viewerSearchIndex + 1}/${viewerSearchMatches.length}]`);
        }
        lines.push(truncateToWidth(header, width));
        lines.push(theme.fg("borderMuted", "─".repeat(width)));

        // Content - bat handles wrapping, just output lines
        const visible = viewerContent.slice(viewerScroll, viewerScroll + viewerHeight);
        for (let i = 0; i < viewerHeight; i++) {
          if (i < visible.length) {
            const lineIdx = viewerScroll + i;
            let line = truncateToWidth(visible[i] || "", width);
            if (selectMode && lineIdx >= selectStart && lineIdx <= selectEnd) {
              line = theme.bg("selectedBg", line);
            }
            lines.push(line);
          } else {
            lines.push(theme.fg("dim", "~"));
          }
        }

        // Footer
        lines.push(theme.fg("borderMuted", "─".repeat(width)));
        const pct = viewerContent.length > 0 
          ? Math.round((viewerScroll / Math.max(1, viewerContent.length - viewerHeight)) * 100) 
          : 0;
        let help: string;
        if (selectMode) {
          help = theme.fg("dim", "j/k: extend  c: comment  Esc: cancel");
        } else if (viewerSearchMode) {
          help = theme.fg("dim", "Type to search  Enter: confirm  Esc: cancel");
        } else {
          help = theme.fg("dim", `j/k: scroll  /: search  n/N: next/prev match  []: files  ${viewingFile.gitStatus && !isUntracked ? "d: diff  " : ""}q: back  ${pct}%`);
        }
        lines.push(truncateToWidth(help, width));

      } else {
        // ===== FILE BROWSER =====

        // Header with path, branch, and total stats
        const pathDisplay = basename(cwd);
        const branchDisplay = gitBranch ? theme.fg("accent", ` (${gitBranch})`) : "";
        const stats = getTotalStats();
        let statsDisplay = theme.fg("dim", ` ${stats.totalLines}L`);
        if (stats.additions > 0 || stats.deletions > 0) {
          if (stats.additions > 0) statsDisplay += theme.fg("success", ` +${stats.additions}`);
          if (stats.deletions > 0) statsDisplay += theme.fg("error", ` -${stats.deletions}`);
        }
        const searchIndicator = searchMode
          ? theme.fg("accent", `  /${searchQuery}█`)
          : "";
        lines.push(truncateToWidth(theme.bold(pathDisplay) + branchDisplay + statsDisplay + searchIndicator, width));
        lines.push(theme.fg("borderMuted", "─".repeat(width)));

        const displayList = getDisplayList();
        if (displayList.length === 0) {
          lines.push(theme.fg("dim", "  (no files" + (searchQuery ? " matching '" + searchQuery + "'" : "") + ")"));
          // Fill to maintain height
          for (let i = 1; i < browserHeight; i++) {
            lines.push("");
          }
        } else {
          // Calculate viewport - always show browserHeight lines
          const start = Math.max(0, Math.min(selectedIndex - Math.floor(browserHeight / 2), displayList.length - browserHeight));
          const end = Math.min(displayList.length, start + browserHeight);

          for (let i = start; i < end; i++) {
            const { node, depth } = displayList[i];
            const isSelected = i === selectedIndex;
            const indent = "  ".repeat(depth);
            const icon = node.isDirectory 
              ? (node.expanded ? "▼ " : "▶ ") 
              : "  ";

            // Check if ignored
            const isIgnored = node.gitStatus === "!" || node.gitStatus === "!!";

            // Build status indicator
            let status = "";
            if (isIgnored) {
              // No status indicator for ignored files
            } else if (node.agentModified) {
              status = theme.fg("accent", " 🤖");
            } else if (node.gitStatus === "M" || node.gitStatus === "MM") {
              status = theme.fg("warning", " M");
            } else if (node.gitStatus === "?" || node.gitStatus === "??") {
              status = theme.fg("dim", " ?");
            } else if (node.gitStatus === "A") {
              status = theme.fg("success", " A");
            } else if (node.gitStatus === "D") {
              status = theme.fg("error", " D");
            }

            // File/folder metadata: +/- diff stats and total line count
            let meta = "";
            if (!isIgnored) {
              const parts: string[] = [];
              
              if (node.isDirectory && !node.expanded) {
                // Directory stats (only when collapsed - expanded would be duplicative)
                if (node.totalAdditions && node.totalAdditions > 0) {
                  parts.push(theme.fg("success", `+${node.totalAdditions}`));
                }
                if (node.totalDeletions && node.totalDeletions > 0) {
                  parts.push(theme.fg("error", `-${node.totalDeletions}`));
                }
                if (node.totalLines) {
                  parts.push(theme.fg("dim", `${node.totalLines}L`));
                }
              } else if (!node.isDirectory) {
                // File stats
                if (node.diffStats) {
                  // Tracked file with changes - show +/- 
                  if (node.diffStats.additions > 0) {
                    parts.push(theme.fg("success", `+${node.diffStats.additions}`));
                  }
                  if (node.diffStats.deletions > 0) {
                    parts.push(theme.fg("error", `-${node.diffStats.deletions}`));
                  }
                } else if ((node.gitStatus === "?" || node.gitStatus === "??") && node.lineCount) {
                  // Untracked file - show line count as additions
                  parts.push(theme.fg("success", `+${node.lineCount}`));
                }
                // Always show total line count for files
                if (node.lineCount) {
                  parts.push(theme.fg("dim", `${node.lineCount}L`));
                }
              }
              
              if (parts.length > 0) {
                meta = " " + parts.join(" ");
              }
            }

            // Style the name
            let name = node.name;
            if (isIgnored) {
              // Ignored files get dim name
              name = theme.fg("dim", name);
            } else if (node.isDirectory) {
              if (node.hasChangedChildren) {
                name = theme.fg("warning", name);
              } else {
                name = theme.fg("accent", name);
              }
            } else if (node.gitStatus) {
              name = theme.fg("warning", name);
            }

            let line = `${indent}${icon}${name}${status}${meta}`;
            
            // Truncate to width
            line = truncateToWidth(line, width);
            
            if (isSelected) {
              line = theme.bg("selectedBg", line);
            }
            
            lines.push(line);
          }

          // Fill remaining lines to maintain consistent height
          const renderedCount = end - start;
          for (let i = renderedCount; i < browserHeight; i++) {
            lines.push("");
          }

          // Scroll position indicator (always show to maintain height)
          const pct = displayList.length > 1 
            ? Math.round((selectedIndex / (displayList.length - 1)) * 100) 
            : 100;
          lines.push(theme.fg("dim", `  ${selectedIndex + 1}/${displayList.length} (${pct}%)`));
        }

        // Footer
        lines.push(theme.fg("borderMuted", "─".repeat(width)));
        const changedIndicator = showOnlyChanged ? theme.fg("warning", " [changed only]") : "";
        const help = searchMode
          ? theme.fg("dim", "Type to search  ↑↓: nav  Enter: confirm  Esc: cancel")
          : theme.fg("dim", "j/k: nav  []: next/prev change  c: toggle changed  /: search  q: close") + changedIndicator;
        lines.push(truncateToWidth(help, width));
      }

      return lines;
    },

    handleInput(data: string): void {
      if (viewingFile) {
        // ===== FILE VIEWER INPUT =====
        
        // Handle search mode first
        if (viewerSearchMode) {
          if (matchesKey(data, Key.enter)) {
            viewerSearchMode = false;
          } else if (matchesKey(data, Key.escape)) {
            viewerSearchMode = false;
            viewerSearchQuery = "";
            viewerSearchMatches = [];
          } else if (matchesKey(data, Key.backspace)) {
            viewerSearchQuery = viewerSearchQuery.slice(0, -1);
            updateViewerSearch();
          } else if (data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) < 127) {
            viewerSearchQuery += data;
            updateViewerSearch();
          }
          return;
        }
        
        if (matchesKey(data, "q") && !selectMode) {
          closeViewer();
          return;
        }
        if (matchesKey(data, Key.escape)) {
          if (selectMode) {
            selectMode = false;
          } else if (viewerSearchQuery) {
            viewerSearchQuery = "";
            viewerSearchMatches = [];
          } else {
            closeViewer();
          }
          return;
        }
        // Start search
        if (matchesKey(data, "/") && !selectMode) {
          viewerSearchMode = true;
          viewerSearchQuery = "";
          return;
        }
        // Navigate matches
        if (matchesKey(data, "n") && !selectMode && viewerSearchMatches.length > 0) {
          jumpToNextMatch(1);
          return;
        }
        if (matchesKey(data, "N") && !selectMode && viewerSearchMatches.length > 0) {
          jumpToNextMatch(-1);
          return;
        }
        if (matchesKey(data, "j") || matchesKey(data, Key.down)) {
          if (selectMode) {
            selectEnd = Math.min(viewerContent.length - 1, selectEnd + 1);
          } else {
            viewerScroll = Math.min(Math.max(0, viewerContent.length - 10), viewerScroll + 1);
          }
          return;
        }
        if (matchesKey(data, "k") || matchesKey(data, Key.up)) {
          if (selectMode) {
            selectEnd = Math.max(selectStart, selectEnd - 1);
          } else {
            viewerScroll = Math.max(0, viewerScroll - 1);
          }
          return;
        }
        if (matchesKey(data, Key.pageDown)) {
          viewerScroll = Math.min(Math.max(0, viewerContent.length - viewerHeight), viewerScroll + viewerHeight);
          return;
        }
        if (matchesKey(data, Key.pageUp)) {
          viewerScroll = Math.max(0, viewerScroll - viewerHeight);
          return;
        }
        if (matchesKey(data, "g")) {
          viewerScroll = 0;
          return;
        }
        if (matchesKey(data, "G")) {
          viewerScroll = Math.max(0, viewerContent.length - viewerHeight);
          return;
        }
        // Height adjustment
        if (matchesKey(data, "+") || matchesKey(data, "=")) {
          viewerHeight = Math.min(50, viewerHeight + 5);
          return;
        }
        if (matchesKey(data, "-") || matchesKey(data, "_")) {
          viewerHeight = Math.max(5, viewerHeight - 5);
          return;
        }
        if (matchesKey(data, "d") && !selectMode && viewingFile.gitStatus) {
          viewerDiffMode = !viewerDiffMode;
          lastRenderWidth = 0; // Force reload on next render
          viewerScroll = 0;
          return;
        }
        if (matchesKey(data, "v") && !selectMode) {
          selectMode = true;
          selectStart = viewerScroll;
          selectEnd = viewerScroll;
          return;
        }
        if (matchesKey(data, "c") && selectMode) {
          sendComment();
          return;
        }
        // Navigate to next/prev changed file from viewer
        if (matchesKey(data, "]") && !selectMode) {
          // Go to next changed file
          closeViewer();
          navigateToChange(1);
          // Open the new file
          const displayList = getDisplayList();
          const item = displayList[selectedIndex];
          if (item && !item.node.isDirectory) {
            openFile(item.node);
          }
          return;
        }
        if (matchesKey(data, "[") && !selectMode) {
          // Go to prev changed file
          closeViewer();
          navigateToChange(-1);
          // Open the new file
          const displayList = getDisplayList();
          const item = displayList[selectedIndex];
          if (item && !item.node.isDirectory) {
            openFile(item.node);
          }
          return;
        }
      } else {
        // ===== FILE BROWSER INPUT =====
        const displayList = getDisplayList();

        if (matchesKey(data, "q") && !searchMode) {
          onClose();
          return;
        }
        if (matchesKey(data, Key.escape)) {
          if (searchMode) {
            searchMode = false;
            searchQuery = "";
          } else {
            onClose();
          }
          return;
        }
        if (matchesKey(data, "/") && !searchMode) {
          searchMode = true;
          searchQuery = "";
          return;
        }
        // Navigation works even during search
        if (matchesKey(data, "j") || matchesKey(data, Key.down)) {
          selectedIndex = Math.min(displayList.length - 1, selectedIndex + 1);
          return;
        }
        if (matchesKey(data, "k") || matchesKey(data, Key.up)) {
          selectedIndex = Math.max(0, selectedIndex - 1);
          return;
        }
        if (searchMode) {
          if (matchesKey(data, Key.enter)) {
            searchMode = false;
            // Keep the filter, reset selection
            selectedIndex = 0;
          } else if (matchesKey(data, Key.backspace)) {
            searchQuery = searchQuery.slice(0, -1);
            selectedIndex = 0;
          } else if (data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) < 127) {
            searchQuery += data;
            selectedIndex = 0;
          }
          return;
        }
        if (matchesKey(data, Key.enter)) {
          const item = displayList[selectedIndex];
          if (item) {
            if (item.node.isDirectory) {
              toggleDir(item.node);
            } else {
              openFile(item.node);
            }
          }
          return;
        }
        if (matchesKey(data, "l") || matchesKey(data, Key.right)) {
          const item = displayList[selectedIndex];
          if (item?.node.isDirectory && !item.node.expanded) {
            toggleDir(item.node);
          }
          return;
        }
        if (matchesKey(data, "h") || matchesKey(data, Key.left)) {
          const item = displayList[selectedIndex];
          if (item?.node.isDirectory && item.node.expanded) {
            toggleDir(item.node);
          }
          return;
        }
        // Page navigation
        if (matchesKey(data, Key.pageDown)) {
          selectedIndex = Math.min(displayList.length - 1, selectedIndex + browserHeight);
          return;
        }
        if (matchesKey(data, Key.pageUp)) {
          selectedIndex = Math.max(0, selectedIndex - browserHeight);
          return;
        }
        // Height adjustment
        if (matchesKey(data, "+") || matchesKey(data, "=")) {
          browserHeight = Math.min(40, browserHeight + 5);
          return;
        }
        if (matchesKey(data, "-") || matchesKey(data, "_")) {
          browserHeight = Math.max(5, browserHeight - 5);
          return;
        }
        // Toggle show only changed files
        if (matchesKey(data, "c")) {
          showOnlyChanged = !showOnlyChanged;
          selectedIndex = 0;
          return;
        }
        // Jump to next/prev changed file (expands folders, collapses others)
        if (matchesKey(data, "]")) {
          navigateToChange(1);
          return;
        }
        if (matchesKey(data, "[")) {
          navigateToChange(-1);
          return;
        }
      }
    },

    invalidate(): void {},
  };
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function editorExtension(pi: ExtensionAPI): void {
  const cwd = process.cwd();
  const agentModifiedFiles = new Set<string>();

  pi.registerCommand("files", {
    description: "Open file browser",
    handler: async (_args, ctx) => {
      await ctx.ui.custom<void>((tui, theme, _kb, done) => {
        let pollInterval: ReturnType<typeof setInterval> | null = null;
        
        const cleanup = () => {
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
          done();
        };
        
        const browser = createFileBrowser(cwd, agentModifiedFiles, theme, pi, cleanup);
        
        // Set up polling interval for git status updates (triggers re-render)
        pollInterval = setInterval(() => {
          tui.requestRender();
        }, 3000);
        
        return {
          render: (w) => browser.render(w),
          handleInput: (data) => {
            browser.handleInput(data);
            tui.requestRender();
          },
          invalidate: () => browser.invalidate(),
        };
      });
    },
  });

  pi.registerCommand("review", {
    description: "Open tuicr to review changes and send feedback to agent",
    handler: async (_args, ctx) => {
      if (!hasCommand("tuicr")) {
        ctx.ui.notify("Install tuicr: brew install agavra/tap/tuicr", "error");
        return;
      }

      ctx.ui.notify("Opening tuicr... Press :wq or y to copy review", "info");

      try {
        spawnSync("tuicr", [], { cwd, stdio: "inherit" });

        try {
          const clipboard = execSync(
            process.platform === "darwin" ? "pbpaste" : "xclip -selection clipboard -o",
            { encoding: "utf-8", timeout: 5000 }
          );

          if (clipboard.includes("## Review") || clipboard.includes("```") || 
              clipboard.includes("[Issue]") || clipboard.includes("[Suggestion]")) {
            pi.sendUserMessage(clipboard, { deliverAs: "steer" });
            ctx.ui.notify("Review sent to agent", "success");
          }
        } catch {}
      } catch (e: any) {
        ctx.ui.notify(`tuicr error: ${e.message}`, "error");
      }
    },
  });

  pi.registerCommand("diff", {
    description: "Open critique to view diffs",
    handler: async (args, ctx) => {
      if (!hasCommand("bun")) {
        ctx.ui.notify("critique requires Bun: brew install oven-sh/bun/bun", "error");
        return;
      }

      const critiqueArgs = args ? args.split(" ") : [];
      ctx.ui.notify("Opening critique...", "info");

      try {
        spawnSync("bunx", ["critique", ...critiqueArgs], { cwd, stdio: "inherit" });
      } catch (e: any) {
        ctx.ui.notify(`critique error: ${e.message}`, "error");
      }
    },
  });

  pi.on("tool_result", async (event) => {
    if (event.toolName === "write" || event.toolName === "edit") {
      const filePath = event.input?.path as string | undefined;
      if (filePath) {
        agentModifiedFiles.add(join(cwd, filePath));
      }
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    const missing: string[] = [];
    if (!hasCommand("bat")) missing.push("bat");
    if (!hasCommand("delta")) missing.push("delta");
    if (!hasCommand("glow")) missing.push("glow");

    if (missing.length > 0) {
      ctx.ui.notify(`Editor: install ${missing.join(", ")} for better experience`, "info");
    }

    agentModifiedFiles.clear();
  });

  pi.on("session_switch", async () => {
    agentModifiedFiles.clear();
  });
}

// =============================================================================
// TODO: Future improvements
// =============================================================================
// - Add mouse scroll support for navigation
// - Add fuzzy search (fzf-style) instead of simple substring match
// - Add file preview on hover/delay
// - Add ability to stage/unstage files directly from browser
// - Add keyboard shortcut to open file in external editor
// - Consider adding split view for side-by-side diff

// test change for diff display
