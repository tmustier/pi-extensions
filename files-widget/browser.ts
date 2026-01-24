import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { readFileSync } from "node:fs";
import { basename, relative } from "node:path";

import {
  DEFAULT_BROWSER_HEIGHT,
  DEFAULT_VIEWER_HEIGHT,
  MAX_BROWSER_HEIGHT,
  MAX_VIEWER_HEIGHT,
  MIN_PANEL_HEIGHT,
  POLL_INTERVAL_MS,
  SEARCH_SCROLL_OFFSET,
  VIEWER_SCROLL_MARGIN,
} from "./constants";
import { getGitBranch, getGitDiffStats, getGitStatus } from "./git";
import { buildFileTree, flattenTree, getIgnoredNames } from "./file-tree";
import { loadFileContent } from "./file-viewer";
import type { FileNode, FlatNode } from "./types";
import { isIgnoredStatus, isUntrackedStatus } from "./utils";

export interface BrowserController {
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
}

interface ViewerState {
  file: FileNode | null;
  content: string[];
  rawContent: string;
  scroll: number;
  diffMode: boolean;
  selectMode: boolean;
  selectStart: number;
  selectEnd: number;
  searchMode: boolean;
  searchQuery: string;
  searchMatches: number[];
  searchIndex: number;
  lastRenderWidth: number;
}

interface BrowserState {
  root: FileNode | null;
  flatList: FlatNode[];
  selectedIndex: number;
  searchQuery: string;
  searchMode: boolean;
  showOnlyChanged: boolean;
  viewerHeight: number;
  browserHeight: number;
  lastPollTime: number;
}

interface ChangedFile {
  file: FileNode;
  ancestors: FileNode[];
}

