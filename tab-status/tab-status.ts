/**
 * Update the terminal tab title with Pi run status (:new/:running/:✅/:🚧/:🛑).
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { StopReason } from "@earendil-works/pi-ai";
import { basename } from "node:path";

type StatusState = "new" | "running" | "doneCommitted" | "doneNoCommit" | "timeout";

const STATUS_TEXT: Record<StatusState, string> = {
	new: ":new",
	running: ":running...",
	doneCommitted: ":✅",
	doneNoCommit: ":🚧",
	timeout: ":🛑",
};

const INACTIVE_TIMEOUT_MS = 180_000;
const GIT_COMMIT_RE = /\bgit\b[^\n]*\bcommit\b/;

export default function (pi: ExtensionAPI) {
	let state: StatusState = "new";
	let running = false;
	let sawCommit = false;
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	let lastStopReason: StopReason | undefined;

	const cwdBase = (ctx: ExtensionContext): string => basename(ctx.cwd || "pi");

	// Session replacement invalidates the ctx that was live during the run, but
	// Pi may still deliver a trailing agent_settled (and our own inactivity timer
	// may still fire) with that stale ctx. Reading its getters throws, so treat
	// such events as no-ops instead of surfacing an extension error.
	const staleContexts = new WeakSet<ExtensionContext>();
	const isStale = (error: unknown): boolean =>
		error instanceof Error && error.message.includes("ctx is stale after session replacement");

	const setTitle = (ctx: ExtensionContext, next: StatusState): void => {
		state = next;
		if (staleContexts.has(ctx)) return;
		try {
			if (!ctx.hasUI) return;
			ctx.ui.setTitle(`pi - ${cwdBase(ctx)}${STATUS_TEXT[next]}`);
		} catch (error) {
			if (!isStale(error)) throw error;
			staleContexts.add(ctx);
		}
	};

	const clearTabTimeout = (): void => {
		if (timeoutId === undefined) return;
		clearTimeout(timeoutId);
		timeoutId = undefined;
	};

	const resetTimeout = (ctx: ExtensionContext): void => {
		clearTabTimeout();
		timeoutId = setTimeout(() => {
			if (running && state === "running") setTitle(ctx, "timeout");
		}, INACTIVE_TIMEOUT_MS);
	};

	const markActivity = (ctx: ExtensionContext): void => {
		if (state === "timeout") setTitle(ctx, "running");
		if (running) resetTimeout(ctx);
	};

	pi.on("session_start", (event, ctx) => {
		staleContexts.delete(ctx);
		running = false;
		sawCommit = false;
		lastStopReason = undefined;
		clearTabTimeout();
		setTitle(ctx, event.reason === "resume" ? "doneCommitted" : "new");
	});

	pi.on("before_agent_start", (_event, ctx) => markActivity(ctx));

	pi.on("agent_start", (_event, ctx) => {
		if (!running) sawCommit = false;
		running = true;
		lastStopReason = undefined;
		setTitle(ctx, "running");
		resetTimeout(ctx);
	});

	pi.on("turn_start", (_event, ctx) => markActivity(ctx));

	pi.on("tool_call", (event, ctx) => {
		const command = event.toolName === "bash" ? event.input.command : undefined;
		if (typeof command === "string" && GIT_COMMIT_RE.test(command)) sawCommit = true;
		markActivity(ctx);
	});

	pi.on("tool_result", (_event, ctx) => markActivity(ctx));

	pi.on("agent_end", (event) => {
		lastStopReason = undefined;
		for (let i = event.messages.length - 1; i >= 0; i -= 1) {
			const message = event.messages[i];
			if (message.role !== "assistant") continue;
			lastStopReason = message.stopReason;
			break;
		}
	});

	pi.on("agent_settled", (_event, ctx) => {
		running = false;
		clearTabTimeout();
		if (lastStopReason === "error") setTitle(ctx, "timeout");
		else setTitle(ctx, sawCommit ? "doneCommitted" : "doneNoCommit");
	});

	pi.on("session_shutdown", (_event, ctx) => {
		clearTabTimeout();
		try {
			if (ctx.hasUI) ctx.ui.setTitle(`pi - ${cwdBase(ctx)}`);
		} catch (error) {
			if (!isStale(error)) throw error;
		}
	});
}
