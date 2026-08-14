/**
 * Drafts a short Claude Code-style recap after the user has been away.
 * See README.md for triggers, flags, and model selection.
 */

import type { Message } from "@earendil-works/pi-ai";
import { complete, completeSimple } from "@earendil-works/pi-ai/compat";
import {
	convertToLlm,
	sessionEntryToContextMessages,
	type ExtensionAPI,
	type ExtensionContext,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { Container, Text, type Component, type TUI } from "@earendil-works/pi-tui";

type Model = Parameters<typeof completeSimple>[0];

type RecapContext = {
	messages: Message[];
	broaderContext?: string;
};

type RecapReason = "idle" | "manual" | "resume" | "focus";

const RECAP_KEY = "session-recap";

const DEFAULT_AWAY_SECONDS = 90;
const DEFAULT_IDLE_SECONDS = 120;
const ANTHROPIC_RECAP_MODEL = "claude-haiku-4-5";
const GPT_MODEL_ID = /(?:^|\/)gpt-/;
const LUNA_RECAP_MODEL = /(?:^|\/)gpt-5[.-]6-luna(?:$|[@:])/;

// Debounce after a turn ends while blurred, so mid-loop turn_ends (which are
// immediately followed by the next turn_start) don't trigger drafts.
const POST_TURN_DEBOUNCE_MS = 3000;

// `completeSimple` cannot express "reasoning off": its `reasoning` option only
// accepts real thinking levels. Omitting it disables thinking on every API we
// use except openai-codex-responses, which sends no reasoning field at all and
// so inherits the server-side default. Those models go through `complete` with
// an explicit `reasoningEffort: "none"` instead.
const NEEDS_EXPLICIT_REASONING_OFF = new Set(["openai-codex-responses"]);

const RECENT_MESSAGE_WINDOW = 30;
const MIN_ASSISTANT_WORDS = 30;
const INITIAL_TASK_EDGE_CHARS = 4000;
const TOOL_RESULT_EDGE_CHARS = 2000;

// DECSET 1004 focus reporting — https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
const FOCUS_ENABLE = "\x1b[?1004h";
const FOCUS_DISABLE = "\x1b[?1004l";
const FOCUS_IN_SEQ = "\x1b[I";
const FOCUS_OUT_SEQ = "\x1b[O";

function extractText(content: Message["content"]): string {
	if (typeof content === "string") return content;
	return content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

export function buildRecapContext(
	contextEntries: SessionEntry[],
	branchEntries: SessionEntry[],
): RecapContext {
	let summary: string | undefined;
	for (let i = contextEntries.length - 1; i >= 0; i--) {
		const entry = contextEntries[i];
		const candidate =
			entry.type === "compaction" || entry.type === "branch_summary" ? entry.summary.trim() : undefined;
		if (candidate) {
			summary = candidate;
			break;
		}
	}

	let initialTask: string | undefined;
	for (const entry of branchEntries) {
		if (entry.type !== "message" || entry.message.role !== "user") continue;
		initialTask = extractText(entry.message.content).trim() || undefined;
		break;
	}

	const messages = convertToLlm(
		contextEntries
			.filter((entry) => entry.type !== "compaction" && entry.type !== "branch_summary")
			.flatMap(sessionEntryToContextMessages),
	).map((message) => {
		if (message.role !== "toolResult") return message;
		return {
			...message,
			content: message.content.map((block) => {
				if (block.type !== "text" || block.text.length <= TOOL_RESULT_EDGE_CHARS * 2) return block;
				return {
					...block,
					text: `${block.text.slice(0, TOOL_RESULT_EDGE_CHARS)}\n… [tool result truncated for recap] …\n${block.text.slice(-TOOL_RESULT_EDGE_CHARS)}`,
				};
			}),
		};
	});
	let start = Math.max(0, messages.length - RECENT_MESSAGE_WINDOW);
	while (start > 0 && messages[start].role === "toolResult") start--;
	let recentMessages = messages.slice(start);
	if (recentMessages[0]?.role === "assistant") {
		recentMessages = [
			{
				role: "user",
				content: "(Earlier conversation omitted.)",
				timestamp: recentMessages[0].timestamp,
			},
			...recentMessages,
		];
	}

	const broader: string[] = [];
	const initialTaskInRecent = recentMessages.some(
		(message) => message.role === "user" && extractText(message.content).trim() === initialTask,
	);
	if (initialTask && !initialTaskInRecent) {
		const framedInitialTask =
			initialTask.length <= INITIAL_TASK_EDGE_CHARS * 2
				? initialTask
				: `${initialTask.slice(0, INITIAL_TASK_EDGE_CHARS)}\n… [middle of initial request omitted for recap] …\n${initialTask.slice(-INITIAL_TASK_EDGE_CHARS)}`;
		broader.push(`Initial user request:\n${framedInitialTask}`);
	}
	if (summary) broader.push(`Session summary:\n${summary}`);

	return {
		messages: recentMessages,
		broaderContext: broader.length > 0 ? broader.join("\n\n") : undefined,
	};
}

function hasMeaningfulActivity(entries: SessionEntry[]): boolean {
	let lastUserIdx = -1;
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (e.type === "message" && e.message.role === "user") {
			lastUserIdx = i;
			break;
		}
	}
	const tail = lastUserIdx >= 0 ? entries.slice(lastUserIdx + 1) : entries;
	let assistantWords = 0;
	let toolCalls = 0;
	for (const e of tail) {
		if (e.type !== "message" || e.message.role !== "assistant") continue;
		assistantWords += extractText(e.message.content).split(/\s+/).filter(Boolean).length;
		toolCalls += e.message.content.filter((block) => block.type === "toolCall").length;
	}
	return toolCalls > 0 || assistantWords >= MIN_ASSISTANT_WORDS;
}

export function selectRecapModel(
	activeModel: Model | undefined,
	overrideSpec: string | undefined,
	registry: Pick<ExtensionContext["modelRegistry"], "find" | "getAvailable">,
): Model | undefined {
	if (overrideSpec) {
		const slash = overrideSpec.indexOf("/");
		if (slash <= 0) return activeModel;
		return registry.find(overrideSpec.slice(0, slash), overrideSpec.slice(slash + 1)) ?? activeModel;
	}
	if (!activeModel) return undefined;

	const available = registry
		.getAvailable()
		.filter((model) => model.provider === activeModel.provider);
	if (activeModel.provider === "anthropic") {
		return available.find((model) => model.id === ANTHROPIC_RECAP_MODEL) ?? activeModel;
	}
	if (!GPT_MODEL_ID.test(activeModel.id)) return activeModel;
	return available.find((model) => LUNA_RECAP_MODEL.test(model.id)) ?? activeModel;
}

async function generateRecap(
	recapContext: RecapContext,
	ctx: ExtensionContext,
	overrideSpec: string | undefined,
	signal: AbortSignal | undefined,
): Promise<string | undefined> {
	const model = selectRecapModel(ctx.model, overrideSpec, ctx.modelRegistry);
	if (!model) return undefined;

	// Ambient-auth providers can succeed without returning an API key.
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth?.ok) return undefined;

	const prompt =
		(recapContext.broaderContext
			? `Broader session context:\n${recapContext.broaderContext}\n\n`
			: "") +
		"The user stepped away and is coming back. Write exactly 1-3 short sentences. " +
		"Start by stating the high-level task — what they are building or debugging, not " +
		"implementation details. Next: the concrete next step. Skip status reports and commit recaps.";

	const context = {
		systemPrompt: "",
		messages: [
			...recapContext.messages,
			{
				role: "user" as const,
				content: [{ type: "text" as const, text: prompt }],
				timestamp: Date.now(),
			},
		],
	};
	const options = {
		apiKey: auth.apiKey,
		headers: auth.headers,
		env: auth.env,
		signal,
		cacheRetention: "none" as const,
		maxTokens: 256,
	};

	let response;
	try {
		// Recaps never need reasoning; skipping it keeps each away-timer fire cheap.
		response = NEEDS_EXPLICIT_REASONING_OFF.has(model.api)
			? await complete(model, context, { ...options, reasoningEffort: "none" })
			: await completeSimple(model, context, options);
	} catch (err) {
		// completeSimple cannot route custom handlers registered only inside Pi.
		if (err instanceof Error && err.message.startsWith("No API provider registered for api:")) {
			return undefined;
		}
		throw err;
	}

	const text = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();

	return text || undefined;
}

