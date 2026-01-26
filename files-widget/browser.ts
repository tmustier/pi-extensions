import type { Theme } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";

import {
  DEFAULT_BROWSER_HEIGHT,
  LINE_COUNT_BATCH_DELAY_MS,
  LINE_COUNT_BATCH_SIZE,
  MAX_BROWSER_HEIGHT,
  MAX_LINE_COUNT_BYTES,
  MAX_TREE_DEPTH,
  MIN_PANEL_HEIGHT,
  POLL_INTERVAL_MS,
  SCAN_BATCH_DELAY_MS,
  SCAN_BATCH_SIZE,
  SAFE_MODE_ENTRY_THRESHOLD,
} from "./constants";
import { getGitBranch, getGitDiffStats, getGitFileList, getGitStatus, isGitRepo } from "./git";
import { buildFileTreeFromPaths, flattenTree, getIgnoredNames, sortChildren, updateTreeStats } from "./file-tree";
import type { DiffStats, FileNode, FlatNode } from "./types";
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

type ScanMode = "full" | "safe" | "none";

interface ScanState {
  mode: ScanMode;
  isScanning: boolean;
  isPartial: boolean;
  pending: number;
  spinnerIndex: number;
}

interface BrowserState {
  root: FileNode | null;
  flatList: FlatNode[];
  fullList: FlatNode[];
  stats: BrowserStats;
  nodeByPath: Map<string, FileNode>;
  scanState: ScanState;
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

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

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

function indexNodes(root: FileNode | null, map: Map<string, FileNode>): void {
  map.clear();
  if (!root) return;
  const stack: FileNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    map.set(node.path, node);
    if (node.children) {
      for (const child of node.children) {
        stack.push(child);
      }
    }
  }
}

function getNodeDepth(node: FileNode, cwd: string): number {
  if (node.path === cwd) return 0;
  const rel = relative(cwd, node.path);
  if (!rel) return 0;
  return rel.split(sep).length;
}

