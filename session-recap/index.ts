/**
 * session-recap
 *
 * Claude-Code-style session recap for pi. Two complementary triggers:
 *
 *   1) True terminal focus reporting via DECSET ?1004. When the terminal
 *      loses focus we start drafting a recap in the background; when it
 *      regains focus we reveal it in a widget above the editor. Mirrors
 *      Claude Code's "refocus the tab" moment.
 *
 *   2) Idle-return fallback: if the terminal doesn't support focus events,
 *      or the user stays in the same window, we still generate a recap N
 *      seconds after the last `turn_end` so something is waiting above the
 *      editor when they look back at the session. `turn_end` (not
 *      `agent_end`) is used so the fallback fires even when a turn ends
 *      in an error or is aborted by the user.
 *
 * Also fires on `/resume` (session_start reason="resume") to recap where
 * the prior session left off.
 *
 * Model: defaults to the user's currently active model with
 * `reasoning: "minimal"` when the model advertises reasoning support. This
 * piggybacks on whatever auth the user already has configured (including
 * custom providers) so there are no login surprises. Override explicitly
 * with `--recap-model "<provider>/<id>"` if you want a specific model.
 *
 * Flags:
 *   --recap-idle-seconds <n>      Seconds after turn_end for idle recap (default 45)
 *   --recap-focus-min-seconds <n> Min focus-out duration to show a recap (default 3)
 *   --recap-disable-focus         Disable DECSET ?1004 focus reporting
 *   --recap-disable               Disable the automatic recap entirely
 *   --recap-model <p/id>          Override the default (active) model
 *
 * Command:
 *   /recap                        Force-generate a recap right now
 */

import { completeSimple, getModel } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type ContentBlock = {
	type?: string;
	text?: string;
	name?: string;
	arguments?: Record<string, unknown>;
};

type Entry = {
	id?: string;
	type: string;
	message?: {
		role?: string;
		content?: unknown;
		toolName?: string;
	};
};

type Model = Parameters<typeof completeSimple>[0];

const WIDGET_KEY = "session-recap";
const STATUS_KEY = "session-recap";

const DEFAULT_IDLE_SECONDS = 45;
const DEFAULT_FOCUS_MIN_SECONDS = 3;

// DECSET 1004 focus reporting — https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
const FOCUS_ENABLE = "\x1b[?1004h";
const FOCUS_DISABLE = "\x1b[?1004l";
const FOCUS_IN_SEQ = "\x1b[I";
const FOCUS_OUT_SEQ = "\x1b[O";

// --- helpers -----------------------------------------------------------------

function splitModel(spec: string): { provider: string; id: string } | undefined {
	const idx = spec.indexOf("/");
	if (idx <= 0) return undefined;
	return { provider: spec.slice(0, idx), id: spec.slice(idx + 1) };
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const b = part as ContentBlock;
		if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
	}
	return parts.join("\n");
}

function extractToolCalls(content: unknown): string[] {
	if (!Array.isArray(content)) return [];
	const out: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const b = part as ContentBlock;
		if (b.type !== "toolCall" || typeof b.name !== "string") continue;
		const args = b.arguments ?? {};
		const summary = JSON.stringify(args).slice(0, 280);
		out.push(`- ${b.name}(${summary})`);
	}
	return out;
}

/**
 * Compact transcript of the assistant's activity since the last user message.
 * For `resume`, we pass the whole branch instead so the summariser has context.
 */
function buildRecentTranscript(entries: Entry[], fromLastUser = true): string {
	let slice = entries;
	if (fromLastUser) {
		let lastUserIdx = -1;
		for (let i = entries.length - 1; i >= 0; i--) {
			const e = entries[i];
			if (e.type === "message" && e.message?.role === "user") {
				lastUserIdx = i;
				break;
			}
		}
		if (lastUserIdx >= 0) slice = entries.slice(lastUserIdx);
	}

	const lines: string[] = [];
	for (const e of slice) {
		if (e.type !== "message" || !e.message?.role) continue;
		const role = e.message.role;
		if (role === "user") {
			const t = extractText(e.message.content).trim();
			if (t) lines.push(`User: ${t.slice(0, 1200)}`);
		} else if (role === "assistant") {
			const t = extractText(e.message.content).trim();
			if (t) lines.push(`Assistant: ${t.slice(0, 1200)}`);
			const calls = extractToolCalls(e.message.content);
			if (calls.length) lines.push(...calls);
		} else if (role === "toolResult") {
			const t = extractText(e.message.content).trim();
			const name = e.message.toolName ?? "tool";
			if (t) lines.push(`Result(${name}): ${t.slice(0, 400)}`);
		}
	}
	return lines.join("\n");
}

