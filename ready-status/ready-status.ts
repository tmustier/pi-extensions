/**
 * Update the footer status with Pi run status (new/🕒/✅/🚧/🛑).
 */
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, StopReason } from "@mariozechner/pi-ai";
import type {
	AgentEndEvent,
	AgentStartEvent,
	BeforeAgentStartEvent,
	ExtensionAPI,
	ExtensionContext,
	SessionShutdownEvent,
	SessionStartEvent,
	SessionSwitchEvent,
	ToolCallEvent,
	ToolResultEvent,
	TurnStartEvent,
} from "@mariozechner/pi-coding-agent";

type StatusState = "new" | "running" | "doneCommitted" | "doneNoCommit" | "timeout";

type PersistedStatus = {
	state: StatusState;
};

const RUNNING_TICK_MS = 30_000;
const INACTIVE_TIMEOUT_MS = 180_000;
const MAX_RUNNING_STEPS = Math.floor(INACTIVE_TIMEOUT_MS / RUNNING_TICK_MS);
const GIT_COMMIT_RE = /\bgit\b[^\n]*\bcommit\b/;

export default function (pi: ExtensionAPI) {
	let state: StatusState = "new";
	let running = false;
	let sawCommit = false;
	let runningStep = 1;
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	let tickId: ReturnType<typeof setTimeout> | undefined;
	const nativeClearTimeout = globalThis.clearTimeout;
	const statusKey = "ready-status";

	const formatStatus = (ctx: ExtensionContext, next: StatusState): string => {
		const theme = ctx.ui.theme;
		switch (next) {
			case "new":
				return theme.fg("dim", "new");
			case "running":
				return theme.fg("accent", "🕒".repeat(Math.max(1, runningStep)));
			case "doneCommitted":
				return theme.fg("success", "✅ Ended turn with a commit");
			case "doneNoCommit":
				return theme.fg("warning", "🚧 Ended turn without a commit");
			case "timeout":
				return theme.fg("error", "🛑 TIMEOUT OR ERROR");
		}
	};

	const persistState = (next: StatusState): void => {
		if (next === "new") return;
		pi.appendEntry<PersistedStatus>(statusKey, { state: next });
	};

	const setStatus = (
		ctx: ExtensionContext,
		next: StatusState,
		options: { persist?: boolean } = {},
	): void => {
		const previous = state;
		state = next;
		if (ctx.hasUI) {
			ctx.ui.setStatus(statusKey, formatStatus(ctx, next));
		}
		if (options.persist === false) return;
		if (previous !== next) {
			persistState(next);
		}
	};

	const clearTimers = (): void => {
		if (timeoutId !== undefined) {
			nativeClearTimeout(timeoutId);
			timeoutId = undefined;
		}
		if (tickId !== undefined) {
			nativeClearTimeout(tickId);
			tickId = undefined;
		}
	};

	const scheduleTimeout = (ctx: ExtensionContext): void => {
		if (timeoutId !== undefined) {
			nativeClearTimeout(timeoutId);
		}
		timeoutId = setTimeout(() => {
			timeoutId = undefined;
			if (running && state === "running") {
				setStatus(ctx, "timeout");
			}
		}, INACTIVE_TIMEOUT_MS);
	};

	const scheduleTick = (ctx: ExtensionContext): void => {
		if (tickId !== undefined) {
			nativeClearTimeout(tickId);
		}
		tickId = setTimeout(() => {
			tickId = undefined;
			if (!running || state !== "running") return;
			runningStep = Math.min(runningStep + 1, MAX_RUNNING_STEPS);
			setStatus(ctx, "running");
			if (runningStep < MAX_RUNNING_STEPS) {
				scheduleTick(ctx);
			}
		}, RUNNING_TICK_MS);
	};

	const resetTimers = (ctx: ExtensionContext): void => {
		clearTimers();
		scheduleTimeout(ctx);
		scheduleTick(ctx);
	};

	const markActivity = (ctx: ExtensionContext): void => {
		if (state === "timeout") {
			runningStep = 1;
			setStatus(ctx, "running");
		}
		if (!running) return;
		runningStep = 1;
		setStatus(ctx, "running");
		resetTimers(ctx);
	};

	const resetState = (
		ctx: ExtensionContext,
		next: StatusState,
		options?: { persist?: boolean },
	): void => {
		running = false;
		sawCommit = false;
		runningStep = 1;
		clearTimers();
		setStatus(ctx, next, options);
	};

	const beginRun = (ctx: ExtensionContext, options?: { persist?: boolean }): void => {
		running = true;
		sawCommit = false;
		runningStep = 1;
		setStatus(ctx, "running", options);
		resetTimers(ctx);
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

	const getPersistedState = (ctx: ExtensionContext): StatusState | undefined => {
		const entries = ctx.sessionManager.getBranch();
		for (let i = entries.length - 1; i >= 0; i -= 1) {
			const entry = entries[i];
			if (entry.type === "custom" && entry.customType === statusKey) {
				const data = entry.data as PersistedStatus | undefined;
				return data?.state;
			}
		}
		return undefined;
	};

	const restoreState = (ctx: ExtensionContext): void => {
		const stored = getPersistedState(ctx);
		if (stored === "running") {
			beginRun(ctx, { persist: false });
			return;
		}
		if (stored) {
			resetState(ctx, stored, { persist: false });
			return;
		}
		resetState(ctx, "new", { persist: false });
	};

	pi.on("session_start", async (_event: SessionStartEvent, ctx: ExtensionContext) => {
		restoreState(ctx);
	});

	pi.on("session_switch", async (event: SessionSwitchEvent, ctx: ExtensionContext) => {
		if (event.reason === "new") {
			resetState(ctx, "new");
			return;
		}
		restoreState(ctx);
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
				sawCommit = true;
			}
		}
		markActivity(ctx);
	});

	pi.on("tool_result", async (_event: ToolResultEvent, ctx: ExtensionContext) => {
		markActivity(ctx);
	});

	pi.on("agent_end", async (event: AgentEndEvent, ctx: ExtensionContext) => {
		running = false;
		clearTimers();
		const stopReason = getStopReason(event.messages);
		if (stopReason === "error") {
			setStatus(ctx, "timeout");
			return;
		}
		setStatus(ctx, sawCommit ? "doneCommitted" : "doneNoCommit");
	});

	pi.on("session_shutdown", async (_event: SessionShutdownEvent, ctx: ExtensionContext) => {
		clearTimers();
		if (!ctx.hasUI) return;
		ctx.ui.setStatus(statusKey, undefined);
	});
}