function shouldSafeMode(cwd: string): boolean {
  const resolved = resolve(cwd);
  const home = resolve(homedir());
  const root = resolve(sep);
  return resolved === home || resolved === root;
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
    const label = node.hasChangedChildren ? theme.fg("warning", node.name) : theme.fg("accent", node.name);
    return node.loading ? `${label}${theme.fg("dim", " ⏳")}` : label;
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
  requestComment: (payload: CommentPayload, comment: string) => void,
  requestRender: () => void
): BrowserController {
  const ignored = getIgnoredNames();
  const repo = isGitRepo(cwd);
  let gitStatus = repo ? getGitStatus(cwd) : new Map<string, string>();
  let diffStats = repo ? getGitDiffStats(cwd) : new Map<string, DiffStats>();
  const gitBranch = repo ? getGitBranch(cwd) : "";

  const viewer = createViewer(cwd, theme, requestComment);

  const root = repo
    ? buildFileTreeFromPaths(cwd, getGitFileList(cwd), gitStatus, diffStats, ignored, agentModifiedFiles)
    : {
      name: ".",
      path: cwd,
      isDirectory: true,
      children: undefined,
      expanded: true,
      hasChangedChildren: false,
    };

  const safeMode = !repo && shouldSafeMode(cwd);
  const scanState: ScanState = {
    mode: repo ? "none" : safeMode ? "safe" : "full",
    isScanning: false,
    isPartial: safeMode,
    pending: 0,
    spinnerIndex: 0,
  };

  const browser: BrowserState = {
    root,
    flatList: [],
    fullList: [],
    stats: getTreeStats(root),
    nodeByPath: new Map<string, FileNode>(),
    scanState,
    selectedIndex: 0,
    searchQuery: "",
    searchMode: false,
    showOnlyChanged: false,
    browserHeight: DEFAULT_BROWSER_HEIGHT,
    lastPollTime: Date.now(),
  };

  indexNodes(browser.root, browser.nodeByPath);
  browser.flatList = browser.root ? flattenTree(browser.root) : [];
  browser.fullList = browser.root ? flattenTree(browser.root, 0, true, true) : [];

  const lineCountCache = new Map<string, { size: number; mtimeMs: number; count: number }>();
  const lineCountQueue: FileNode[] = [];
  const lineCountPending = new Set<string>();
  let lineCountTimer: ReturnType<typeof setTimeout> | null = null;

  const scanQueue: Array<{ node: FileNode; depth: number }> = [];
  const scanQueued = new Set<string>();
  let scanTimer: ReturnType<typeof setTimeout> | null = null;

  const normalizeGitPath = (path: string): string => path.split(sep).join("/");

  function refreshLists(): void {
    browser.flatList = browser.root ? flattenTree(browser.root) : [];
    browser.fullList = browser.root ? flattenTree(browser.root, 0, true, true) : [];
  }

  function queueLineCount(node: FileNode, force = false): void {
    if (node.isDirectory) return;
    if (!force && node.lineCount !== undefined) return;
    if (lineCountPending.has(node.path)) return;
    lineCountPending.add(node.path);
    lineCountQueue.push(node);
    if (!lineCountTimer) {
      lineCountTimer = setTimeout(processLineCountBatch, LINE_COUNT_BATCH_DELAY_MS);
    }
  }

  function queueLineCountsForTree(rootNode: FileNode | null): void {
    if (!rootNode) return;
    const stack: FileNode[] = [rootNode];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;
      if (node.isDirectory) {
        if (node.children) {
          for (const child of node.children) {
            stack.push(child);
          }
        }
      } else {
        queueLineCount(node);
      }
    }
  }

  async function updateLineCount(node: FileNode): Promise<void> {
    try {
      const fileStat = await stat(node.path);
      if (fileStat.size > MAX_LINE_COUNT_BYTES) {
        node.lineCount = undefined;
        return;
      }
      const cached = lineCountCache.get(node.path);
      if (cached && cached.size === fileStat.size && cached.mtimeMs === fileStat.mtimeMs) {
        node.lineCount = cached.count;
        return;
      }
      const content = await readFile(node.path, "utf-8");
      const count = content.split("\n").length;
      node.lineCount = count;
      lineCountCache.set(node.path, { size: fileStat.size, mtimeMs: fileStat.mtimeMs, count });
    } catch {
      node.lineCount = undefined;
    }
  }

  async function processLineCountBatch(): Promise<void> {
    lineCountTimer = null;
    if (!browser.root) return;
    const batch = lineCountQueue.splice(0, LINE_COUNT_BATCH_SIZE);
    if (batch.length === 0) return;

    await Promise.all(
      batch.map(async node => {
        await updateLineCount(node);
        lineCountPending.delete(node.path);
      })
    );

    updateTreeStats(browser.root);
    browser.stats = getTreeStats(browser.root);
    refreshLists();
    requestRender();

    if (lineCountQueue.length > 0) {
      lineCountTimer = setTimeout(processLineCountBatch, LINE_COUNT_BATCH_DELAY_MS);
    }
  }

  function shouldAutoScan(depth: number): boolean {
    if (browser.scanState.mode === "safe") {
      return depth <= 0;
    }
    return depth <= MAX_TREE_DEPTH;
  }

  function getScanBatchSize(): number {
    return browser.scanState.mode === "safe" ? 1 : SCAN_BATCH_SIZE;
  }

  function getScanDelay(): number {
    return browser.scanState.mode === "safe" ? SCAN_BATCH_DELAY_MS * 4 : SCAN_BATCH_DELAY_MS;
  }

  function enqueueScan(node: FileNode, depth: number, force = false): void {
    if (depth > MAX_TREE_DEPTH) return;
    if (!force && browser.scanState.mode === "safe" && depth > 0) return;
    if (node.children !== undefined || node.loading) return;
    if (scanQueued.has(node.path)) return;

    node.loading = true;
    scanQueued.add(node.path);
    scanQueue.push({ node, depth });
    browser.scanState.pending = scanQueue.length;
    browser.scanState.isScanning = true;

    if (!scanTimer) {
      scanTimer = setTimeout(processScanBatch, getScanDelay());
    }
  }

  async function scanDirectory(node: FileNode, depth: number): Promise<void> {
    try {
      const entries = await readdir(node.path, { withFileTypes: true });
      const sorted = [...entries].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

      if (node.path === cwd && browser.scanState.mode === "full" && sorted.length >= SAFE_MODE_ENTRY_THRESHOLD) {
        browser.scanState.mode = "safe";
        browser.scanState.isPartial = true;
        scanQueue.length = 0;
        scanQueued.clear();
      }

      const dirs: FileNode[] = [];
      const files: FileNode[] = [];

      for (const entry of sorted) {
        if (ignored.has(entry.name) || entry.name.startsWith(".")) continue;
        const fullPath = join(node.path, entry.name);
        if (entry.isDirectory()) {
          const dirNode: FileNode = {
            name: entry.name,
            path: fullPath,
            isDirectory: true,
            children: undefined,
            expanded: depth + 1 < 1,
            hasChangedChildren: false,
          };
          dirs.push(dirNode);
          browser.nodeByPath.set(fullPath, dirNode);
          if (shouldAutoScan(depth + 1)) {
            enqueueScan(dirNode, depth + 1);
          }
        } else {
          const fileNode: FileNode = {
            name: entry.name,
            path: fullPath,
            isDirectory: false,
            agentModified: agentModifiedFiles.has(fullPath),
          };
          files.push(fileNode);
          browser.nodeByPath.set(fullPath, fileNode);
          queueLineCount(fileNode);
        }
      }

      node.children = [...dirs, ...files];
    } catch {
      node.children = [];
    } finally {
      node.loading = false;
      scanQueued.delete(node.path);
    }
  }

  async function processScanBatch(): Promise<void> {
    scanTimer = null;
    if (!browser.root) return;
    const batch = scanQueue.splice(0, getScanBatchSize());
    if (batch.length === 0) {
      browser.scanState.isScanning = false;
      browser.scanState.pending = 0;
      return;
    }

    for (const item of batch) {
      await scanDirectory(item.node, item.depth);
    }

    browser.scanState.pending = scanQueue.length;
    browser.scanState.isScanning = scanQueue.length > 0;

    updateTreeStats(browser.root);
    browser.stats = getTreeStats(browser.root);
    refreshLists();
    requestRender();

    if (scanQueue.length > 0) {
      scanTimer = setTimeout(processScanBatch, getScanDelay());
    }
  }

  function stopBackgroundTasks(): void {
    if (lineCountTimer) {
      clearTimeout(lineCountTimer);
      lineCountTimer = null;
    }
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }
  }

  function applyAgentModified(): void {
    for (const node of browser.nodeByPath.values()) {
      if (!node.isDirectory) {
        node.agentModified = agentModifiedFiles.has(node.path);
      }
    }
  }

  function applyGitUpdates(): void {
    for (const node of browser.nodeByPath.values()) {
      if (node.isDirectory) continue;
      const relPath = normalizeGitPath(relative(cwd, node.path));
      node.gitStatus = gitStatus.get(relPath);
      node.diffStats = diffStats.get(relPath);
    }
  }

  function ensureFileNode(relPath: string): FileNode | null {
    if (!browser.root) return null;
    let normalized = relPath.trim();
    if (!normalized) return null;
    if (normalized.startsWith("./")) {
      normalized = normalized.slice(2);
    }
    normalized = normalizeGitPath(normalized);
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length === 0) return null;
    if (parts.length - 1 > MAX_TREE_DEPTH) return null;

    let current = browser.root;
    let currentRel = "";

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (ignored.has(part) || part.startsWith(".")) return null;
      currentRel = currentRel ? `${currentRel}/${part}` : part;
      const dirPath = join(cwd, currentRel);
      let dirNode = browser.nodeByPath.get(dirPath);
      if (!dirNode) {
        const depth = i + 1;
        dirNode = {
          name: part,
          path: dirPath,
          isDirectory: true,
          children: [],
          expanded: depth < 1,
          hasChangedChildren: false,
        };
        current.children ??= [];
        current.children.push(dirNode);
        sortChildren(current);
        browser.nodeByPath.set(dirPath, dirNode);
      }
      current = dirNode;
    }

    const fileName = parts[parts.length - 1];
    if (ignored.has(fileName) || fileName.startsWith(".")) return null;

    const filePath = join(cwd, normalized);
    const existing = browser.nodeByPath.get(filePath);
    if (existing) return existing;

    const fileNode: FileNode = {
      name: fileName,
      path: filePath,
      isDirectory: false,
      gitStatus: gitStatus.get(normalized),
      agentModified: agentModifiedFiles.has(filePath),
      diffStats: diffStats.get(normalized),
    };

    current.children ??= [];
    current.children.push(fileNode);
    sortChildren(current);
    browser.nodeByPath.set(filePath, fileNode);
    return fileNode;
  }

  function addUntrackedNodes(): void {
    for (const [relPath, status] of gitStatus.entries()) {
      if (!isUntrackedStatus(status)) continue;
      const node = ensureFileNode(relPath);
      if (node) {
        node.gitStatus = status;
        node.diffStats = diffStats.get(relPath);
        queueLineCount(node, true);
      }
    }
  }

  function refreshMetadata(): void {
    if (!browser.root) return;
    const previousDisplayList = getDisplayList();
    const currentPath = previousDisplayList[browser.selectedIndex]?.node.path;
    const viewingFile = viewer.getFile();
    const viewingFilePath = viewingFile?.path;

    if (repo) {
      gitStatus = getGitStatus(cwd);
      diffStats = getGitDiffStats(cwd);
      applyGitUpdates();
      addUntrackedNodes();
    }

    applyAgentModified();
    updateTreeStats(browser.root);
    browser.stats = getTreeStats(browser.root);
    refreshLists();

    const updatedDisplayList = getDisplayList();
    if (currentPath) {
      const newIdx = updatedDisplayList.findIndex(f => f.node.path === currentPath);
      if (newIdx !== -1) {
        browser.selectedIndex = newIdx;
      }
    }

    browser.selectedIndex = Math.min(browser.selectedIndex, Math.max(0, updatedDisplayList.length - 1));

    if (viewingFilePath && browser.root) {
      const newNode = browser.nodeByPath.get(viewingFilePath) ?? findNodeByPath(browser.root, viewingFilePath);
      if (newNode) {
        if (newNode.lineCount === undefined && viewingFile?.lineCount !== undefined) {
          newNode.lineCount = viewingFile.lineCount;
        }
        viewer.updateFileRef(newNode);
      }
    }
  }

  if (repo) {
    queueLineCountsForTree(browser.root);
  } else if (browser.root) {
    enqueueScan(browser.root, 0, true);
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
      if (!repo && node.expanded && node.children === undefined) {
        enqueueScan(node, getNodeDepth(node, cwd), true);
      }
      refreshLists();
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

    const hasActivity = browser.scanState.isScanning || lineCountPending.size > 0;
    if (hasActivity) {
      browser.scanState.spinnerIndex = (browser.scanState.spinnerIndex + 1) % SPINNER_FRAMES.length;
    }
    const spinner = SPINNER_FRAMES[browser.scanState.spinnerIndex];
    const activityParts: string[] = [];
    if (browser.scanState.isScanning) activityParts.push(`${spinner} scanning`);
    if (lineCountPending.size > 0) activityParts.push(`${spinner} counts`);
    const activityIndicator = activityParts.length > 0 ? theme.fg("dim", ` ${activityParts.join(" ")}`) : "";
    const partialIndicator = browser.scanState.isPartial ? theme.fg("warning", " [partial]") : "";

    const searchIndicator = browser.searchMode
      ? theme.fg("accent", `  /${browser.searchQuery}█`)
      : "";

    lines.push(
      truncateToWidth(theme.bold(pathDisplay) + branchDisplay + statsDisplay + activityIndicator + partialIndicator + searchIndicator, width)
    );
    lines.push(theme.fg("borderMuted", "─".repeat(width)));

    const displayList = getDisplayList();
    if (displayList.length === 0) {
      const emptyLabel = browser.scanState.isScanning
        ? "  (loading...)"
        : "  (no files" + (browser.searchQuery ? " matching '" + browser.searchQuery + "'" : "") + ")";
      lines.push(theme.fg("dim", emptyLabel));
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
      stopBackgroundTasks();
      onClose();
      return;
    }
    if (matchesKey(data, Key.escape)) {
      if (browser.searchMode) {
        browser.searchMode = false;
        browser.searchQuery = "";
      } else {
        stopBackgroundTasks();
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
      if (repo && now - browser.lastPollTime > POLL_INTERVAL_MS) {
        browser.lastPollTime = now;
        refreshMetadata();
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