/**
 * Only draft a recap if there has been real agent activity since the last user
 * message: at least one tool call, or ~30+ words of assistant text.
 */
function hasMeaningfulActivity(entries: Entry[]): boolean {
	let lastUserIdx = -1;
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (e.type === "message" && e.message?.role === "user") {
			lastUserIdx = i;
			break;
		}
	}
	const tail = lastUserIdx >= 0 ? entries.slice(lastUserIdx + 1) : entries;
	let assistantWords = 0;
	let toolCalls = 0;
	for (const e of tail) {
		if (e.type !== "message") continue;
		if (e.message?.role === "assistant") {
			const t = extractText(e.message.content);
			assistantWords += t.split(/\s+/).filter(Boolean).length;
			toolCalls += extractToolCalls(e.message.content).length;
		}
	}
	return toolCalls > 0 || assistantWords >= 30;
}

async function generateRecap(
	transcript: string,
	ctx: ExtensionContext,
	overrideSpec: string | undefined,
	signal: AbortSignal | undefined,
): Promise<string | undefined> {
	// Prefer explicit override flag; otherwise use the active model.
	let model: Model | undefined = ctx.model;
	if (overrideSpec) {
		const parsed = splitModel(overrideSpec);
		if (parsed) {
			const found = (getModel as (provider: string, id: string) => Model | undefined)(
				parsed.provider,
				parsed.id,
			);
			if (found) model = found;
		}
	}
	if (!model) return undefined;

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth?.ok || !auth.apiKey) return undefined;

	const prompt =
		"You produce a single-line recap of what the coding agent just did, " +
		"so the user can re-enter flow after switching focus back to this session.\n\n" +
		"Rules:\n" +
		"- Output ONE line, no preamble, no markdown.\n" +
		"- Format: `recap: <what happened, past tense, concrete>. Next: <one-line next step>.`\n" +
		"- If there is no meaningful next step, omit the `Next:` clause.\n" +
		"- If the transcript shows the turn was aborted or errored, say so explicitly " +
		'(e.g. "aborted during X", "errored at Y").\n' +
		"- Use file/function names where relevant. Be concrete, not vague.\n" +
		"- Max ~220 characters.\n\n" +
		"<transcript>\n" +
		transcript.slice(0, 12000) +
		"\n</transcript>";

	const response = await completeSimple(
		model,
		{
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: prompt }],
					timestamp: Date.now(),
				},
			],
		},
		{
			apiKey: auth.apiKey,
			headers: auth.headers,
			signal,
			// Only request reasoning on reasoning-capable models. Non-reasoning
			// models ignore unknown params but we keep this clean.
			...(model.reasoning ? { reasoning: "minimal" as const } : {}),
		},
	);

	const text = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n")
		.trim();

	return text ? text.split(/\r?\n/, 1)[0].trim() : undefined;
}

function showRecap(ctx: ExtensionContext, recap: string) {
	if (!ctx.hasUI) return;
	const theme = ctx.ui.theme;
	const header = theme.fg("accent", theme.bold("✦ recap"));
	ctx.ui.setWidget(WIDGET_KEY, [header, theme.fg("dim", recap)], { placement: "aboveEditor" });
}

function clearRecap(ctx: ExtensionContext) {
	if (!ctx.hasUI) return;
	ctx.ui.setWidget(WIDGET_KEY, undefined);
	ctx.ui.setStatus(STATUS_KEY, undefined);
}

