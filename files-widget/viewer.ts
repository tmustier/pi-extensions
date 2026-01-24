import type { Theme } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { readFileSync } from "node:fs";
import { relative } from "node:path";

import {
  DEFAULT_VIEWER_HEIGHT,
  MAX_VIEWER_HEIGHT,
  MIN_PANEL_HEIGHT,
  SEARCH_SCROLL_OFFSET,
  VIEWER_SCROLL_MARGIN,
} from "./constants";
import { loadFileContent } from "./file-viewer";
import type { FileNode } from "./types";
import { isUntrackedStatus } from "./utils";
import { isPrintableChar } from "./input-utils";

export interface CommentPayload {
  relPath: string;
  lineRange: string;
  ext: string;
  selectedText: string;
}

export type ViewerAction =
  | { type: "none" }
  | { type: "close" }
  | { type: "navigate"; direction: 1 | -1 };

type ViewerMode = "normal" | "select" | "search" | "comment";

interface ViewerState {
  file: FileNode | null;
  content: string[];
  rawContent: string;
  scroll: number;
  diffMode: boolean;
  mode: ViewerMode;
  selectStart: number;
  selectEnd: number;
  commentText: string;
  searchQuery: string;
  searchMatches: number[];
  searchIndex: number;
  lastRenderWidth: number;
  height: number;
}

export interface ViewerController {
  isOpen(): boolean;
  getFile(): FileNode | null;
  setFile(file: FileNode): void;
  updateFileRef(file: FileNode | null): void;
  close(): void;
  render(width: number): string[];
  handleInput(data: string): ViewerAction;
}

