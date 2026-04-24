/**
 * Pi Editor Extension
 *
 * Provides an in-terminal file browser and viewer.
 * Use /readfiles to open the file browser, navigate with j/k, Enter to view.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { join } from "node:path";

import { createFileBrowser } from "./browser";
import { POLL_INTERVAL_MS } from "./constants";
import { formatCommentMessage } from "./comment";
import { hasCommand } from "./utils";

export default function editorExtension(pi: ExtensionAPI): void {
  const cwd = process.cwd();
  const agentModifiedFiles = new Set<string>();
  const requiredDeps = ["bat", "delta", "glow"] as const;
  const getMissingDeps = () => requiredDeps.filter((dep) => !hasCommand(dep));

  pi.registerCommand("readfiles", {
    description: "Open file browser",
    handler: async (_args, ctx) => {
      const missing = getMissingDeps();
      if (missing.length > 0) {
        ctx.ui.notify(`files-widget requires ${missing.join(", ")}. Install: brew install bat git-delta glow`, "error");
        return;
      }

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