function clearRecap(ctx: ExtensionContext) {
	if (!ctx.hasUI) return;
	ctx.ui.setWidget(RECAP_KEY, undefined);
	ctx.ui.setStatus(RECAP_KEY, undefined);
}

export function showRecap(ctx: ExtensionContext, recap: string) {
	const theme = ctx.ui.theme;
	const header = theme.fg("accent", theme.bold("✦ recap"));
	const body = theme.fg("dim", recap);
	let tui!: TUI;
	ctx.ui.setWidget(
		RECAP_KEY,
		(candidate) => {
			tui = candidate;
			return new Container();
		},
		{ placement: "belowEditor" },
	);

	// Pi mounts the scrollable document as its first TUI child.
	const document = tui.children[0];
	if (tui.mode !== "fullscreen" || !(document instanceof Container)) {
		ctx.ui.setWidget(RECAP_KEY, [header, body], { placement: "aboveEditor" });
		return;
	}

	const content = new Container();
	content.addChild(new Text(header, 1, 0));
	content.addChild(new Text(body, 1, 0));
	const transcriptRecap: Component = {
		render: (width) => (tui.mode === "fullscreen" ? content.render(width) : []),
		invalidate: () => content.invalidate(),
	};
	document.addChild(transcriptRecap);

	ctx.ui.setWidget(
		RECAP_KEY,
		() => ({
			render: () => [],
			invalidate: () => {},
			dispose: () => document.removeChild(transcriptRecap),
		}),
		{ placement: "belowEditor" },
	);
}

