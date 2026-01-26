import { visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

import { isGitRepo } from "./git";
import { hasCommand, stripLeadingEmptyLines } from "./utils";

const DIFF_CONTENT_PREFIXES = new Set(["+", "-", " "]);

function isDiffContentLine(line: string): boolean {
  if (!line) return false;
  if (!DIFF_CONTENT_PREFIXES.has(line[0])) return false;
  if (line.startsWith("+++ ") || line.startsWith("--- ")) return false;
  return true;
}

function wrapLine(line: string, width: number): string[] {
  if (width <= 0 || line.length <= width) {
    return [line];
  }
  const wrapped: string[] = [];
  for (let i = 0; i < line.length; i += width) {
    wrapped.push(line.slice(i, i + width));
  }
  return wrapped;
}

function wrapDiffLines(lines: string[], width: number): string[] {
  if (width <= 0) return lines;
  const wrapped: string[] = [];
  for (const line of lines) {
    if (line.length <= width) {
      wrapped.push(line);
      continue;
    }
    if (isDiffContentLine(line)) {
      const prefix = line[0];
      const content = line.slice(1);
      const contentWidth = Math.max(width - 1, 1);
      for (const chunk of wrapLine(content, contentWidth)) {
        wrapped.push(prefix + chunk);
      }
    } else {
      wrapped.push(...wrapLine(line, width));
    }
  }
  return wrapped;
}

function extractAnsiCode(str: string, pos: number): { length: number } | null {
  if (pos >= str.length || str[pos] !== "\x1b") return null;
  const next = str[pos + 1];
  if (next === "[") {
    let j = pos + 2;
    while (j < str.length && !/[mGKHJ]/.test(str[j])) j++;
    if (j < str.length) return { length: j + 1 - pos };
    return null;
  }
  if (next === "]") {
    let j = pos + 2;
    while (j < str.length) {
      if (str[j] === "\x07") return { length: j + 1 - pos };
      if (str[j] === "\x1b" && str[j + 1] === "\\") return { length: j + 2 - pos };
      j++;
    }
    return null;
  }
  if (next === "_") {
    let j = pos + 2;
    while (j < str.length) {
      if (str[j] === "\x07") return { length: j + 1 - pos };
      if (str[j] === "\x1b" && str[j + 1] === "\\") return { length: j + 2 - pos };
      j++;
    }
    return null;
  }
  return null;
}

function stripAnsiCodes(line: string): string {
  let result = "";
  for (let i = 0; i < line.length;) {
    const ansi = extractAnsiCode(line, i);
    if (ansi) {
      i += ansi.length;
      continue;
    }
    result += line[i];
    i += 1;
  }
  return result;
}

function splitByVisibleWidth(line: string, width: number): { prefix: string; rest: string } {
  if (width <= 0) return { prefix: "", rest: line };
  let visible = 0;
  let i = 0;
  while (i < line.length) {
    const ansi = extractAnsiCode(line, i);
    if (ansi) {
      i += ansi.length;
      continue;
    }
    const charWidth = visibleWidth(line[i]);
    if (visible + charWidth > width) break;
    visible += charWidth;
    i += 1;
  }
  return { prefix: line.slice(0, i), rest: line.slice(i) };
}

function maskDigits(line: string): string {
  let result = "";
  for (let i = 0; i < line.length;) {
    const ansi = extractAnsiCode(line, i);
    if (ansi) {
      result += line.slice(i, i + ansi.length);
      i += ansi.length;
      continue;
    }
    const char = line[i];
    result += char >= "0" && char <= "9" ? " " : char;
    i += 1;
  }
  return result;
}

function wrapDeltaLine(line: string, width: number): string[] {
  const clean = stripAnsiCodes(line);
  let separatorIndex = clean.indexOf("│");
  if (separatorIndex === -1) separatorIndex = clean.indexOf("|");
  if (separatorIndex === -1) return wrapTextWithAnsi(line, width);

  let prefixWidth = visibleWidth(clean.slice(0, separatorIndex + 1));
  if (clean[separatorIndex + 1] === " ") prefixWidth += 1;
  if (prefixWidth >= width) return wrapTextWithAnsi(line, width);

  const { prefix, rest } = splitByVisibleWidth(line, prefixWidth);
  const contentWidth = Math.max(width - visibleWidth(prefix), 1);
  const continuationPrefix = maskDigits(prefix);
  const wrappedContent = wrapTextWithAnsi(rest, contentWidth);

  return wrappedContent.map((chunk, index) => (index === 0 ? prefix : continuationPrefix) + chunk);
}

function wrapDeltaLines(lines: string[], width: number): string[] {
  if (width <= 0) return lines;
  const wrapped: string[] = [];
  for (const line of lines) {
    wrapped.push(...wrapDeltaLine(line, width));
  }
  return wrapped;
}

export function loadFileContent(
  filePath: string,
  cwd: string,
  diffMode: boolean,
  hasChanges: boolean,
  width?: number
): string[] {
  const isMarkdown = filePath.endsWith(".md");
  const termWidth = width || process.stdout.columns || 80;

  try {
    try {
      if (statSync(filePath).isDirectory()) {
        return ["Directory selected - expand it in the file tree instead of opening it."];
      }
    } catch {
      // Ignore stat errors and fall through to normal handling
    }

    if (diffMode && hasChanges && isGitRepo(cwd)) {
      try {
        // Try different diff strategies
        let diffOutput = "";

        // First try: unstaged changes
        const unstaged = execSync(`git diff --no-color -- "${filePath}"`, { cwd, encoding: "utf-8", timeout: 10000, stdio: "pipe" });
        if (unstaged.trim()) {
          diffOutput = unstaged;
        } else {
          // Second try: staged changes
          const staged = execSync(`git diff --no-color --cached -- "${filePath}"`, { cwd, encoding: "utf-8", timeout: 10000, stdio: "pipe" });
          if (staged.trim()) {
            diffOutput = staged;
          } else {
            // Third try: diff against HEAD (for new files that are staged)
            const headDiff = execSync(`git diff --no-color HEAD -- "${filePath}"`, { cwd, encoding: "utf-8", timeout: 10000, stdio: "pipe" });
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
              `delta --no-gitconfig --width=${termWidth} --line-numbers --wrap-max-lines=unlimited --max-line-length=0`,
              {
                cwd,
                encoding: "utf-8",
                timeout: 10000,
                input: diffOutput,
                stdio: ["pipe", "pipe", "pipe"],
              }
            );
            return wrapDeltaLines(stripLeadingEmptyLines(deltaOutput.split("\n")), termWidth);
          } catch {
            // Fall back to raw diff
          }
        }

        return wrapDiffLines(stripLeadingEmptyLines(diffOutput.split("\n")), termWidth);
      } catch (e: any) {
        return [`Diff error: ${e.message}`];
      }
    }

    if (isMarkdown && hasCommand("glow")) {
      try {
        const output = execSync(`glow -s dark -w ${termWidth} "${filePath}"`, { encoding: "utf-8", timeout: 10000 });
        if (output.trim()) {
          return stripLeadingEmptyLines(output.split("\n"));
        }
      } catch {
        // Fall through to bat
      }
    }

    if (hasCommand("bat")) {
      try {
        return execSync(
          `bat --style=numbers --color=always --paging=never --wrap=auto --terminal-width=${termWidth} "${filePath}"`,
          { encoding: "utf-8", timeout: 10000 }
        ).split("\n");
      } catch {
        try {
          return execSync(
            `bat --style=numbers --color=always --paging=never --terminal-width=${termWidth} "${filePath}"`,
            { encoding: "utf-8", timeout: 10000 }
          ).split("\n");
        } catch {
          // Fall through to raw file read
        }
      }
    }

    const raw = readFileSync(filePath, "utf-8");
    return raw.split("\n").map((line, i) => `${String(i + 1).padStart(4)} │ ${line}`);
  } catch (e: any) {
    return [`Error loading file: ${e.message}`];
  }
}
