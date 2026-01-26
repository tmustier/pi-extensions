import type { Theme } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { basename } from "node:path";

import {
  DEFAULT_BROWSER_HEIGHT,
  MAX_BROWSER_HEIGHT,
  MIN_PANEL_HEIGHT,
  POLL_INTERVAL_MS,
} from "./constants";
import { getGitBranch, getGitDiffStats, getGitStatus } from "./git";
import { buildFileTree, flattenTree, getIgnoredNames } from "./file-tree";
import type { FileNode, FlatNode } from "./types";
import { isIgnoredStatus, isUntrackedStatus } from "./utils";
import { createViewer, type CommentPayload, type ViewerAction } from "./viewer";
import { isPrintableChar } from "./input-utils";

export interface BrowserController {
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
}

interface BrowserStats {
  totalLines?: number;
  additions: number;
  deletions: number;
}

interface BrowserState {
  root: FileNode | null;
  flatList: FlatNode[];
  fullList: FlatNode[];
  stats: BrowserStats;
  selectedIndex: number;
  searchQuery: string;
  searchMode: boolean;
  showOnlyChanged: boolean;
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

function getTreeStats(root: FileNode | null): BrowserStats {
  if (!root) {
    return { totalLines: undefined, additions: 0, deletions: 0 };
  }

  return {
    totalLines: root.lineCountComplete ? root.totalLines ?? 0 : undefined,
    additions: root.totalAdditions ?? 0,
    deletions: root.totalDeletions ?? 0,
  };
}

function formatNodeStatus(node: FileNode, theme: Theme): string {
  if (isIgnoredStatus(node.gitStatus)) return "";
  if (node.agentModified) return theme.fg("accent", " 🤖");
  if (node.gitStatus === "M" || node.gitStatus === "MM") return theme.fg("warning", " M");
  if (isUntrackedStatus(node.gitStatus)) return theme.fg("dim", " ?");
  if (node.gitStatus === "A") return theme.fg("success", " A");
  if (node.gitStatus === "D") return theme.fg("error", " D");
  return "";
}

function formatNodeMeta(node: FileNode, theme: Theme): string {
  if (isIgnoredStatus(node.gitStatus)) return "";

  const parts: string[] = [];

  if (node.isDirectory && !node.expanded) {
    if (node.totalAdditions && node.totalAdditions > 0) {
      parts.push(theme.fg("success", `+${node.totalAdditions}`));
    }
    if (node.totalDeletions && node.totalDeletions > 0) {
      parts.push(theme.fg("error", `-${node.totalDeletions}`));
    }
    if (node.totalLines && node.lineCountComplete !== false) {
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
    } else if (isUntrackedStatus(node.gitStatus) && node.lineCount !== undefined) {
      parts.push(theme.fg("success", `+${node.lineCount}`));
    }
    if (node.lineCount !== undefined) {
      parts.push(theme.fg("dim", `${node.lineCount}L`));
    }
  }

  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function formatNodeName(node: FileNode, theme: Theme): string {
  if (isIgnoredStatus(node.gitStatus)) return theme.fg("dim", node.name);
  if (node.isDirectory) {
    return node.hasChangedChildren ? theme.fg("warning", node.name) : theme.fg("accent", node.name);
  }
  if (node.gitStatus) return theme.fg("warning", node.name);
  return node.name;
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
  onClose: () => void,
  requestComment: (payload: CommentPayload, comment: string) => void
): BrowserController {
  let gitStatus = getGitStatus(cwd);
  let diffStats = getGitDiffStats(cwd);
  const gitBranch = getGitBranch(cwd);
  const ignored = getIgnoredNames();

  const viewer = createViewer(cwd, theme, requestComment);

  const root = buildFileTree(cwd, cwd, gitStatus, diffStats, ignored, agentModifiedFiles);

  const browser: BrowserState = {
    root,
    flatList: [],
    fullList: [],
    stats: getTreeStats(root),
    selectedIndex: 0,
    searchQuery: "",
    searchMode: false,
    showOnlyChanged: false,
    browserHeight: DEFAULT_BROWSER_HEIGHT,
    lastPollTime: Date.now(),
  };

  browser.flatList = browser.root ? flattenTree(browser.root) : [];
  browser.fullList = browser.root ? flattenTree(browser.root, 0, true, true) : [];

  function refreshGitStatus(): void {
    const previousDisplayList = getDisplayList();
    const currentPath = previousDisplayList[browser.selectedIndex]?.node.path;
    const viewingFile = viewer.getFile();
    const viewingFilePath = viewingFile?.path;

    const expandedPaths = captureExpandedPaths(browser.root);

    gitStatus = getGitStatus(cwd);
    diffStats = getGitDiffStats(cwd);
    browser.root = buildFileTree(cwd, cwd, gitStatus, diffStats, ignored, agentModifiedFiles);
    browser.stats = getTreeStats(browser.root);

    restoreExpandedPaths(browser.root, expandedPaths);

    browser.flatList = browser.root ? flattenTree(browser.root) : [];
    browser.fullList = browser.root ? flattenTree(browser.root, 0, true, true) : [];

    const updatedDisplayList = getDisplayList();
    if (currentPath) {
      const newIdx = updatedDisplayList.findIndex(f => f.node.path === currentPath);
      if (newIdx !== -1) {
        browser.selectedIndex = newIdx;
      }
    }

    browser.selectedIndex = Math.min(browser.selectedIndex, Math.max(0, updatedDisplayList.length - 1));

    if (viewingFilePath && browser.root) {
      const newNode = findNodeByPath(browser.root, viewingFilePath);
      if (newNode) {
        if (newNode.lineCount === undefined && viewingFile?.lineCount !== undefined) {
          newNode.lineCount = viewingFile.lineCount;
        }
        viewer.updateFileRef(newNode);
      }
    }
  }

  function getDisplayList(): FlatNode[] {
    let list = browser.searchQuery ? browser.fullList : browser.flatList;

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
    viewer.setFile(node);
  }

  function renderBrowser(width: number): string[] {
    const lines: string[] = [];
    const pathDisplay = basename(cwd);
    const branchDisplay = gitBranch ? theme.fg("accent", ` (${gitBranch})`) : "";
    const stats = browser.stats;

    let statsDisplay = "";
    if (stats.totalLines !== undefined) {
      statsDisplay += theme.fg("dim", ` ${stats.totalLines}L`);
    }
    if (stats.additions > 0) statsDisplay += theme.fg("success", ` +${stats.additions}`);
    if (stats.deletions > 0) statsDisplay += theme.fg("error", ` -${stats.deletions}`);

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

        const status = formatNodeStatus(node, theme);
        const meta = formatNodeMeta(node, theme);
        const name = formatNodeName(node, theme);

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
    const action: ViewerAction = viewer.handleInput(data);
    if (action.type === "close") {
      viewer.close();
      return;
    }
    if (action.type === "navigate") {
      viewer.close();
      navigateToChange(action.direction);
      const displayList = getDisplayList();
      const item = displayList[browser.selectedIndex];
      if (item && !item.node.isDirectory) {
        openFile(item.node);
      }
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
      } else if (isPrintableChar(data)) {
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
      } else if (item && !item.node.isDirectory) {
        openFile(item.node);
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

      if (viewer.isOpen()) {
        return viewer.render(width);
      }

      return renderBrowser(width);
    },

    handleInput(data: string): void {
      if (viewer.isOpen()) {
        handleViewerInput(data);
      } else {
        handleBrowserInput(data);
      }
    },

    invalidate(): void {},
  };
}
