/**
 * Update the terminal tab title with Pi run status (:new/:running/:✅/:🚧/:🛑).
 */
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { basename } from "node:path";

type StatusState = "new" | "running" | "doneCommitted" | "doneNoCommit" | "timeout";

const STATUS_TEXT: Record<StatusState, string> = {
	new: ":new",
	running: ":running...",
	doneCommitted: ":✅",
	doneNoCommit: ":🚧",
	timeout: ":🛑",
};

const INACTIVE_TIMEOUT_MS = 120_000;
const GIT_COMMIT_RE = /\bgit\b[^\n]*\bcommit\b/;

export default function (pi: ExtensionAPI) {
	let state: StatusState = "new";
	let sawCommit = false;
	let running = false;
	let timeoutId: ReturnType<typeof setTimeout> | undefined;

	const cwdBase = (ctx: ExtensionContext) => basename(ctx.cwd || "pi");

	const setTitle = (ctx: ExtensionContext, next: StatusState) => {
		state = next;
		if (!ctx.hasUI) return;
		ctx.ui.setTitle(`pi${STATUS_TEXT[next]} - ${cwdBase(ctx)}`);
	};

	const clearTimeout = () => {
		if (!timeoutId) return;
		clearTimeout(timeoutId);
		timeoutId = undefined;
	};

	const scheduleTimeout = (ctx: ExtensionContext) => {
		clearTimeout();
		timeoutId = setTimeout(() => {
			if (running && state === "running") {
				setTitle(ctx, "timeout");
			}
		}, INACTIVE_TIMEOUT_MS);
	};

	const markActivity = (ctx: ExtensionContext) => {
		if (!running) return;
		if (state === "timeout") {
			setTitle(ctx, "running");
		}
		scheduleTimeout(ctx);
	};

	const reset = (ctx: ExtensionContext, next: StatusState) => {
		running = false;
		sawCommit = false;
		clearTimeout();
		setTitle(ctx, next);
	};

	pi.on("session_start", async (_event, ctx) => {
		reset(ctx, "new");
	});

	pi.on("session_switch", async (event, ctx) => {
		reset(ctx, event.reason === "new" ? "new" : "doneCommitted");
	});

	pi.on("agent_start", async (_event, ctx) => {
		running = true;
		sawCommit = false;
		setTitle(ctx, "running");
		scheduleTimeout(ctx);
	});

	pi.on("turn_start", async (_event, ctx) => {
		markActivity(ctx);
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName === "bash") {
			const command = typeof event.input.command === "string" ? event.input.command : "";
			if (command && GIT_COMMIT_RE.test(command)) {
				sawCommit = true;
			}
		}
		markActivity(ctx);
	});

	pi.on("tool_result", async (_event, ctx) => {
		markActivity(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		running = false;
		clearTimeout();
		setTitle(ctx, sawCommit ? "doneCommitted" : "doneNoCommit");
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		clearTimeout();
		if (!ctx.hasUI) return;
		ctx.ui.setTitle(`pi - ${cwdBase(ctx)}`);
	});
}
