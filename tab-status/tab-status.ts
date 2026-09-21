/**
 * Update the terminal tab title with Pi run status (:new/:running/:✅/:🚧/:🛑).
 */
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionStartEvent,
	BeforeAgentStartEvent,
	AgentStartEvent,
	AgentEndEvent,
	AgentSettledEvent,
	TurnStartEvent,
	ToolCallEvent,
	ToolResultEvent,
	SessionShutdownEvent,
} from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, StopReason } from "@earendil-works/pi-ai";
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
	let lastStopReason: StopReason | undefined;
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
		lastStopReason = undefined;
		clearTabTimeout();
		setTitle(ctx, next);
	};

	const beginRun = (ctx: ExtensionContext): void => {
		status.running = true;
		status.sawCommit = false;
		lastStopReason = undefined;
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

	pi.on("session_start", async (event: SessionStartEvent, ctx: ExtensionContext) => {
		resetState(ctx, event.reason === "resume" ? "doneCommitted" : "new");
	});

	pi.on("before_agent_start", async (_event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
		markActivity(ctx);
	});

	pi.on("agent_start", async (_event: AgentStartEvent, ctx: ExtensionContext) => {
		beginRun(ctx);
	});

	pi.on("turn_start", async (_event: TurnStartEvent, ctx: ExtensionContext) => {
		markActivity(ctx);
	});

	pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext) => {
		if (event.toolName === "bash") {
			const command = typeof event.input.command === "string" ? event.input.command : "";
			if (command && GIT_COMMIT_RE.test(command)) {
				status.sawCommit = true;
			}
		}
		markActivity(ctx);
	});

	pi.on("tool_result", async (_event: ToolResultEvent, ctx: ExtensionContext) => {
		markActivity(ctx);
	});

	pi.on("agent_end", async (event: AgentEndEvent) => {
		lastStopReason = getStopReason(event.messages);
	});

	pi.on("agent_settled", async (_event: AgentSettledEvent, ctx: ExtensionContext) => {
		status.running = false;
		clearTabTimeout();
		if (lastStopReason === "error") {
			setTitle(ctx, "timeout");
			return;
		}
		setTitle(ctx, status.sawCommit ? "doneCommitted" : "doneNoCommit");
	});

	pi.on("session_shutdown", async (_event: SessionShutdownEvent, ctx: ExtensionContext) => {
		clearTabTimeout();
		if (!ctx.hasUI) return;
		ctx.ui.setTitle(`pi - ${cwdBase(ctx)}`);
	});
}
