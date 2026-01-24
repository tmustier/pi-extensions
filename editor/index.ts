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
        const child = buildFileTree(fullPath, cwd, gitStatus, ignored, agentModified, depth + 1);
        if (child) dirs.push(child);
      } else {
        const relPath = relative(cwd, fullPath);
        files.push({
          name: entry,
          path: fullPath,
          isDirectory: false,
          gitStatus: gitStatus.get(relPath),
          agentModified: agentModified.has(fullPath),
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
      const cmd = hasCommand("delta")
        ? `git diff HEAD -- "${filePath}" | delta --no-gitconfig --width=${termWidth}`
        : `git diff HEAD -- "${filePath}"`;
      try {
        return execSync(cmd, { cwd, encoding: "utf-8", timeout: 10000 }).split("\n");
      } catch {
        return ["No changes or not in git"];
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
  const ignored = getIgnoredNames();
  const root = buildFileTree(cwd, cwd, gitStatus, ignored, agentModifiedFiles);
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

  function getDisplayList(): FlatNode[] {
    if (!searchQuery) return flatList;
    const q = searchQuery.toLowerCase();
    return flatList.filter(f => f.node.name.toLowerCase().includes(q));
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
    viewerDiffMode = false;
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

        // Header
        const title = theme.bold("📁 Files");
        const searchIndicator = searchMode
          ? theme.fg("accent", `  /${searchQuery}█`)
          : "";
        lines.push(truncateToWidth(title + searchIndicator, width));
        lines.push(theme.fg("borderMuted", "─".repeat(width)));

        const displayList = getDisplayList();
        if (displayList.length === 0) {
          lines.push(theme.fg("dim", "  (no files" + (searchQuery ? " matching '" + searchQuery + "'" : "") + ")"));
        } else {
          // Calculate viewport
          const start = Math.max(0, selectedIndex - Math.floor(browserHeight / 2));
          const end = Math.min(displayList.length, start + browserHeight);

          for (let i = start; i < end; i++) {
            const { node, depth } = displayList[i];
            const isSelected = i === selectedIndex;
            const indent = "  ".repeat(depth);
            const icon = node.isDirectory ? (node.expanded ? "▼ " : "▶ ") : "  ";

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

            // Style the name
            let name = node.name;
            if (node.isDirectory) {
              name = theme.fg("accent", name);
            } else if (node.gitStatus) {
              name = theme.fg("warning", name);
            }

            let line = `${indent}${icon}${name}${status}`;
            
            // Truncate to width
            line = truncateToWidth(line, width);
            
            if (isSelected) {
              line = theme.bg("selectedBg", line);
            }
            
            lines.push(line);
          }

          // Scroll position indicator
          if (displayList.length > browserHeight) {
            const pct = Math.round((selectedIndex / (displayList.length - 1)) * 100);
            lines.push(theme.fg("dim", `  ${selectedIndex + 1}/${displayList.length} (${pct}%)`));
          }
        }

        // Footer
        lines.push(theme.fg("borderMuted", "─".repeat(width)));
        const help = searchMode
          ? theme.fg("dim", "Type to search  ↑↓: nav  Enter: confirm  Esc: cancel")
          : theme.fg("dim", "j/k: nav  Enter: open  /: search  h/l: collapse/expand  +/-: height  q: close");
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