// --- extension ---------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	pi.registerFlag("recap-idle-seconds", {
		description: "Seconds after turn_end before the session recap is generated",
		type: "string",
		default: String(DEFAULT_IDLE_SECONDS),
	});
	pi.registerFlag("recap-focus-min-seconds", {
		description: "Minimum focus-out duration (seconds) before showing a recap on refocus",
		type: "string",
		default: String(DEFAULT_FOCUS_MIN_SECONDS),
	});
	pi.registerFlag("recap-disable-focus", {
		description: "Disable DECSET ?1004 focus reporting (idle fallback still runs)",
		type: "boolean",
		default: false,
	});
	pi.registerFlag("recap-disable", {
		description: "Disable the automatic session recap",
		type: "boolean",
		default: false,
	});
	pi.registerFlag("recap-model", {
		description: "Override the default (active) model, e.g. anthropic/claude-sonnet-4-6",
		type: "string",
		default: "",
	});

	let idleTimer: NodeJS.Timeout | undefined;
	let inflight: AbortController | undefined;

	// Focus reporting state.
	let focusListener: ((chunk: Buffer) => void) | undefined;
	let focusEnabled = false;
	let focusedOutAt: number | undefined;
	let pendingRecap: string | undefined; // drafted while away, shown on refocus
	let draftingForFocus = false;

	// Leaf-id of the branch state we last drafted for. Lets us skip regen on
	// refocus churn when nothing has happened in the session.
	let lastDraftedLeafId: string | undefined;

	const idleMs = (): number => {
		const n = Number(pi.getFlag("--recap-idle-seconds") ?? DEFAULT_IDLE_SECONDS);
		return Math.max(5, Number.isFinite(n) ? n : DEFAULT_IDLE_SECONDS) * 1000;
	};
	const focusMinMs = (): number => {
		const n = Number(pi.getFlag("--recap-focus-min-seconds") ?? DEFAULT_FOCUS_MIN_SECONDS);
		return Math.max(0, Number.isFinite(n) ? n : DEFAULT_FOCUS_MIN_SECONDS) * 1000;
	};
	const isDisabled = (): boolean => Boolean(pi.getFlag("--recap-disable"));
	const isFocusDisabled = (): boolean => Boolean(pi.getFlag("--recap-disable-focus"));
	const modelOverride = (): string | undefined => {
		const v = String(pi.getFlag("--recap-model") ?? "").trim();
		return v.length > 0 ? v : undefined;
	};

	const clearTimer = () => {
		if (idleTimer) {
			clearTimeout(idleTimer);
			idleTimer = undefined;
		}
	};

	const cancelInflight = () => {
		if (inflight) {
			inflight.abort();
			inflight = undefined;
		}
	};

	const scheduleRecap = (ctx: ExtensionContext) => {
		clearTimer();
		if (isDisabled() || !ctx.hasUI) return;
		idleTimer = setTimeout(() => {
			idleTimer = undefined;
			void generateAndShow(ctx, { reason: "idle" });
		}, idleMs());
	};

	const getLeafId = (ctx: ExtensionContext): string | undefined => {
		try {
			return ctx.sessionManager.getLeafId();
		} catch {
			return undefined;
		}
	};

	const generateAndShow = async (
		ctx: ExtensionContext,
		opts: { reason: "idle" | "manual" | "resume" | "focus" },
	) => {
		try {
			const entries = ctx.sessionManager.getBranch() as Entry[];
			if (!hasMeaningfulActivity(entries) && opts.reason !== "manual") return;

			const transcript = buildRecentTranscript(entries, opts.reason !== "resume");
			if (!transcript.trim()) return;

			cancelInflight();
			inflight = new AbortController();
			const showStatus = opts.reason !== "resume" && opts.reason !== "focus";
			if (showStatus && ctx.hasUI)
				ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", "✦ drafting recap…"));

			const recap = await generateRecap(transcript, ctx, modelOverride(), inflight.signal);
			if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);

			if (!recap) return;

			// Stamp the draft with the leaf id so we can skip re-drafting until
			// something new happens in the session.
			lastDraftedLeafId = getLeafId(ctx);

			if (opts.reason === "focus") {
				if (focusedOutAt === undefined) showRecap(ctx, recap);
				else pendingRecap = recap;
			} else {
				showRecap(ctx, recap);
			}
		} catch (err) {
			if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
			console.error("[session-recap] failed:", err);
		} finally {
			inflight = undefined;
			draftingForFocus = false;
		}
	};

	// --- focus reporting wiring -------------------------------------------

	const handleFocusOut = (ctx: ExtensionContext) => {
		focusedOutAt = Date.now();
		if (isDisabled() || draftingForFocus || inflight) return;

		// Skip regen if we already have a fresh recap for the current session
		// state. pendingRecap is still valid; it'll be revealed on focus-in.
		const leaf = getLeafId(ctx);
		if (lastDraftedLeafId && leaf === lastDraftedLeafId && pendingRecap) return;

		const entries = ctx.sessionManager.getBranch() as Entry[];
		if (!hasMeaningfulActivity(entries)) return;
		draftingForFocus = true;
		void generateAndShow(ctx, { reason: "focus" });
	};

	const handleFocusIn = (ctx: ExtensionContext) => {
		const outAt = focusedOutAt;
		focusedOutAt = undefined;
		if (outAt === undefined) return; // spurious focus-in before we saw focus-out
		const duration = Date.now() - outAt;
		if (duration < focusMinMs()) {
			// Quick glance — don't bother.
			pendingRecap = undefined;
			return;
		}
		if (pendingRecap) {
			const recap = pendingRecap;
			pendingRecap = undefined;
			showRecap(ctx, recap);
		}
		// Still drafting? generateAndShow's finally-path will reveal it when done.
	};

	const attachFocusReporting = (ctx: ExtensionContext) => {
		if (focusEnabled || isFocusDisabled() || !ctx.hasUI) return;
		if (!process.stdout.isTTY || !process.stdin.isTTY) return;

		try {
			process.stdout.write(FOCUS_ENABLE);
		} catch {
			return;
		}

		// Scan stdin for ESC[I / ESC[O. Sequences can straddle chunks, so we
		// keep a short tail. Adding a 'data' listener is safe: Node dispatches
		// to all listeners and pi is already in flowing mode — we don't steal
		// bytes from the TUI's input layer.
		let tail = "";
		const listener = (chunk: Buffer) => {
			try {
				const s = tail + chunk.toString("binary");
				if (s.includes(FOCUS_IN_SEQ)) handleFocusIn(ctx);
				if (s.includes(FOCUS_OUT_SEQ)) handleFocusOut(ctx);
				tail = s.slice(-3);
			} catch {
				/* best-effort */
			}
		};
		process.stdin.on("data", listener);
		focusListener = listener;
		focusEnabled = true;
	};

	const detachFocusReporting = () => {
		if (focusListener) {
			try {
				process.stdin.off("data", focusListener);
			} catch {
				/* noop */
			}
			focusListener = undefined;
		}
		if (focusEnabled) {
			try {
				process.stdout.write(FOCUS_DISABLE);
			} catch {
				/* noop */
			}
			focusEnabled = false;
		}
		focusedOutAt = undefined;
		pendingRecap = undefined;
		draftingForFocus = false;
	};

	// Lifecycle: idle timer arms on turn_end (fires even on error/abort),
	// and is cleared on anything that indicates new activity or input.

	pi.on("turn_end", async (_event, ctx) => {
		// A new turn (successful or not) invalidates any prior draft.
		lastDraftedLeafId = undefined;
		scheduleRecap(ctx);
	});

	pi.on("turn_start", async () => {
		// Another turn is starting in the same agent loop — clear the idle timer
		// we armed on the previous turn_end; it'll re-arm on the next turn_end.
		clearTimer();
	});

	pi.on("input", async (_event, ctx) => {
		clearTimer();
		cancelInflight();
		pendingRecap = undefined;
		lastDraftedLeafId = undefined;
		clearRecap(ctx);
	});

	pi.on("agent_start", async (_event, ctx) => {
		clearTimer();
		cancelInflight();
		pendingRecap = undefined;
		lastDraftedLeafId = undefined;
		clearRecap(ctx);
	});

	pi.on("session_shutdown", async () => {
		clearTimer();
		cancelInflight();
		detachFocusReporting();
	});

	// Session start: wire up focus reporting; on resume, show a recap.
	pi.on("session_start", async (event, ctx) => {
		attachFocusReporting(ctx);
		if (event.reason === "resume" || event.reason === "fork") {
			setTimeout(() => {
				void generateAndShow(ctx, { reason: "resume" });
			}, 300);
		}
	});

	// Manual command.
	pi.registerCommand("recap", {
		description: "Generate a one-line recap of recent session activity",
		handler: async (_args, ctx) => {
			await generateAndShow(ctx, { reason: "manual" });
		},
	});
}