function captureExpandedPaths(root: FileNode | null): Set<string> {
  const expandedPaths = new Set<string>();

  function traverse(node: FileNode): void {
    if (node.isDirectory && node.expanded) {
      expandedPaths.add(node.path);
    }
    if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  if (root) traverse(root);
  return expandedPaths;
}

function restoreExpandedPaths(root: FileNode | null, expandedPaths: Set<string>): void {
  function traverse(node: FileNode): void {
    if (node.isDirectory) {
      node.expanded = expandedPaths.has(node.path);
    }
    if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  if (root) traverse(root);
}

function findNodeByPath(root: FileNode | null, path: string): FileNode | null {
  if (!root) return null;
  if (root.path === path) return root;
  if (!root.children) return null;

  for (const child of root.children) {
    const found = findNodeByPath(child, path);
    if (found) return found;
  }

  return null;
}

function collectChangedFiles(node: FileNode, ancestors: FileNode[] = []): ChangedFile[] {
  const results: ChangedFile[] = [];

  if (!node.isDirectory && (node.gitStatus || node.agentModified)) {
    results.push({ file: node, ancestors: [...ancestors] });
  }

  if (node.children) {
    for (const child of node.children) {
      results.push(...collectChangedFiles(child, [...ancestors, node]));
    }
  }

  return results;
}

function computeTotalStats(root: FileNode | null): { totalLines: number; additions: number; deletions: number } {
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

export function createFileBrowser(
  cwd: string,
  agentModifiedFiles: Set<string>,
  theme: Theme,
  pi: ExtensionAPI,
  onClose: () => void
): BrowserController {
  let gitStatus = getGitStatus(cwd);
  let diffStats = getGitDiffStats(cwd);
  const gitBranch = getGitBranch(cwd);
  const ignored = getIgnoredNames();

  const viewer: ViewerState = {
    file: null,
    content: [],
    rawContent: "",
    scroll: 0,
    diffMode: false,
    selectMode: false,
    selectStart: 0,
    selectEnd: 0,
    searchMode: false,
    searchQuery: "",
    searchMatches: [],
    searchIndex: 0,
    lastRenderWidth: 0,
  };

  const browser: BrowserState = {
    root: buildFileTree(cwd, cwd, gitStatus, diffStats, ignored, agentModifiedFiles),
    flatList: [],
    selectedIndex: 0,
    searchQuery: "",
    searchMode: false,
    showOnlyChanged: false,
    viewerHeight: DEFAULT_VIEWER_HEIGHT,
    browserHeight: DEFAULT_BROWSER_HEIGHT,
    lastPollTime: Date.now(),
  };

  browser.flatList = browser.root ? flattenTree(browser.root) : [];

  function refreshGitStatus(): void {
    const currentPath = browser.flatList[browser.selectedIndex]?.node.path;
    const viewingFilePath = viewer.file?.path;

    const expandedPaths = captureExpandedPaths(browser.root);

    gitStatus = getGitStatus(cwd);
    diffStats = getGitDiffStats(cwd);
    browser.root = buildFileTree(cwd, cwd, gitStatus, diffStats, ignored, agentModifiedFiles);

    restoreExpandedPaths(browser.root, expandedPaths);

    browser.flatList = browser.root ? flattenTree(browser.root) : [];

    if (currentPath) {
      const newIdx = browser.flatList.findIndex(f => f.node.path === currentPath);
      if (newIdx !== -1) {
        browser.selectedIndex = newIdx;
      }
    }

    browser.selectedIndex = Math.min(browser.selectedIndex, Math.max(0, browser.flatList.length - 1));

    if (viewingFilePath && browser.root) {
      const newNode = findNodeByPath(browser.root, viewingFilePath);
      if (newNode) {
        viewer.file = newNode;
      }
    }
  }

  function getDisplayList(): FlatNode[] {
    let list = browser.flatList;

    if (browser.showOnlyChanged) {
      list = list.filter(f =>
        f.node.gitStatus ||
        f.node.agentModified ||
        (f.node.isDirectory && f.node.hasChangedChildren)
      );
    }

    if (browser.searchQuery) {
      const q = browser.searchQuery.toLowerCase();
      list = list.filter(f => f.node.name.toLowerCase().includes(q));
    }

    return list;
  }

  function navigateToChange(direction: 1 | -1): void {
    if (!browser.root) return;

    const changedFiles = collectChangedFiles(browser.root);
    if (changedFiles.length === 0) return;

    const displayList = getDisplayList();
    const currentNode = displayList[browser.selectedIndex]?.node;

    let currentIdx = -1;
    if (currentNode && !currentNode.isDirectory) {
      currentIdx = changedFiles.findIndex(c => c.file.path === currentNode.path);
    }

    let nextIdx: number;
    if (currentIdx === -1) {
      nextIdx = direction === 1 ? 0 : changedFiles.length - 1;
    } else {
      nextIdx = currentIdx + direction;
      if (nextIdx < 0) nextIdx = changedFiles.length - 1;
      if (nextIdx >= changedFiles.length) nextIdx = 0;
    }

    const target = changedFiles[nextIdx];

    const ancestorSet = new Set(target.ancestors);
    collapseAllExcept(browser.root, ancestorSet);

    for (const ancestor of target.ancestors) {
      ancestor.expanded = true;
    }

    browser.flatList = flattenTree(browser.root);

    const newDisplayList = getDisplayList();
    const targetIdx = newDisplayList.findIndex(f => f.node.path === target.file.path);
    if (targetIdx !== -1) {
      browser.selectedIndex = targetIdx;
    }
  }

  function toggleDir(node: FileNode): void {
    if (node.isDirectory) {
      node.expanded = !node.expanded;
      browser.flatList = browser.root ? flattenTree(browser.root) : [];
    }
  }

  function openFile(node: FileNode): void {
    viewer.file = node;
    viewer.scroll = 0;
    viewer.diffMode = !!node.gitStatus && !isUntrackedStatus(node.gitStatus);
    viewer.selectMode = false;
    viewer.searchMode = false;
    viewer.searchQuery = "";
    viewer.searchMatches = [];
    viewer.searchIndex = 0;
    viewer.content = [];
    viewer.lastRenderWidth = 0;

    try {
      viewer.rawContent = readFileSync(node.path, "utf-8");
    } catch {
      viewer.rawContent = "";
    }
  }

  function reloadViewerContent(width: number): void {
    if (!viewer.file) return;
    const hasChanges = !!viewer.file.gitStatus;
    viewer.content = loadFileContent(viewer.file.path, cwd, viewer.diffMode, hasChanges, width);
    viewer.lastRenderWidth = width;
  }

  function closeViewer(): void {
    viewer.file = null;
    viewer.content = [];
    viewer.selectMode = false;
    viewer.searchMode = false;
    viewer.searchQuery = "";
    viewer.searchMatches = [];
  }

  function updateViewerSearch(): void {
    viewer.searchMatches = [];
    if (!viewer.searchQuery) return;

    const q = viewer.searchQuery.toLowerCase();
    const rawLines = viewer.rawContent.split("\n");
    for (let i = 0; i < rawLines.length; i++) {
      if (rawLines[i].toLowerCase().includes(q)) {
        viewer.searchMatches.push(i);
      }
    }
    viewer.searchIndex = 0;

    if (viewer.searchMatches.length > 0) {
      viewer.scroll = Math.max(0, viewer.searchMatches[0] - SEARCH_SCROLL_OFFSET);
    }
  }

  function jumpToNextMatch(direction: 1 | -1): void {
    if (viewer.searchMatches.length === 0) return;
    viewer.searchIndex += direction;
    if (viewer.searchIndex < 0) viewer.searchIndex = viewer.searchMatches.length - 1;
    if (viewer.searchIndex >= viewer.searchMatches.length) viewer.searchIndex = 0;
    viewer.scroll = Math.max(0, viewer.searchMatches[viewer.searchIndex] - SEARCH_SCROLL_OFFSET);
  }

  function sendComment(): void {
    if (!viewer.file || !viewer.selectMode) return;

    const rawLines = viewer.rawContent.split("\n");
    const selectedText = rawLines.slice(viewer.selectStart, viewer.selectEnd + 1).join("\n");
    const relPath = relative(cwd, viewer.file.path);
    const lineRange = viewer.selectStart === viewer.selectEnd
      ? `line ${viewer.selectStart + 1}`
      : `lines ${viewer.selectStart + 1}-${viewer.selectEnd + 1}`;
    const ext = viewer.file.name.split(".").pop() || "";

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

  function renderViewer(width: number): string[] {
    if (!viewer.file) return [];

    if (viewer.lastRenderWidth !== width || viewer.content.length === 0) {
      reloadViewerContent(width);
    }

    const lines: string[] = [];
    const isUntracked = isUntrackedStatus(viewer.file.gitStatus);

    let header = theme.bold(viewer.file.name);
    if (isUntracked) {
      header += theme.fg("dim", " [UNTRACKED]");
    } else if (viewer.diffMode) {
      header += theme.fg("warning", " [DIFF]");
    }
    if (viewer.selectMode) {
      header += theme.fg("accent", ` [SELECT ${viewer.selectStart + 1}-${viewer.selectEnd + 1}]`);
    }

    if (viewer.file.diffStats) {
      if (viewer.file.diffStats.additions > 0) {
        header += theme.fg("success", ` +${viewer.file.diffStats.additions}`);
      }
      if (viewer.file.diffStats.deletions > 0) {
        header += theme.fg("error", ` -${viewer.file.diffStats.deletions}`);
      }
    } else if (isUntracked && viewer.file.lineCount) {
      header += theme.fg("success", ` +${viewer.file.lineCount}`);
    }

    if (viewer.file.lineCount) {
      header += theme.fg("dim", ` ${viewer.file.lineCount}L`);
    }

    if (viewer.searchMode) {
      header += theme.fg("accent", `  /${viewer.searchQuery}█`);
    } else if (viewer.searchQuery && viewer.searchMatches.length > 0) {
      header += theme.fg("dim", ` [${viewer.searchIndex + 1}/${viewer.searchMatches.length}]`);
    }

    lines.push(truncateToWidth(header, width));
    lines.push(theme.fg("borderMuted", "─".repeat(width)));

    const visible = viewer.content.slice(viewer.scroll, viewer.scroll + browser.viewerHeight);
    for (let i = 0; i < browser.viewerHeight; i++) {
      if (i < visible.length) {
        const lineIdx = viewer.scroll + i;
        let line = truncateToWidth(visible[i] || "", width);
        if (viewer.selectMode && lineIdx >= viewer.selectStart && lineIdx <= viewer.selectEnd) {
          line = theme.bg("selectedBg", line);
        }
        lines.push(line);
      } else {
        lines.push(theme.fg("dim", "~"));
      }
    }

    lines.push(theme.fg("borderMuted", "─".repeat(width)));
    const pct = viewer.content.length > 0
      ? Math.round((viewer.scroll / Math.max(1, viewer.content.length - browser.viewerHeight)) * 100)
      : 0;

    let help: string;
    if (viewer.selectMode) {
      help = theme.fg("dim", "j/k: extend  c: comment  Esc: cancel");
    } else if (viewer.searchMode) {
      help = theme.fg("dim", "Type to search  Enter: confirm  Esc: cancel");
    } else {
      help = theme.fg(
        "dim",
        `j/k: scroll  /: search  n/N: next/prev match  []: files  ${viewer.file.gitStatus && !isUntracked ? "d: diff  " : ""}q: back  ${pct}%`
      );
    }
    lines.push(truncateToWidth(help, width));

    return lines;
  }

  function renderBrowser(width: number): string[] {
    const lines: string[] = [];
    const pathDisplay = basename(cwd);
    const branchDisplay = gitBranch ? theme.fg("accent", ` (${gitBranch})`) : "";
    const stats = computeTotalStats(browser.root);

    let statsDisplay = theme.fg("dim", ` ${stats.totalLines}L`);
    if (stats.additions > 0 || stats.deletions > 0) {
      if (stats.additions > 0) statsDisplay += theme.fg("success", ` +${stats.additions}`);
      if (stats.deletions > 0) statsDisplay += theme.fg("error", ` -${stats.deletions}`);
    }

    const searchIndicator = browser.searchMode
      ? theme.fg("accent", `  /${browser.searchQuery}█`)
      : "";

    lines.push(truncateToWidth(theme.bold(pathDisplay) + branchDisplay + statsDisplay + searchIndicator, width));
    lines.push(theme.fg("borderMuted", "─".repeat(width)));

    const displayList = getDisplayList();
    if (displayList.length === 0) {
      lines.push(theme.fg("dim", "  (no files" + (browser.searchQuery ? " matching '" + browser.searchQuery + "'" : "") + ")"));
      for (let i = 1; i < browser.browserHeight; i++) {
        lines.push("");
      }
    } else {
      const start = Math.max(
        0,
        Math.min(browser.selectedIndex - Math.floor(browser.browserHeight / 2), displayList.length - browser.browserHeight)
      );
      const end = Math.min(displayList.length, start + browser.browserHeight);

      for (let i = start; i < end; i++) {
        const { node, depth } = displayList[i];
        const isSelected = i === browser.selectedIndex;
        const indent = "  ".repeat(depth);
        const icon = node.isDirectory
          ? (node.expanded ? "▼ " : "▶ ")
          : "  ";

        const isIgnored = isIgnoredStatus(node.gitStatus);

        let status = "";
        if (isIgnored) {
          // No status indicator for ignored files
        } else if (node.agentModified) {
          status = theme.fg("accent", " 🤖");
        } else if (node.gitStatus === "M" || node.gitStatus === "MM") {
          status = theme.fg("warning", " M");
        } else if (isUntrackedStatus(node.gitStatus)) {
          status = theme.fg("dim", " ?");
        } else if (node.gitStatus === "A") {
          status = theme.fg("success", " A");
        } else if (node.gitStatus === "D") {
          status = theme.fg("error", " D");
        }

        let meta = "";
        if (!isIgnored) {
          const parts: string[] = [];

          if (node.isDirectory && !node.expanded) {
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
            if (node.diffStats) {
              if (node.diffStats.additions > 0) {
                parts.push(theme.fg("success", `+${node.diffStats.additions}`));
              }
              if (node.diffStats.deletions > 0) {
                parts.push(theme.fg("error", `-${node.diffStats.deletions}`));
              }
            } else if (isUntrackedStatus(node.gitStatus) && node.lineCount) {
              parts.push(theme.fg("success", `+${node.lineCount}`));
            }
            if (node.lineCount) {
              parts.push(theme.fg("dim", `${node.lineCount}L`));
            }
          }

          if (parts.length > 0) {
            meta = " " + parts.join(" ");
          }
        }

        let name = node.name;
        if (isIgnored) {
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
        line = truncateToWidth(line, width);

        if (isSelected) {
          line = theme.bg("selectedBg", line);
        }

        lines.push(line);
      }

      const renderedCount = end - start;
      for (let i = renderedCount; i < browser.browserHeight; i++) {
        lines.push("");
      }

      const pct = displayList.length > 1
        ? Math.round((browser.selectedIndex / (displayList.length - 1)) * 100)
        : 100;
      lines.push(theme.fg("dim", `  ${browser.selectedIndex + 1}/${displayList.length} (${pct}%)`));
    }

    lines.push(theme.fg("borderMuted", "─".repeat(width)));
    const changedIndicator = browser.showOnlyChanged ? theme.fg("warning", " [changed only]") : "";
    const help = browser.searchMode
      ? theme.fg("dim", "Type to search  ↑↓: nav  Enter: confirm  Esc: cancel")
      : theme.fg("dim", "j/k: nav  []: next/prev change  c: toggle changed  /: search  q: close") + changedIndicator;
    lines.push(truncateToWidth(help, width));

    return lines;
  }

  function handleViewerInput(data: string): void {
    if (!viewer.file) return;

    if (viewer.searchMode) {
      if (matchesKey(data, Key.enter)) {
        viewer.searchMode = false;
      } else if (matchesKey(data, Key.escape)) {
        viewer.searchMode = false;
        viewer.searchQuery = "";
        viewer.searchMatches = [];
      } else if (matchesKey(data, Key.backspace)) {
        viewer.searchQuery = viewer.searchQuery.slice(0, -1);
        updateViewerSearch();
      } else if (data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) < 127) {
        viewer.searchQuery += data;
        updateViewerSearch();
      }
      return;
    }

    if (matchesKey(data, "q") && !viewer.selectMode) {
      closeViewer();
      return;
    }
    if (matchesKey(data, Key.escape)) {
      if (viewer.selectMode) {
        viewer.selectMode = false;
      } else if (viewer.searchQuery) {
        viewer.searchQuery = "";
        viewer.searchMatches = [];
      } else {
        closeViewer();
      }
      return;
    }
    if (matchesKey(data, "/") && !viewer.selectMode) {
      viewer.searchMode = true;
      viewer.searchQuery = "";
      return;
    }
    if (matchesKey(data, "n") && !viewer.selectMode && viewer.searchMatches.length > 0) {
      jumpToNextMatch(1);
      return;
    }
    if (matchesKey(data, "N") && !viewer.selectMode && viewer.searchMatches.length > 0) {
      jumpToNextMatch(-1);
      return;
    }
    if (matchesKey(data, "j") || matchesKey(data, Key.down)) {
      if (viewer.selectMode) {
        viewer.selectEnd = Math.min(viewer.content.length - 1, viewer.selectEnd + 1);
      } else {
        viewer.scroll = Math.min(Math.max(0, viewer.content.length - VIEWER_SCROLL_MARGIN), viewer.scroll + 1);
      }
      return;
    }
    if (matchesKey(data, "k") || matchesKey(data, Key.up)) {
      if (viewer.selectMode) {
        viewer.selectEnd = Math.max(viewer.selectStart, viewer.selectEnd - 1);
      } else {
        viewer.scroll = Math.max(0, viewer.scroll - 1);
      }
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      viewer.scroll = Math.min(Math.max(0, viewer.content.length - browser.viewerHeight), viewer.scroll + browser.viewerHeight);
      return;
    }
    if (matchesKey(data, Key.pageUp)) {
      viewer.scroll = Math.max(0, viewer.scroll - browser.viewerHeight);
      return;
    }
    if (matchesKey(data, "g")) {
      viewer.scroll = 0;
      return;
    }
    if (matchesKey(data, "G")) {
      viewer.scroll = Math.max(0, viewer.content.length - browser.viewerHeight);
      return;
    }
    if (matchesKey(data, "+") || matchesKey(data, "=")) {
      browser.viewerHeight = Math.min(MAX_VIEWER_HEIGHT, browser.viewerHeight + 5);
      return;
    }
    if (matchesKey(data, "-") || matchesKey(data, "_")) {
      browser.viewerHeight = Math.max(MIN_PANEL_HEIGHT, browser.viewerHeight - 5);
      return;
    }
    if (matchesKey(data, "d") && !viewer.selectMode && viewer.file.gitStatus && !isUntrackedStatus(viewer.file.gitStatus)) {
      viewer.diffMode = !viewer.diffMode;
      viewer.lastRenderWidth = 0;
      viewer.scroll = 0;
      return;
    }
    if (matchesKey(data, "v") && !viewer.selectMode) {
      viewer.selectMode = true;
      viewer.selectStart = viewer.scroll;
      viewer.selectEnd = viewer.scroll;
      return;
    }
    if (matchesKey(data, "c") && viewer.selectMode) {
      sendComment();
      return;
    }
    if (matchesKey(data, "]") && !viewer.selectMode) {
      closeViewer();
      navigateToChange(1);
      const displayList = getDisplayList();
      const item = displayList[browser.selectedIndex];
      if (item && !item.node.isDirectory) {
        openFile(item.node);
      }
      return;
    }
    if (matchesKey(data, "[") && !viewer.selectMode) {
      closeViewer();
      navigateToChange(-1);
      const displayList = getDisplayList();
      const item = displayList[browser.selectedIndex];
      if (item && !item.node.isDirectory) {
        openFile(item.node);
      }
      return;
    }
  }

  function handleBrowserInput(data: string): void {
    const displayList = getDisplayList();

    if (matchesKey(data, "q") && !browser.searchMode) {
      onClose();
      return;
    }
    if (matchesKey(data, Key.escape)) {
      if (browser.searchMode) {
        browser.searchMode = false;
        browser.searchQuery = "";
      } else {
        onClose();
      }
      return;
    }
    if (matchesKey(data, "/") && !browser.searchMode) {
      browser.searchMode = true;
      browser.searchQuery = "";
      return;
    }
    if (matchesKey(data, "j") || matchesKey(data, Key.down)) {
      browser.selectedIndex = Math.min(displayList.length - 1, browser.selectedIndex + 1);
      return;
    }
    if (matchesKey(data, "k") || matchesKey(data, Key.up)) {
      browser.selectedIndex = Math.max(0, browser.selectedIndex - 1);
      return;
    }
    if (browser.searchMode) {
      if (matchesKey(data, Key.enter)) {
        browser.searchMode = false;
        browser.selectedIndex = 0;
      } else if (matchesKey(data, Key.backspace)) {
        browser.searchQuery = browser.searchQuery.slice(0, -1);
        browser.selectedIndex = 0;
      } else if (data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) < 127) {
        browser.searchQuery += data;
        browser.selectedIndex = 0;
      }
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const item = displayList[browser.selectedIndex];
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
      const item = displayList[browser.selectedIndex];
      if (item?.node.isDirectory && !item.node.expanded) {
        toggleDir(item.node);
      }
      return;
    }
    if (matchesKey(data, "h") || matchesKey(data, Key.left)) {
      const item = displayList[browser.selectedIndex];
      if (item?.node.isDirectory && item.node.expanded) {
        toggleDir(item.node);
      }
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      browser.selectedIndex = Math.min(displayList.length - 1, browser.selectedIndex + browser.browserHeight);
      return;
    }
    if (matchesKey(data, Key.pageUp)) {
      browser.selectedIndex = Math.max(0, browser.selectedIndex - browser.browserHeight);
      return;
    }
    if (matchesKey(data, "+") || matchesKey(data, "=")) {
      browser.browserHeight = Math.min(MAX_BROWSER_HEIGHT, browser.browserHeight + 5);
      return;
    }
    if (matchesKey(data, "-") || matchesKey(data, "_")) {
      browser.browserHeight = Math.max(MIN_PANEL_HEIGHT, browser.browserHeight - 5);
      return;
    }
    if (matchesKey(data, "c")) {
      browser.showOnlyChanged = !browser.showOnlyChanged;
      browser.selectedIndex = 0;
      return;
    }
    if (matchesKey(data, "]")) {
      navigateToChange(1);
      return;
    }
    if (matchesKey(data, "[")) {
      navigateToChange(-1);
      return;
    }
  }

  return {
    render(width: number): string[] {
      const now = Date.now();
      if (now - browser.lastPollTime > POLL_INTERVAL_MS) {
        browser.lastPollTime = now;
        refreshGitStatus();
      }

      if (viewer.file) {
        return renderViewer(width);
      }

      return renderBrowser(width);
    },

    handleInput(data: string): void {
      if (viewer.file) {
        handleViewerInput(data);
      } else {
        handleBrowserInput(data);
      }
    },

    invalidate(): void {},
  };
}
