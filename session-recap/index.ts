import type { AssistantMessage } from "@earendil-works/pi-ai";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	applyDeprecatedFlagOverrides,
	loadConfig,
	shippedDefaults,
	type RecapConfig,
	type RecapReason,
} from "./config.ts";
import { FocusSequenceParser } from "./focus-parser.ts";
import { consumePendingAway, DeferredTriggerState, LiveActivityBuffer, LiveRecapState, type LiveRequest } from "./live-state.ts";
import {
	buildTranscript,
	extractText,
	generateRecap,
	hasMeaningfulActivity,
	recapStateKey,
	type CompleteFunction,
	type Entry,
	type RecapContext,
} from "./recap.ts";
import { clearOwnedStatus } from "./ui-state.ts";

function isAssistantMessage(message: unknown): message is AssistantMessage {
	return (
		typeof message === "object" &&
		message !== null &&
		"role" in message &&
		message.role === "assistant" &&
		"content" in message &&
		Array.isArray(message.content)
	);
}

function wrapText(text: string, width: number, maxLines: number): string[] {
	const output: string[] = [];
	for (const sourceLine of text.split("\n")) {
		let current = "";
		for (const word of sourceLine.split(/\s+/).filter(Boolean)) {
			if (current && current.length + word.length + 1 > width) {
				output.push(current);
				current = word;
			} else current = current ? `${current} ${word}` : word;
		}
		if (current) output.push(current);
	}
	if (output.length <= maxLines) return output;
	const kept = output.slice(0, maxLines);
	kept[maxLines - 1] = `${kept[maxLines - 1]} …`;
	return kept;
}

function focusConfigKey(config: RecapConfig): string {
	return JSON.stringify({ enabled: config.enabled.focusReporting, ...config.focus });
}

function activityOptions(config: RecapConfig) {
	return {
		assistantCharsPerVersion: config.activity.assistantCharsPerLiveVersion,
		toolUpdateCharsPerVersion: config.activity.toolUpdateCharsPerLiveVersion,
		maxEvents: config.activity.maxLiveEvents,
		maxEventChars: config.activity.maxLiveEventChars,
		maxRunningTools: config.activity.maxRunningTools,
		liveAssistantChars: config.transcript.liveAssistantChars,
	};
}

