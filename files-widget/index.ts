/**
 * Pi Editor Extension
 *
 * Provides an in-terminal file browser, viewer, and review workflow.
 * Use /files to open the file browser, navigate with j/k, Enter to view.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execSync, spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { createFileBrowser } from "./browser";
import { POLL_INTERVAL_MS } from "./constants";
import { formatCommentMessage } from "./comment";
import { hasCommand } from "./utils";

function resolveInitialPath(arg: string | undefined, cwd: string): { path: string; error?: string } {
  if (!arg) return { path: cwd };
  let candidate = arg.trim();
  if (!candidate) return { path: cwd };
  const home = homedir();
  if (candidate === "~") {
    candidate = home;
  } else if (candidate.startsWith("~/")) {
    candidate = join(home, candidate.slice(2));
  }
  const absolute = isAbsolute(candidate) ? candidate : resolve(cwd, candidate);
  try {
    if (!statSync(absolute).isDirectory()) {
      return { path: cwd, error: `${absolute} is not a directory` };
    }
  } catch {
    return { path: cwd, error: `${absolute} is not accessible` };
  }
  return { path: absolute };
}

export default function editorExtension(pi: ExtensionAPI): void {
  const cwd = process.cwd();
  const agentModifiedFiles = new Set<string>();
  const requiredDeps = ["bat", "delta", "glow"] as const;
  const getMissingDeps = () => requiredDeps.filter((dep) => !hasCommand(dep));

  pi.registerCommand("readfiles", {
    description: "Open file browser (optional: /readfiles <path> to start outside the current directory)",
    handler: async (args, ctx) => {
      const missing = getMissingDeps();
      if (missing.length > 0) {
        ctx.ui.notify(`files-widget requires ${missing.join(", ")}. Install: brew install bat git-delta glow`, "error");
        return;
      }

      const resolved = resolveInitialPath(args, cwd);
      if (resolved.error) {
        ctx.ui.notify(resolved.error, "error");
        return;
      }
      const initialPath = resolved.path;

      await ctx.ui.custom<void>((tui, theme, _kb, done) => {
        let pollInterval: ReturnType<typeof setInterval> | null = null;

        const cleanup = () => {
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
          done();
        };

        const requestComment = (payload: { relPath: string; lineRange: string; ext: string; selectedText: string }, comment: string) => {
          const message = formatCommentMessage(payload, comment);
          if (ctx.isIdle()) {
            pi.sendUserMessage(message);
            ctx.ui.notify(`Comment sent to agent for ${payload.relPath} (${payload.lineRange})`, "success");
          } else {
            pi.sendUserMessage(message, { deliverAs: "followUp" });
            ctx.ui.notify(`Comment queued for agent for ${payload.relPath} (${payload.lineRange})`, "info");
          }
        };

        const requestRender = () => tui.requestRender();
        const browser = createFileBrowser(
          initialPath,
          agentModifiedFiles,
          theme,
          cleanup,
          requestComment,
          requestRender,
          cwd
        );

        pollInterval = setInterval(() => {
          requestRender();
        }, POLL_INTERVAL_MS);

        return {
          render: (w) => browser.render(w),
          handleInput: (data) => {
            browser.handleInput(data);
            requestRender();
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

          if (
            clipboard.includes("## Review") ||
            clipboard.includes("```") ||
            clipboard.includes("[Issue]") ||
            clipboard.includes("[Suggestion]")
          ) {
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
    const missing = getMissingDeps();
    if (missing.length > 0) {
      ctx.ui.notify(`files-widget requires ${missing.join(", ")}. Install: brew install bat git-delta glow`, "error");
    }

    agentModifiedFiles.clear();
  });

  pi.on("session_switch", async () => {
    agentModifiedFiles.clear();
  });
}
