import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { isGitRepo } from "./git";
import { hasCommand, stripLeadingEmptyLines } from "./utils";

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
            return stripLeadingEmptyLines(deltaOutput.split("\n"));
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
          return stripLeadingEmptyLines(output.split("\n"));
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