export default function sessionRecap(pi: ExtensionAPI) {
	pi.registerFlag("recap-config", {
		description: "Path to a session-recap JSON override (overrides PI_SESSION_RECAP_CONFIG)",
		type: "string",
		default: "",
	});
	for (const [name, description, type] of [
		["recap-away-seconds", "Deprecated: override timings.awayMs", "string"],
		["recap-idle-seconds", "Deprecated: override timings.idleMs", "string"],
		["recap-disable-focus", "Deprecated: set enabled.focusReporting=false", "boolean"],
		["recap-during-active", "Deprecated: set focus.allowAwayDuringAgent=true", "boolean"],
		["recap-disable", "Deprecated: set enabled.automatic=false", "boolean"],
		["recap-model", "Deprecated: prepend a provider/model candidate", "string"],
	] as const) {
		pi.registerFlag(name, { description, type, default: type === "boolean" ? false : "" });
	}

	let canonicalConfig = shippedDefaults();
	let config = applyDeprecatedFlagOverrides(canonicalConfig, {});
	let liveBuffer = new LiveActivityBuffer(activityOptions(config));
	const liveState = new LiveRecapState();
	const deferredAway = new DeferredTriggerState();
	let liveTimer: NodeJS.Timeout | undefined;
	let idleTimer: NodeJS.Timeout | undefined;
	let awayTimer: NodeJS.Timeout | undefined;
	let postTurnTimer: NodeJS.Timeout | undefined;
	let resumeTimer: NodeJS.Timeout | undefined;
	let focusedOutAt: number | undefined;
	let focusEventsSeen = false;
	let focusEnabled = false;
	let focusListener: ((chunk: Buffer) => void) | undefined;
	let focusDisableSequence = "";
	let renderedWidgetKey: string | undefined;
	let renderedStatusKey: string | undefined;
	let refreshFocusReporting: ((ctx: ExtensionContext) => void) | undefined;
	let agentActive = false;
	let focusDraftAfterAgent = false;
	let pendingAwayAfterRequest = false;
	let lastDraftedStateKey: string | undefined;
	let requestSerial = 0;
	let activeRequest:
		| { id: number; controller: AbortController; reason: RecapReason; liveRequest?: LiveRequest; statusKey?: string }
		| undefined;

	const clearTimer = (timer: NodeJS.Timeout | undefined): undefined => {
		if (timer) clearTimeout(timer);
		return undefined;
	};
	const stopLiveTimer = () => {
		if (liveTimer) clearInterval(liveTimer);
		liveTimer = undefined;
	};

	const flagString = (name: string): string => String(pi.getFlag(name) ?? "").trim();
	const reloadConfig = (ctx: ExtensionContext) => {
		const previous = config;
		const previousFocusKey = focusConfigKey(previous);
		const explicitPath = flagString("recap-config") || undefined;
		const result = loadConfig(
			{ cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted(), explicitPath },
			canonicalConfig,
			(message) => {
				console.error(message);
				if (ctx.hasUI) ctx.ui.notify(message, "warning");
			},
		);
		canonicalConfig = result.config;
		config = applyDeprecatedFlagOverrides(canonicalConfig, {
			awaySeconds: flagString("recap-away-seconds"),
			idleSeconds: flagString("recap-idle-seconds"),
			disableFocus: Boolean(pi.getFlag("recap-disable-focus")),
			duringActive: Boolean(pi.getFlag("recap-during-active")),
			disable: Boolean(pi.getFlag("recap-disable")),
			model: flagString("recap-model"),
		});
		if (ctx.hasUI && previous.widget.key !== config.widget.key) {
			ctx.ui.setWidget(renderedWidgetKey ?? previous.widget.key, undefined);
			renderedWidgetKey = undefined;
		}
		if (ctx.hasUI && previous.widget.statusKey !== config.widget.statusKey) {
			ctx.ui.setStatus(renderedStatusKey ?? previous.widget.statusKey, undefined);
			renderedStatusKey = undefined;
		}
		if (!agentActive) liveBuffer = new LiveActivityBuffer(activityOptions(config));
		if (previousFocusKey !== focusConfigKey(config)) refreshFocusReporting?.(ctx);
	};

	const showRecap = (ctx: ExtensionContext, recap: string) => {
		if (!ctx.hasUI) return;
		const theme = ctx.ui.theme;
		const headerColor = config.widget.headerColor as Parameters<typeof theme.fg>[0];
		const bodyColor = config.widget.bodyColor as Parameters<typeof theme.fg>[0];
		const header = theme.fg(headerColor, theme.bold(config.widget.header));
		const body = wrapText(recap, config.widget.wrapWidth, config.widget.maxBodyLines)
			.map((line) => theme.fg(bodyColor, line));
		if (renderedWidgetKey && renderedWidgetKey !== config.widget.key) ctx.ui.setWidget(renderedWidgetKey, undefined);
		ctx.ui.setWidget(config.widget.key, [header, ...body], { placement: config.widget.placement });
		renderedWidgetKey = config.widget.key;
	};
	const clearRecap = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		ctx.ui.setWidget(renderedWidgetKey ?? config.widget.key, undefined);
		ctx.ui.setStatus(renderedStatusKey ?? config.widget.statusKey, undefined);
		renderedWidgetKey = undefined;
		renderedStatusKey = undefined;
	};

	const cancelRequest = (ctx: ExtensionContext) => {
		if (!activeRequest) return;
		const request = activeRequest;
		request.controller.abort();
		if (request.liveRequest) liveState.cancel(request.liveRequest.id);
		if (ctx.hasUI) {
			renderedStatusKey = clearOwnedStatus(
				(key, value) => ctx.ui.setStatus(key, value),
				request.statusKey,
				renderedStatusKey,
			);
		}
		activeRequest = undefined;
	};

	const snapshot = (ctx: ExtensionContext, includeLive: boolean): { transcript: string; key: string; entries: Entry[] } => {
		const entries = ctx.sessionManager.getBranch() as Entry[];
		const transcript = buildTranscript(entries, config, includeLive ? liveBuffer.lines() : []);
		return { entries, transcript, key: recapStateKey(transcript) };
	};

	const startRecap = async (
		ctx: ExtensionContext,
		reason: RecapReason,
		options: { manual?: boolean; liveRequest?: LiveRequest } = {},
	) => {
		const releaseStateRequest = () => {
			if (options.liveRequest) liveState.cancel(options.liveRequest.id);
		};
		if (!ctx.hasUI) {
			releaseStateRequest();
			return;
		}
		if (options.manual) cancelRequest(ctx);
		else if (activeRequest) {
			releaseStateRequest();
			return;
		}
		const current = snapshot(ctx, reason === "live" || reason === "manual");
		if (!current.transcript.trim()) {
			releaseStateRequest();
			return;
		}
		if (reason !== "manual" && reason !== "live" && !hasMeaningfulActivity(current.entries, config)) {
			releaseStateRequest();
			return;
		}
		if (reason !== "manual" && lastDraftedStateKey === current.key) {
			releaseStateRequest();
			return;
		}

		const id = ++requestSerial;
		const controller = new AbortController();
		const requestStatusKey = reason === "manual" || reason === "idle" ? config.widget.statusKey : undefined;
		activeRequest = { id, controller, reason, liveRequest: options.liveRequest, statusKey: requestStatusKey };
		if (requestStatusKey) {
			const statusColor = config.widget.bodyColor as Parameters<typeof ctx.ui.theme.fg>[0];
			if (renderedStatusKey && renderedStatusKey !== requestStatusKey) ctx.ui.setStatus(renderedStatusKey, undefined);
			ctx.ui.setStatus(requestStatusKey, ctx.ui.theme.fg(statusColor, config.widget.draftingStatus));
			renderedStatusKey = requestStatusKey;
		}
		let displayed = false;
		try {
			const recap = await generateRecap(
				current.transcript,
				reason,
				ctx as unknown as RecapContext,
				config,
				controller.signal,
				completeSimple as unknown as CompleteFunction,
			);
			if (!recap || controller.signal.aborted || activeRequest?.id !== id) return;
			// Snapshot semantics: later activity does not invalidate this useful recap.
			// Request ownership prevents an older completion from replacing a newer one.
			lastDraftedStateKey = current.key;
			showRecap(ctx, recap);
			displayed = true;
			idleTimer = clearTimer(idleTimer);
			postTurnTimer = clearTimer(postTurnTimer);
		} catch (error) {
			if (!controller.signal.aborted) console.error("[session-recap] failed:", error);
		} finally {
			if (activeRequest?.id === id) {
				activeRequest = undefined;
				if (options.liveRequest) liveState.complete(options.liveRequest.id, Date.now(), displayed);
				renderedStatusKey = clearOwnedStatus(
					(key, value) => ctx.ui.setStatus(key, value),
					requestStatusKey,
					renderedStatusKey,
				);
				const pendingAway = consumePendingAway(
					pendingAwayAfterRequest,
					focusedOutAt !== undefined,
					config.enabled.automatic,
					config.enabled.away,
				);
				pendingAwayAfterRequest = pendingAway.pending;
				if (pendingAway.shouldSchedule) scheduleDeferredAway(ctx);
			}
		}
	};

	const markLiveActivity = (eventName: string, meaningful: boolean) => {
		if (meaningful && config.activity.liveEvents.includes(eventName)) liveState.activity();
	};
	const pollLive = (ctx: ExtensionContext) => {
		if (!config.enabled.automatic || !config.enabled.live || !agentActive || activeRequest) return;
		const request = liveState.beginLive(Date.now(), config.timings.liveFirstMs, config.timings.liveMinIntervalMs);
		if (request) void startRecap(ctx, "live", { liveRequest: request });
	};
	const startLiveTimer = (ctx: ExtensionContext) => {
		stopLiveTimer();
		if (!config.enabled.automatic || !config.enabled.live) return;
		liveTimer = setInterval(() => pollLive(ctx), config.timings.livePollMs);
	};

	const idleFallbackEligible = () => !focusEnabled || !config.enabled.focusReporting || !focusEventsSeen;
	const tryAwayRecap = (ctx: ExtensionContext) => {
		if (!config.enabled.automatic || !config.enabled.away || focusedOutAt === undefined) return;
		if (activeRequest) {
			pendingAwayAfterRequest = true;
			return;
		}
		if (agentActive && !config.focus.allowAwayDuringAgent) {
			focusDraftAfterAgent = true;
			return;
		}
		void startRecap(ctx, "away");
	};
	const scheduleDeferredAway = (ctx: ExtensionContext) => {
		const generation = deferredAway.arm();
		setTimeout(() => {
			if (!deferredAway.consume(generation)) return;
			tryAwayRecap(ctx);
		}, 0);
	};
	const scheduleIdle = (ctx: ExtensionContext) => {
		idleTimer = clearTimer(idleTimer);
		if (!config.enabled.automatic || !config.enabled.idle) return;
		idleTimer = setTimeout(() => {
			idleTimer = undefined;
			if (!config.enabled.automatic || !config.enabled.idle) return;
			if (idleFallbackEligible()) void startRecap(ctx, "idle");
		}, config.timings.idleMs);
	};

	const handleFocusOut = (ctx: ExtensionContext) => {
		focusEventsSeen = true;
		focusedOutAt = Date.now();
		idleTimer = clearTimer(idleTimer);
		awayTimer = clearTimer(awayTimer);
		if (!config.enabled.automatic || !config.enabled.away) return;
		awayTimer = setTimeout(() => {
			awayTimer = undefined;
			tryAwayRecap(ctx);
		}, config.timings.awayMs);
	};
	const handleFocusIn = (ctx: ExtensionContext) => {
		focusEventsSeen = true;
		focusedOutAt = undefined;
		focusDraftAfterAgent = false;
		pendingAwayAfterRequest = false;
		deferredAway.cancel();
		awayTimer = clearTimer(awayTimer);
		postTurnTimer = clearTimer(postTurnTimer);
		idleTimer = clearTimer(idleTimer);
		if (!config.focus.finishDraftAfterRefocus && activeRequest?.reason === "away") cancelRequest(ctx);
	};

	const attachFocusReporting = (ctx: ExtensionContext) => {
		if (focusEnabled || !config.enabled.focusReporting || !ctx.hasUI || !process.stdout.isTTY || !process.stdin.isTTY) return;
		const focus = { ...config.focus };
		try {
			process.stdout.write(focus.enableSequence);
		} catch {
			return;
		}
		const parser = new FocusSequenceParser(focus.inSequence, focus.outSequence, focus.inputBufferCap);
		focusListener = (chunk: Buffer) => {
			for (const event of parser.push(chunk.toString("binary"))) {
				if (event === "in") handleFocusIn(ctx);
				else handleFocusOut(ctx);
			}
		};
		process.stdin.on("data", focusListener);
		focusEnabled = true;
		focusDisableSequence = focus.disableSequence;
	};
	const detachFocusReporting = () => {
		if (focusListener) process.stdin.off("data", focusListener);
		focusListener = undefined;
		if (focusEnabled) {
			try { process.stdout.write(focusDisableSequence); } catch { /* best effort */ }
		}
		focusEnabled = false;
		focusedOutAt = undefined;
		focusDraftAfterAgent = false;
		pendingAwayAfterRequest = false;
		deferredAway.cancel();
	};
	refreshFocusReporting = (ctx) => {
		detachFocusReporting();
		focusEventsSeen = false;
		attachFocusReporting(ctx);
	};

	pi.on("message_update", async (event) => {
		if (!isAssistantMessage(event.message)) return;
		const meaningful = liveBuffer.assistantUpdate(extractText(event.message.content));
		markLiveActivity("message_update", meaningful);
	});
	pi.on("message_end", async (event) => {
		if (!isAssistantMessage(event.message)) return;
		markLiveActivity("message_end", liveBuffer.messageEnd(extractText(event.message.content)));
	});
	pi.on("tool_execution_start", async (event) => {
		markLiveActivity("tool_execution_start", liveBuffer.toolStart(event.toolCallId, event.toolName, event.args));
	});
	pi.on("tool_execution_update", async (event) => {
		markLiveActivity("tool_execution_update", liveBuffer.toolUpdate(event.toolCallId, event.toolName, event.partialResult));
	});
	pi.on("tool_execution_end", async (event) => {
		markLiveActivity("tool_execution_end", liveBuffer.toolEnd(event.toolCallId, event.toolName, event.result, event.isError));
	});
	pi.on("turn_end", async (_event, ctx) => {
		markLiveActivity("turn_end", liveBuffer.turnEnd());
		if (!config.enabled.automatic) return;
		if (focusedOutAt !== undefined && config.enabled.away) {
			postTurnTimer = clearTimer(postTurnTimer);
			postTurnTimer = setTimeout(() => {
				postTurnTimer = undefined;
				tryAwayRecap(ctx);
			}, config.timings.postTurnDebounceMs);
		}
		if (idleFallbackEligible()) scheduleIdle(ctx);
	});
	pi.on("turn_start", async (_event, ctx) => {
		idleTimer = clearTimer(idleTimer);
		postTurnTimer = clearTimer(postTurnTimer);
		if (config.lifecycle.clearOnTurnStart) clearRecap(ctx);
	});
	pi.on("input", async (_event, ctx) => {
		focusedOutAt = undefined;
		deferredAway.cancel();
		idleTimer = clearTimer(idleTimer);
		awayTimer = clearTimer(awayTimer);
		postTurnTimer = clearTimer(postTurnTimer);
		resumeTimer = clearTimer(resumeTimer);
		cancelRequest(ctx);
		focusDraftAfterAgent = false;
		pendingAwayAfterRequest = false;
		if (config.lifecycle.clearOnInput) clearRecap(ctx);
	});
	pi.on("agent_start", async (_event, ctx) => {
		reloadConfig(ctx);
		resumeTimer = clearTimer(resumeTimer);
		cancelRequest(ctx);
		agentActive = true;
		liveBuffer.reset();
		liveState.start(Date.now());
		idleTimer = clearTimer(idleTimer);
		postTurnTimer = clearTimer(postTurnTimer);
		if (config.lifecycle.clearOnAgentStart) clearRecap(ctx);
		startLiveTimer(ctx);
	});
	pi.on("agent_end", async (_event, ctx) => {
		agentActive = false;
		stopLiveTimer();
		liveState.stop();
		let shouldScheduleAway = false;
		if (config.lifecycle.liveWidgetOnAgentEnd === "clear") {
			if (activeRequest?.reason === "live") {
				cancelRequest(ctx);
				const pendingAway = consumePendingAway(
					pendingAwayAfterRequest,
					focusedOutAt !== undefined,
					config.enabled.automatic,
					config.enabled.away,
				);
				pendingAwayAfterRequest = pendingAway.pending;
				shouldScheduleAway = pendingAway.shouldSchedule;
			}
			clearRecap(ctx);
		}
		if (focusDraftAfterAgent) {
			focusDraftAfterAgent = false;
			shouldScheduleAway = true;
		}
		if (shouldScheduleAway) scheduleDeferredAway(ctx);
	});
	pi.on("session_start", async (event, ctx) => {
		reloadConfig(ctx);
		resumeTimer = clearTimer(resumeTimer);
		attachFocusReporting(ctx);
		if (!config.enabled.automatic || !config.enabled.resume || !ctx.hasUI) return;
		if (event.reason === "resume" || event.reason === "fork") {
			if (!config.lifecycle.persistWidgetAcrossResume) clearRecap(ctx);
			resumeTimer = setTimeout(() => {
				resumeTimer = undefined;
				if (!config.enabled.automatic || !config.enabled.resume || !ctx.hasUI) return;
				void startRecap(ctx, "resume");
			}, config.timings.resumeDelayMs);
		}
	});
	pi.on("session_shutdown", async (_event, ctx) => {
		agentActive = false;
		stopLiveTimer();
		liveState.stop();
		idleTimer = clearTimer(idleTimer);
		awayTimer = clearTimer(awayTimer);
		postTurnTimer = clearTimer(postTurnTimer);
		resumeTimer = clearTimer(resumeTimer);
		cancelRequest(ctx);
		pendingAwayAfterRequest = false;
		deferredAway.cancel();
		detachFocusReporting();
		if (config.lifecycle.clearOnSessionShutdown) clearRecap(ctx);
	});

	pi.registerCommand("recap", {
		description: "Generate a recap of recent session activity",
		handler: async (_args, ctx) => {
			reloadConfig(ctx);
			if (!config.enabled.manual) return;
			cancelRequest(ctx);
			const { request } = liveState.beginManual();
			await startRecap(ctx, "manual", { manual: true, liveRequest: request });
		},
	});
}