export default function (pi: ExtensionAPI) {
	pi.registerFlag("recap-away-seconds", {
		description: "Seconds of continuous terminal blur before an away recap is generated",
		type: "string",
		default: String(DEFAULT_AWAY_SECONDS),
	});
	pi.registerFlag("recap-idle-seconds", {
		description:
			"Idle-fallback: seconds after turn_end before a recap when the terminal doesn't report focus",
		type: "string",
		default: String(DEFAULT_IDLE_SECONDS),
	});
	pi.registerFlag("recap-disable-focus", {
		description: "Disable DECSET ?1004 focus reporting (idle fallback still runs)",
		type: "boolean",
		default: false,
	});
	pi.registerFlag("recap-during-active", {
		description: "Allow away recaps while an agent turn is still running",
		type: "boolean",
		default: false,
	});
	pi.registerFlag("recap-disable", {
		description: "Disable the automatic session recap",
		type: "boolean",
		default: false,
	});
	pi.registerFlag("recap-model", {
		description: "Override automatic model selection, e.g. anthropic/claude-sonnet-4-6",
		type: "string",
		default: "",
	});

	let idleTimer: NodeJS.Timeout | undefined;
	let awayTimer: NodeJS.Timeout | undefined;
	let postTurnTimer: NodeJS.Timeout | undefined;
	let activeController: AbortController | undefined;
	let agentActive = false;
	let awayRecapPending = false;
	let focusListener: ((chunk: Buffer) => void) | undefined;
	let focusEnabled = false;
	let isBlurred = false;
	let focusEventsSeen = false;
	let lastDraftedContext: string | undefined;

	const flagMilliseconds = (name: string, fallback: number): number => {
		const seconds = Number(pi.getFlag(name) ?? fallback);
		return Math.max(5, Number.isFinite(seconds) ? seconds : fallback) * 1000;
	};
	const isDisabled = (): boolean => Boolean(pi.getFlag("recap-disable"));

	const clearIdleTimer = () => {
		if (idleTimer) {
			clearTimeout(idleTimer);
			idleTimer = undefined;
		}
	};
	const clearAwayTimer = () => {
		if (awayTimer) {
			clearTimeout(awayTimer);
			awayTimer = undefined;
		}
	};
	const clearPostTurnTimer = () => {
		if (postTurnTimer) {
			clearTimeout(postTurnTimer);
			postTurnTimer = undefined;
		}
	};

	const cancelActive = () => {
		activeController?.abort();
		activeController = undefined;
	};

	const generateAndShow = async (ctx: ExtensionContext, reason: RecapReason) => {
		if (!ctx.hasUI) return;
		const entries = ctx.sessionManager.getBranch();
		if (reason !== "manual" && !hasMeaningfulActivity(entries)) return;

		const recapContext = buildRecapContext(ctx.sessionManager.buildContextEntries(), entries);
		if (recapContext.messages.length === 0 && !recapContext.broaderContext) return;

		const startContext = JSON.stringify(recapContext);
		if (reason !== "manual" && lastDraftedContext === startContext) return;

		cancelActive();
		const controller = new AbortController();
		activeController = controller;

		const showStatus = reason === "manual" || reason === "idle";
		if (showStatus) ctx.ui.setStatus(RECAP_KEY, ctx.ui.theme.fg("dim", "✦ drafting recap…"));

		try {
			const override = String(pi.getFlag("recap-model") ?? "").trim() || undefined;
			const recap = await generateRecap(recapContext, ctx, override, controller.signal);
			if (!recap || controller.signal.aborted) return;
			const currentContext = buildRecapContext(
				ctx.sessionManager.buildContextEntries(),
				ctx.sessionManager.getBranch(),
			);
			if (JSON.stringify(currentContext) !== startContext) return;

			lastDraftedContext = startContext;
			clearIdleTimer();
			clearPostTurnTimer();

			showRecap(ctx, recap);
		} catch (err) {
			if (!controller.signal.aborted) console.error("[session-recap] failed:", err);
		} finally {
			if (activeController === controller) {
				activeController = undefined;
				if (showStatus) ctx.ui.setStatus(RECAP_KEY, undefined);
			}
		}
	};

	const tryAwayRecap = (ctx: ExtensionContext) => {
		if (isDisabled() || !ctx.hasUI || !isBlurred) return;
		if (agentActive && !pi.getFlag("recap-during-active")) {
			awayRecapPending = true;
			return;
		}
		if (!activeController) void generateAndShow(ctx, "focus");
	};

	const handleFocusOut = (ctx: ExtensionContext) => {
		focusEventsSeen = true;
		isBlurred = true;
		clearIdleTimer();
		if (isDisabled()) return;
		clearAwayTimer();
		awayTimer = setTimeout(() => {
			awayTimer = undefined;
			tryAwayRecap(ctx);
		}, flagMilliseconds("recap-away-seconds", DEFAULT_AWAY_SECONDS));
	};

	const handleFocusIn = () => {
		focusEventsSeen = true;
		isBlurred = false;
		awayRecapPending = false;
		clearAwayTimer();
		clearPostTurnTimer();
		clearIdleTimer();
		// Leave an in-flight recap to land as the user returns.
	};

	const attachFocusReporting = (ctx: ExtensionContext) => {
		if (focusEnabled || pi.getFlag("recap-disable-focus") || !ctx.hasUI) return;
		if (!process.stdout.isTTY || !process.stdin.isTTY) return;

		try {
			process.stdout.write(FOCUS_ENABLE);
		} catch {
			return;
		}

		// Focus sequences may straddle input chunks, so retain the unmatched tail.
		const MAX_SEQ = Math.max(FOCUS_IN_SEQ.length, FOCUS_OUT_SEQ.length);
		let buf = "";
		const listener = (chunk: Buffer) => {
			buf += chunk.toString("binary");
			let i = 0;
			while (i + MAX_SEQ <= buf.length) {
				if (buf.startsWith(FOCUS_IN_SEQ, i)) {
					handleFocusIn();
					i += FOCUS_IN_SEQ.length;
				} else if (buf.startsWith(FOCUS_OUT_SEQ, i)) {
					handleFocusOut(ctx);
					i += FOCUS_OUT_SEQ.length;
				} else {
					i++;
				}
			}
			buf = buf.slice(i);
		};
		process.stdin.on("data", listener);
		focusListener = listener;
		focusEnabled = true;
	};

	const detachFocusReporting = () => {
		if (focusListener) {
			process.stdin.off("data", focusListener);
			focusListener = undefined;
		}
		if (focusEnabled) {
			try {
				process.stdout.write(FOCUS_DISABLE);
			} catch {}
			focusEnabled = false;
		}
		isBlurred = false;
		awayRecapPending = false;
	};

	pi.on("turn_end", (_event, ctx) => {
		if (isDisabled() || !ctx.hasUI) return;

		// Debounce mid-loop turn_end → turn_start pairs.
		if (isBlurred) {
			clearPostTurnTimer();
			postTurnTimer = setTimeout(() => {
				postTurnTimer = undefined;
				tryAwayRecap(ctx);
			}, POST_TURN_DEBOUNCE_MS);
		}

		if (!focusEventsSeen) {
			clearIdleTimer();
			idleTimer = setTimeout(() => {
				idleTimer = undefined;
				if (!focusEventsSeen) void generateAndShow(ctx, "idle");
			}, flagMilliseconds("recap-idle-seconds", DEFAULT_IDLE_SECONDS));
		}
	});

	pi.on("turn_start", () => {
		clearIdleTimer();
		clearPostTurnTimer();
		cancelActive();
	});

	pi.on("input", (_event, ctx) => {
		clearIdleTimer();
		clearPostTurnTimer();
		clearAwayTimer();
		cancelActive();
		awayRecapPending = false;
		clearRecap(ctx);
	});

	pi.on("agent_start", (_event, ctx) => {
		agentActive = true;
		clearIdleTimer();
		clearPostTurnTimer();
		cancelActive();
		clearRecap(ctx);
	});

	pi.on("agent_end", (_event, ctx) => {
		agentActive = false;
		if (awayRecapPending) {
			awayRecapPending = false;
			tryAwayRecap(ctx);
		}
	});

	pi.on("session_shutdown", () => {
		agentActive = false;
		awayRecapPending = false;
		clearIdleTimer();
		clearAwayTimer();
		clearPostTurnTimer();
		cancelActive();
		detachFocusReporting();
	});

	pi.on("session_start", (event, ctx) => {
		attachFocusReporting(ctx);
		if (isDisabled() || !ctx.hasUI) return;
		if (event.reason === "resume" || event.reason === "fork") {
			setTimeout(() => {
				void generateAndShow(ctx, "resume");
			}, 300);
		}
	});

	pi.registerCommand("recap", {
		description: "Generate a recap of recent session activity",
		handler: (_args, ctx) => generateAndShow(ctx, "manual"),
	});
}
