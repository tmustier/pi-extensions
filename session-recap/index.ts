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

type RecapReason = "idle" | "manual" | "resume" | "focus";

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
			// Some providers (notably openai-codex-responses) require a non-empty
			// top-level instruction string even for simple one-shot completions.
			systemPrompt: "You write terse, concrete session recaps for a coding agent UI.",
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

	// Active recap request state. Only one request is ever in flight; starting
	// a new one aborts the previous. We track both the controller and the
	// reason so we can ask questions like "is there a focus draft running?"
	// without a separate boolean that can go out of sync on late completions.
	let activeController: AbortController | undefined;
	let activeReason: RecapReason | undefined;

	// Focus reporting state.
	let focusListener: ((chunk: Buffer) => void) | undefined;
	let focusEnabled = false;
	let focusedOutAt: number | undefined;
	let pendingRecap: string | undefined; // drafted while away, shown on refocus

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

	const cancelActive = () => {
		if (activeController) {
			activeController.abort();
			activeController = undefined;
			activeReason = undefined;
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

	const generateAndShow = async (ctx: ExtensionContext, opts: { reason: RecapReason }) => {
		const entries = ctx.sessionManager.getBranch() as Entry[];
		if (!hasMeaningfulActivity(entries) && opts.reason !== "manual") return;

		const transcript = buildRecentTranscript(entries, opts.reason !== "resume");
		if (!transcript.trim()) return;

		// Snapshot the leaf we're summarising BEFORE we await. If the branch
		// advances while the model call is in flight, the recap reflects stale
		// content — we must discard it rather than stamp the wrong leaf.
		const startLeaf = getLeafId(ctx);

		// Take ownership of the active-request slot. Any prior request is
		// cancelled; we'll only clear shared state in the finally if we're
		// still the current owner, so a late-completing aborted call can't
		// stomp on a newer in-flight request.
		cancelActive();
		const controller = new AbortController();
		activeController = controller;
		activeReason = opts.reason;

		const showStatus = opts.reason !== "resume" && opts.reason !== "focus";
		if (showStatus && ctx.hasUI)
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", "✦ drafting recap…"));

		try {
			const recap = await generateRecap(transcript, ctx, modelOverride(), controller.signal);
			if (!recap || controller.signal.aborted) return;
			// Discard the recap if the branch moved on while we were drafting.
			if (getLeafId(ctx) !== startLeaf) return;

			// Stamp with the leaf we actually summarised, not the live one.
			lastDraftedLeafId = startLeaf;
			// Another trigger has now produced a recap for this leaf — kill the
			// idle fallback so we don't issue a second call 45s later.
			clearTimer();

			if (opts.reason === "focus") {
				if (focusedOutAt === undefined) showRecap(ctx, recap);
				else pendingRecap = recap;
			} else {
				showRecap(ctx, recap);
			}
		} catch (err) {
			if (!controller.signal.aborted) console.error("[session-recap] failed:", err);
		} finally {
			if (activeController === controller) {
				activeController = undefined;
				activeReason = undefined;
				if (showStatus && ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
			}
		}
	};

	// --- focus reporting wiring -------------------------------------------

	const handleFocusOut = (ctx: ExtensionContext) => {
		focusedOutAt = Date.now();
		if (isDisabled() || activeController) return;

		// Skip regen if we already have a fresh recap for the current session
		// state — regardless of whether it's still parked in pendingRecap or
		// already shown in the widget. The stamp is invalidated on any new
		// turn_end / input / agent_start.
		const leaf = getLeafId(ctx);
		if (lastDraftedLeafId && leaf === lastDraftedLeafId) return;

		const entries = ctx.sessionManager.getBranch() as Entry[];
		if (!hasMeaningfulActivity(entries)) return;
		void generateAndShow(ctx, { reason: "focus" });
	};

	const handleFocusIn = (ctx: ExtensionContext) => {
		const outAt = focusedOutAt;
		focusedOutAt = undefined;
		if (outAt === undefined) return; // spurious focus-in before we saw focus-out
		const duration = Date.now() - outAt;
		if (duration < focusMinMs()) {
			// Quick glance — discard any parked recap AND cancel an in-flight
			// focus draft so a slow model response can't bypass min-seconds.
			// Also clear the leaf stamp, otherwise a later real absence at the
			// same leaf would skip regen and never surface a recap.
			pendingRecap = undefined;
			lastDraftedLeafId = undefined;
			if (activeReason === "focus") cancelActive();
			return;
		}
		if (pendingRecap) {
			const recap = pendingRecap;
			pendingRecap = undefined;
			showRecap(ctx, recap);
		}
		// Still drafting? generateAndShow's success-path will reveal it when done.
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
		// keep unconsumed trailing bytes in `buf` between calls. Consume each
		// match by advancing `i`, so a completed sequence never fires twice.
		// Adding a 'data' listener is safe: Node dispatches to all listeners
		// and pi is already in flowing mode — we don't steal bytes from the
		// TUI's input layer.
		const MAX_SEQ = Math.max(FOCUS_IN_SEQ.length, FOCUS_OUT_SEQ.length);
		let buf = "";
		const listener = (chunk: Buffer) => {
			try {
				buf += chunk.toString("binary");
				let i = 0;
				while (i + MAX_SEQ <= buf.length) {
					if (buf.startsWith(FOCUS_IN_SEQ, i)) {
						handleFocusIn(ctx);
						i += FOCUS_IN_SEQ.length;
					} else if (buf.startsWith(FOCUS_OUT_SEQ, i)) {
						handleFocusOut(ctx);
						i += FOCUS_OUT_SEQ.length;
					} else {
						i++;
					}
				}
				buf = buf.slice(i);
				// Safety net — never let buf grow unbounded if we're reading a
				// long non-escape stream on a terminal that streams ahead of us.
				if (buf.length > 64) buf = buf.slice(-(MAX_SEQ - 1));
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
		cancelActive();
		pendingRecap = undefined;
		lastDraftedLeafId = undefined;
		clearRecap(ctx);
	});

	pi.on("agent_start", async (_event, ctx) => {
		clearTimer();
		cancelActive();
		pendingRecap = undefined;
		lastDraftedLeafId = undefined;
		clearRecap(ctx);
	});

	pi.on("session_shutdown", async () => {
		clearTimer();
		cancelActive();
		detachFocusReporting();
	});

	// Session start: wire up focus reporting; on resume, show a recap.
	pi.on("session_start", async (event, ctx) => {
		attachFocusReporting(ctx);
		if (isDisabled()) return;
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
