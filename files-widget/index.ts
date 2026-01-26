/**
 * Pi Editor Extension
 *
 * Provides an in-terminal file browser, viewer, and review workflow.
 * Use /files to open the file browser, navigate with j/k, Enter to view.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execSync, spawnSync } from "node:child_process";
import { join } from "node:path";

import { createFileBrowser } from "./browser";
import { POLL_INTERVAL_MS } from "./constants";
import { formatCommentMessage } from "./comment";
import { hasCommand } from "./utils";

export default function editorExtension(pi: ExtensionAPI): void {
  const cwd = process.cwd();
  const agentModifiedFiles = new Set<string>();

  pi.registerCommand("files", {
    description: "Open file browser",
    handler: async (_args, ctx) => {
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
          pi.sendUserMessage(formatCommentMessage(payload, comment), {
            deliverAs: "followUp",
            streamingBehavior: "followUp" as any,
          } as any);
        };

        const requestRender = () => tui.requestRender();
        const browser = createFileBrowser(cwd, agentModifiedFiles, theme, cleanup, requestComment, requestRender);

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
