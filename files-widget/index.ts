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

function getGitStatus(cwd: string): Map<string, string> {
  const status = new Map<string, string>();
  try {
    const output = execSync("git status --porcelain", { cwd, encoding: "utf-8", timeout: 5000 });
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
    return execSync("git branch --show-current", { cwd, encoding: "utf-8", timeout: 2000 }).trim();
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
    const output = execSync("git diff --numstat HEAD", { cwd, encoding: "utf-8", timeout: 5000 });
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
    const stagedOutput = execSync("git diff --numstat --cached", { cwd, encoding: "utf-8", timeout: 5000 });
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
    if (diffMode && hasChanges) {
      try {
        // Try different diff strategies
        let diffOutput = "";
        
        // First try: unstaged changes
        const unstaged = execSync(`git diff -- "${filePath}"`, { cwd, encoding: "utf-8", timeout: 10000 });
        if (unstaged.trim()) {
          diffOutput = unstaged;
        } else {
          // Second try: staged changes
          const staged = execSync(`git diff --cached -- "${filePath}"`, { cwd, encoding: "utf-8", timeout: 10000 });
          if (staged.trim()) {
            diffOutput = staged;
          } else {
            // Third try: diff against HEAD (for new files that are staged)
            const headDiff = execSync(`git diff HEAD -- "${filePath}"`, { cwd, encoding: "utf-8", timeout: 10000 });
            if (headDiff.trim()) {
              diffOutput = headDiff;
            }
          }
        }
        
        if (!diffOutput.trim()) {
          return ["No diff available - file may be untracked or unchanged"];
        }
        
        if (hasCommand("delta")) {
          // Pipe through delta for nice formatting
          const deltaOutput = execSync(`echo ${JSON.stringify(diffOutput)} | delta --no-gitconfig --width=${termWidth}`, { 
            cwd, 
            encoding: "utf-8", 
            timeout: 10000,
            shell: "/bin/bash"
          });
          return deltaOutput.split("\n");
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
  const gitStatus = getGitStatus(cwd);
  const diffStats = getGitDiffStats(cwd);
  const gitBranch = getGitBranch(cwd);
  const ignored = getIgnoredNames();
  const root = buildFileTree(cwd, cwd, gitStatus, diffStats, ignored, agentModifiedFiles);
  let flatList = root ? flattenTree(root) : [];
  let selectedIndex = 0;
  let searchQuery = "";
  let searchMode = false;

  // Viewer state
  let viewingFile: FileNode | null = null;
  let viewerContent: string[] = [];
  let viewerRawContent = "";
  let viewerScroll = 0;
  let viewerDiffMode = false;
  let selectMode = false;
  let selectStart = 0;
  let selectEnd = 0;

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
    // Default to diff mode if file has changes
    viewerDiffMode = !!node.gitStatus;
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
      const lines: string[] = [];

      if (viewingFile) {
        // ===== FILE VIEWER =====
        // Reload content if width changed or not loaded yet
        if (lastRenderWidth !== width || viewerContent.length === 0) {
          reloadViewerContent(width);
        }

        // Header
        let header = theme.bold(viewingFile.name);
        if (viewerDiffMode) header += theme.fg("warning", " [DIFF]");
        if (selectMode) {
          header += theme.fg("accent", ` [SELECT ${selectStart + 1}-${selectEnd + 1}]`);
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
        const help = selectMode
          ? theme.fg("dim", "j/k: extend  c: comment  Esc: cancel")
          : theme.fg("dim", `j/k/PgUp/Dn: scroll  +/-: height  v: select  ${viewingFile.gitStatus ? "d: diff  " : ""}q: back  ${pct}%`);
        lines.push(help);

      } else {
        // ===== FILE BROWSER =====

        // Header with path and branch
        const pathDisplay = basename(cwd);
        const branchDisplay = gitBranch ? theme.fg("accent", ` (${gitBranch})`) : "";
        const searchIndicator = searchMode
          ? theme.fg("accent", `  /${searchQuery}█`)
          : "";
        lines.push(truncateToWidth(theme.bold(pathDisplay) + branchDisplay + searchIndicator, width));
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

            // Build status indicator
            let status = "";
            if (node.agentModified) {
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

            // File metadata (line count and diff stats)
            let meta = "";
            if (!node.isDirectory) {
              const parts: string[] = [];
              if (node.lineCount) {
                parts.push(theme.fg("dim", `${node.lineCount}L`));
              }
              if (node.diffStats) {
                if (node.diffStats.additions > 0) {
                  parts.push(theme.fg("success", `+${node.diffStats.additions}`));
                }
                if (node.diffStats.deletions > 0) {
                  parts.push(theme.fg("error", `-${node.diffStats.deletions}`));
                }
              }
              if (parts.length > 0) {
                meta = " " + parts.join(" ");
              }
            }

            // Style the name - directories with changes are yellow
            let name = node.name;
            if (node.isDirectory) {
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
        if (matchesKey(data, "q") && !selectMode) {
          closeViewer();
          return;
        }
        if (matchesKey(data, Key.escape)) {
          if (selectMode) {
            selectMode = false;
          } else {
            closeViewer();
          }
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
        if (matchesKey(data, Key.ctrl("d")) || matchesKey(data, Key.pageDown)) {
          viewerScroll = Math.min(Math.max(0, viewerContent.length - viewerHeight), viewerScroll + viewerHeight);
          return;
        }
        if (matchesKey(data, Key.ctrl("u")) || matchesKey(data, Key.pageUp)) {
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
        const browser = createFileBrowser(cwd, agentModifiedFiles, theme, pi, () => done());
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
