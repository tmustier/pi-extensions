import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

export function hasCommand(cmd: string): boolean {
  const pathEntries = (process.env.PATH ?? "").split(delimiter);
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
    : [""];
  const accessMode = process.platform === "win32" ? constants.F_OK : constants.X_OK;

  for (const rawEntry of pathEntries) {
    const entry = rawEntry.replace(/^"|"$/g, "") || ".";
    for (const extension of extensions) {
      try {
        accessSync(join(entry, `${cmd}${extension}`), accessMode);
        return true;
      } catch {
        // Continue searching PATH.
      }
    }
  }

  return false;
}

export function isUntrackedStatus(status?: string): boolean {
  return status === "?" || status === "??";
}

export function isIgnoredStatus(status?: string): boolean {
  return status === "!" || status === "!!";
}

export function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

export function stripLeadingEmptyLines(lines: string[]): string[] {
  let startIdx = 0;
  while (startIdx < lines.length && !lines[startIdx].trim()) {
    startIdx++;
  }
  return lines.slice(startIdx);
}
