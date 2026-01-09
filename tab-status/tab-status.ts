/**
 * Update the terminal tab title with Pi run status (:new/:running/:✅/:🚧/:🛑).
 */
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { basename } from "node:path";

type StatusState = "new" | "running" | "doneCommitted" | "doneNoCommit" | "timeout";

type StatusTracker = {
	state: StatusState;
	running: boolean;
	sawCommit: boolean;
	sawError: boolean;
};

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
	const status: StatusTracker = {
		state: "new",
		running: false,
		sawCommit: false,
		sawError: false,
	};
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const nativeClearTimeout = globalThis.clearTimeout;

	const cwdBase = (ctx: ExtensionContext) => basename(ctx.cwd || "pi");

	const setTitle = (ctx: ExtensionContext, next: StatusState) => {
		status.state = next;
		if (!ctx.hasUI) return;
		ctx.ui.setTitle(`pi - ${cwdBase(ctx)}${STATUS_TEXT[next]}`);
	};

	const clearTabTimeout = () => {
		if (timeoutId === undefined) return;
		nativeClearTimeout(timeoutId);
		timeoutId = undefined;
	};

	const resetTimeout = (ctx: ExtensionContext) => {
		clearTabTimeout();
		timeoutId = setTimeout(() => {
			if (status.running && status.state === "running") {
				setTitle(ctx, "timeout");
			}
		}, INACTIVE_TIMEOUT_MS);
	};

	const markActivity = (ctx: ExtensionContext) => {
		if (status.state === "timeout") {
			setTitle(ctx, "running");
		}
		if (!status.running) return;
		resetTimeout(ctx);
	};

	const resetState = (ctx: ExtensionContext, next: StatusState) => {
		status.running = false;
		status.sawCommit = false;
		status.sawError = false;
		clearTabTimeout();
		setTitle(ctx, next);
	};

	const beginRun = (ctx: ExtensionContext) => {
		status.running = true;
		status.sawCommit = false;
		status.sawError = false;
		setTitle(ctx, "running");
		resetTimeout(ctx);
	};

	const getStopReason = (messages: AgentMessage[]) => {
		for (let i = messages.length - 1; i >= 0; i -= 1) {
			const message = messages[i];
			if (message.role === "assistant") {
				return message.stopReason;
			}
		}
		return undefined;
	};

	const shouldShowTimeout = (stopReason: AgentMessage["stopReason"]) => {
		return stopReason === "error" || (status.sawError && stopReason !== "aborted");
	};

	const handlers = [
		[
			"session_start",
			async (_event: unknown, ctx: ExtensionContext) => {
				resetState(ctx, "new");
			},
		],
		[
			"session_switch",
			async (event: { reason: "new" | "resume" }, ctx: ExtensionContext) => {
				resetState(ctx, event.reason === "new" ? "new" : "doneCommitted");
			},
		],
		[
			"before_agent_start",
			async (_event: unknown, ctx: ExtensionContext) => {
				markActivity(ctx);
			},
		],
		[
			"agent_start",
			async (_event: unknown, ctx: ExtensionContext) => {
				beginRun(ctx);
			},
		],
		[
			"turn_start",
			async (_event: unknown, ctx: ExtensionContext) => {
				markActivity(ctx);
			},
		],
		[
			"tool_call",
			async (event: { toolName: string; input: Record<string, unknown> }, ctx: ExtensionContext) => {
				if (event.toolName === "bash") {
					const command = typeof event.input.command === "string" ? event.input.command : "";
					if (command && GIT_COMMIT_RE.test(command)) {
						status.sawCommit = true;
					}
				}
				markActivity(ctx);
			},
		],
		[
			"tool_result",
			async (event: { isError: boolean }, ctx: ExtensionContext) => {
				if (event.isError) {
					status.sawError = true;
				}
				markActivity(ctx);
			},
		],
		[
			"agent_end",
			async (event: { messages: AgentMessage[] }, ctx: ExtensionContext) => {
				status.running = false;
				clearTabTimeout();
				const stopReason = getStopReason(event.messages);
				if (shouldShowTimeout(stopReason)) {
					setTitle(ctx, "timeout");
					return;
				}
				setTitle(ctx, status.sawCommit ? "doneCommitted" : "doneNoCommit");
			},
		],
		[
			"session_shutdown",
			async (_event: unknown, ctx: ExtensionContext) => {
				clearTabTimeout();
				if (!ctx.hasUI) return;
				ctx.ui.setTitle(`pi - ${cwdBase(ctx)}`);
			},
		],
	] as const;

	for (const [event, handler] of handlers) {
		pi.on(event, handler as (event: unknown, ctx: ExtensionContext) => void);
	}
}
