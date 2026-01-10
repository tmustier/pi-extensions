/**
 * Update the terminal tab title with Pi run status (:new/:running/:✅/:🚧/:🛑).
 */
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionStartEvent,
	SessionSwitchEvent,
	BeforeAgentStartEvent,
	AgentStartEvent,
	AgentEndEvent,
	TurnStartEvent,
	ToolCallEvent,
	ToolResultEvent,
	SessionShutdownEvent,
} from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, StopReason } from "@mariozechner/pi-ai";
import { basename } from "node:path";

type StatusState = "new" | "running" | "doneCommitted" | "doneNoCommit" | "timeout";

type StatusTracker = {
	state: StatusState;
	running: boolean;
	sawCommit: boolean;
};

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
	const status: StatusTracker = {
		state: "new",
		running: false,
		sawCommit: false,
	};
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const nativeClearTimeout = globalThis.clearTimeout;

	const cwdBase = (ctx: ExtensionContext): string => basename(ctx.cwd || "pi");

	const setTitle = (ctx: ExtensionContext, next: StatusState): void => {
		status.state = next;
		if (!ctx.hasUI) return;
		ctx.ui.setTitle(`pi - ${cwdBase(ctx)}${STATUS_TEXT[next]}`);
	};

	const clearTabTimeout = (): void => {
		if (timeoutId === undefined) return;
		nativeClearTimeout(timeoutId);
		timeoutId = undefined;
	};

	const resetTimeout = (ctx: ExtensionContext): void => {
		clearTabTimeout();
		timeoutId = setTimeout(() => {
			if (status.running && status.state === "running") {
				setTitle(ctx, "timeout");
			}
		}, INACTIVE_TIMEOUT_MS);
	};

	const markActivity = (ctx: ExtensionContext): void => {
		if (status.state === "timeout") {
			setTitle(ctx, "running");
		}
		if (!status.running) return;
		resetTimeout(ctx);
	};

	const resetState = (ctx: ExtensionContext, next: StatusState): void => {
		status.running = false;
		status.sawCommit = false;
		clearTabTimeout();
		setTitle(ctx, next);
	};

	const beginRun = (ctx: ExtensionContext): void => {
		status.running = true;
		status.sawCommit = false;
		setTitle(ctx, "running");
		resetTimeout(ctx);
	};

	const getStopReason = (messages: AgentMessage[]): StopReason | undefined => {
		for (let i = messages.length - 1; i >= 0; i -= 1) {
			const message = messages[i];
			if (message.role === "assistant") {
				return (message as AssistantMessage).stopReason;
			}
		}
		return undefined;
	};

	const handlers = [
		[
			"session_start",
			async (_event: SessionStartEvent, ctx: ExtensionContext) => {
				resetState(ctx, "new");
			},
		],
		[
			"session_switch",
			async (event: SessionSwitchEvent, ctx: ExtensionContext) => {
				resetState(ctx, event.reason === "new" ? "new" : "doneCommitted");
			},
		],
		[
			"before_agent_start",
			async (_event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
				markActivity(ctx);
			},
		],
		[
			"agent_start",
			async (_event: AgentStartEvent, ctx: ExtensionContext) => {
				beginRun(ctx);
			},
		],
		[
			"turn_start",
			async (_event: TurnStartEvent, ctx: ExtensionContext) => {
				markActivity(ctx);
			},
		],
		[
			"tool_call",
			async (event: ToolCallEvent, ctx: ExtensionContext) => {
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
			async (_event: ToolResultEvent, ctx: ExtensionContext) => {
				markActivity(ctx);
			},
		],
		[
			"agent_end",
			async (event: AgentEndEvent, ctx: ExtensionContext) => {
				status.running = false;
				clearTabTimeout();
				const stopReason = getStopReason(event.messages);
				if (stopReason === "error") {
					setTitle(ctx, "timeout");
					return;
				}
				setTitle(ctx, status.sawCommit ? "doneCommitted" : "doneNoCommit");
			},
		],
		[
			"session_shutdown",
			async (_event: SessionShutdownEvent, ctx: ExtensionContext) => {
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