export function createViewer(
  cwd: string,
  theme: Theme,
  requestComment: (payload: CommentPayload, comment: string) => void
): ViewerController {
  const state: ViewerState = {
    file: null,
    content: [],
    rawContent: "",
    scroll: 0,
    diffMode: false,
    mode: "normal",
    selectStart: 0,
    selectEnd: 0,
    commentText: "",
    searchQuery: "",
    searchMatches: [],
    searchIndex: 0,
    lastRenderWidth: 0,
    height: DEFAULT_VIEWER_HEIGHT,
  };

  function resetSearch(): void {
    state.searchQuery = "";
    state.searchMatches = [];
    state.searchIndex = 0;
  }

  function resetComment(): void {
    state.commentText = "";
  }

  function clearSelection(): void {
    state.selectStart = 0;
    state.selectEnd = 0;
  }

  function setMode(mode: ViewerMode): void {
    state.mode = mode;
    if (mode !== "search") resetSearch();
    if (mode !== "comment") resetComment();
    if (mode === "normal") {
      clearSelection();
    }
  }

  function reloadContent(width: number): void {
    if (!state.file) return;
    const hasChanges = !!state.file.gitStatus;
    state.content = loadFileContent(state.file.path, cwd, state.diffMode, hasChanges, width);
    state.lastRenderWidth = width;
  }

  function updateSearchMatches(): void {
    state.searchMatches = [];
    if (!state.searchQuery) return;

    const q = state.searchQuery.toLowerCase();
    const rawLines = state.rawContent.split("\n");
    for (let i = 0; i < rawLines.length; i++) {
      if (rawLines[i].toLowerCase().includes(q)) {
        state.searchMatches.push(i);
      }
    }
    state.searchIndex = 0;

    if (state.searchMatches.length > 0) {
      state.scroll = Math.max(0, state.searchMatches[0] - SEARCH_SCROLL_OFFSET);
    }
  }

  function jumpToNextMatch(direction: 1 | -1): void {
    if (state.searchMatches.length === 0) return;
    state.searchIndex += direction;
    if (state.searchIndex < 0) state.searchIndex = state.searchMatches.length - 1;
    if (state.searchIndex >= state.searchMatches.length) state.searchIndex = 0;
    state.scroll = Math.max(0, state.searchMatches[state.searchIndex] - SEARCH_SCROLL_OFFSET);
  }

  function buildCommentPayload(): CommentPayload | null {
    if (!state.file) return null;

    const rawLines = state.rawContent.split("\n");
    const selectedText = rawLines.slice(state.selectStart, state.selectEnd + 1).join("\n");
    const relPath = relative(cwd, state.file.path);
    const lineRange = state.selectStart === state.selectEnd
      ? `line ${state.selectStart + 1}`
      : `lines ${state.selectStart + 1}-${state.selectEnd + 1}`;
    const ext = state.file.name.split(".").pop() || "";

    return { relPath, lineRange, ext, selectedText };
  }

  function sendComment(comment: string): void {
    const payload = buildCommentPayload();
    if (!payload) return;

    requestComment(payload, comment);
    setMode("normal");
  }

  function renderHeader(width: number): string {
    if (!state.file) return "";
    const isUntracked = isUntrackedStatus(state.file.gitStatus);

    let header = theme.bold(state.file.name);
    if (isUntracked) {
      header += theme.fg("dim", " [UNTRACKED]");
    } else if (state.diffMode) {
      header += theme.fg("warning", " [DIFF]");
    }
    if (state.mode === "select" || state.mode === "comment") {
      header += theme.fg("accent", ` [SELECT ${state.selectStart + 1}-${state.selectEnd + 1}]`);
    }

    if (state.file.diffStats) {
      if (state.file.diffStats.additions > 0) {
        header += theme.fg("success", ` +${state.file.diffStats.additions}`);
      }
      if (state.file.diffStats.deletions > 0) {
        header += theme.fg("error", ` -${state.file.diffStats.deletions}`);
      }
    } else if (isUntracked && state.file.lineCount) {
      header += theme.fg("success", ` +${state.file.lineCount}`);
    }

    if (state.file.lineCount) {
      header += theme.fg("dim", ` ${state.file.lineCount}L`);
    }

    if (state.mode === "search") {
      header += theme.fg("accent", `  /${state.searchQuery}█`);
    } else if (state.searchQuery && state.searchMatches.length > 0) {
      header += theme.fg("dim", ` [${state.searchIndex + 1}/${state.searchMatches.length}]`);
    }

    return truncateToWidth(header, width);
  }

  function renderFooter(width: number): string[] {
    const lines: string[] = [];
    const pct = state.content.length > 0
      ? Math.round((state.scroll / Math.max(1, state.content.length - state.height)) * 100)
      : 0;

    if (state.mode === "comment") {
      const prompt = theme.fg("accent", `Comment: ${state.commentText}█`);
      lines.push(truncateToWidth(prompt, width));
      lines.push(theme.fg("borderMuted", "─".repeat(width)));
    }

    let help: string;
    if (state.mode === "comment") {
      help = theme.fg("dim", "Enter: send  Esc: cancel");
    } else if (state.mode === "select") {
      help = theme.fg("dim", "j/k: extend  c: comment  Esc: cancel");
    } else if (state.mode === "search") {
      help = theme.fg("dim", "Type to search  Enter: confirm  Esc: cancel");
    } else {
      const isUntracked = state.file && isUntrackedStatus(state.file.gitStatus);
      help = theme.fg(
        "dim",
        `j/k: scroll  /: search  n/N: next/prev match  []: files  ${state.file?.gitStatus && !isUntracked ? "d: diff  " : ""}q: back  ${pct}%`
      );
    }
    lines.push(truncateToWidth(help, width));

    return lines;
  }

  return {
    isOpen(): boolean {
      return !!state.file;
    },

    getFile(): FileNode | null {
      return state.file;
    },

    setFile(file: FileNode): void {
      state.file = file;
      state.scroll = 0;
      state.diffMode = !!file.gitStatus && !isUntrackedStatus(file.gitStatus);
      setMode("normal");
      state.content = [];
      state.lastRenderWidth = 0;

      try {
        state.rawContent = readFileSync(file.path, "utf-8");
      } catch {
        state.rawContent = "";
      }
    },

    updateFileRef(file: FileNode | null): void {
      state.file = file;
    },

    close(): void {
      state.file = null;
      state.content = [];
      setMode("normal");
    },

    render(width: number): string[] {
      if (!state.file) return [];

      if (state.lastRenderWidth !== width || state.content.length === 0) {
        reloadContent(width);
      }

      const lines: string[] = [];
      lines.push(renderHeader(width));
      lines.push(theme.fg("borderMuted", "─".repeat(width)));

      const visible = state.content.slice(state.scroll, state.scroll + state.height);
      for (let i = 0; i < state.height; i++) {
        if (i < visible.length) {
          const lineIdx = state.scroll + i;
          let line = truncateToWidth(visible[i] || "", width);
          if ((state.mode === "select" || state.mode === "comment") && lineIdx >= state.selectStart && lineIdx <= state.selectEnd) {
            line = theme.bg("selectedBg", line);
          }
          lines.push(line);
        } else {
          lines.push(theme.fg("dim", "~"));
        }
      }

      lines.push(theme.fg("borderMuted", "─".repeat(width)));
      lines.push(...renderFooter(width));

      return lines;
    },

    handleInput(data: string): ViewerAction {
      if (!state.file) return { type: "none" };

      if (state.mode === "comment") {
        if (matchesKey(data, Key.enter)) {
          const comment = state.commentText.trim();
          if (comment) {
            sendComment(comment);
          } else {
            setMode("normal");
          }
        } else if (matchesKey(data, Key.escape)) {
          setMode("normal");
        } else if (matchesKey(data, Key.backspace)) {
          state.commentText = state.commentText.slice(0, -1);
        } else if (isPrintableChar(data)) {
          state.commentText += data;
        }
        return { type: "none" };
      }

      if (state.mode === "search") {
        if (matchesKey(data, Key.enter)) {
          setMode("normal");
        } else if (matchesKey(data, Key.escape)) {
          setMode("normal");
        } else if (matchesKey(data, Key.backspace)) {
          state.searchQuery = state.searchQuery.slice(0, -1);
          updateSearchMatches();
        } else if (isPrintableChar(data)) {
          state.searchQuery += data;
          updateSearchMatches();
        }
        return { type: "none" };
      }

      if (matchesKey(data, "q") && state.mode !== "select") {
        return { type: "close" };
      }
      if (matchesKey(data, Key.escape)) {
        if (state.mode === "select") {
          setMode("normal");
        } else if (state.searchQuery) {
          resetSearch();
        } else {
          return { type: "close" };
        }
        return { type: "none" };
      }
      if (matchesKey(data, "/") && state.mode !== "select") {
        setMode("search");
        return { type: "none" };
      }
      if (matchesKey(data, "n") && state.mode !== "select" && state.searchMatches.length > 0) {
        jumpToNextMatch(1);
        return { type: "none" };
      }
      if (matchesKey(data, "N") && state.mode !== "select" && state.searchMatches.length > 0) {
        jumpToNextMatch(-1);
        return { type: "none" };
      }
      if (matchesKey(data, "j") || matchesKey(data, Key.down)) {
        if (state.mode === "select") {
          state.selectEnd = Math.min(state.content.length - 1, state.selectEnd + 1);
        } else {
          state.scroll = Math.min(Math.max(0, state.content.length - VIEWER_SCROLL_MARGIN), state.scroll + 1);
        }
        return { type: "none" };
      }
      if (matchesKey(data, "k") || matchesKey(data, Key.up)) {
        if (state.mode === "select") {
          state.selectEnd = Math.max(state.selectStart, state.selectEnd - 1);
        } else {
          state.scroll = Math.max(0, state.scroll - 1);
        }
        return { type: "none" };
      }
      if (matchesKey(data, Key.pageDown)) {
        state.scroll = Math.min(Math.max(0, state.content.length - state.height), state.scroll + state.height);
        return { type: "none" };
      }
      if (matchesKey(data, Key.pageUp)) {
        state.scroll = Math.max(0, state.scroll - state.height);
        return { type: "none" };
      }
      if (matchesKey(data, "g")) {
        state.scroll = 0;
        return { type: "none" };
      }
      if (matchesKey(data, "G")) {
        state.scroll = Math.max(0, state.content.length - state.height);
        return { type: "none" };
      }
      if (matchesKey(data, "+") || matchesKey(data, "=")) {
        state.height = Math.min(MAX_VIEWER_HEIGHT, state.height + 5);
        return { type: "none" };
      }
      if (matchesKey(data, "-") || matchesKey(data, "_")) {
        state.height = Math.max(MIN_PANEL_HEIGHT, state.height - 5);
        return { type: "none" };
      }
      if (matchesKey(data, "d") && state.mode !== "select" && state.file.gitStatus && !isUntrackedStatus(state.file.gitStatus)) {
        state.diffMode = !state.diffMode;
        state.lastRenderWidth = 0;
        state.scroll = 0;
        return { type: "none" };
      }
      if (matchesKey(data, "v") && state.mode !== "select") {
        state.mode = "select";
        state.selectStart = state.scroll;
        state.selectEnd = state.scroll;
        return { type: "none" };
      }
      if (matchesKey(data, "c") && state.mode === "select") {
        state.mode = "comment";
        state.commentText = "";
        return { type: "none" };
      }
      if (matchesKey(data, "]") && state.mode !== "select") {
        return { type: "navigate", direction: 1 };
      }
      if (matchesKey(data, "[") && state.mode !== "select") {
        return { type: "navigate", direction: -1 };
      }

      return { type: "none" };
    },
  };
}
