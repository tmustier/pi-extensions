/**
 * session-recap
 *
 * "While you were away" recap for pi, modelled on Claude Code's away-summary
 * (services/awaySummary.ts + hooks/useAwaySummary.ts). A recap is only drafted
 * after a *genuine* absence, and is waiting above the editor when you return:
 *
 *   1) Away timer: terminal focus reporting via DECSET ?1004. After the
 *      terminal has been continuously blurred for `--recap-away-seconds`
 *      (default 90s), a recap is generated and shown so it's parked above
 *      the editor when you refocus.
 *
 *   2) Turn-end while away: if a turn finishes while the terminal is blurred
 *      (the prime multi-tab moment — the agent finished while you were in
 *      another tab), a recap is drafted after a short debounce.
 *
 *   3) Idle fallback: only when the terminal has not demonstrated focus
 *      reporting support (no ESC[I / ESC[O seen this session). N seconds
 *      after the last `turn_end` with no input, generate anyway. `turn_end`
 *      (not `agent_end`) is used so this fires even for errored/aborted turns.
 *
 * Also fires on `/resume` / `/fork` (session_start reason) to recap where the
 * prior session left off.
 *
 * Recap content follows Claude Code's prompt philosophy: state the high-level
 * task first (what the user is building/fixing), then the concrete next step.
 * Skip status reports — the last assistant message is already on screen; what
 * the user has lost is the task thread.
 *
 * Model: defaults to the user's currently active model with reasoning/thinking
 * disabled and cache writes disabled. This piggybacks on whatever auth the user
 * already has configured (including custom providers) so there are no login
 * surprises. Override explicitly with `--recap-model "<provider>/<id>"`.
 *
 * Flags:
 *   --recap-away-seconds <n>   Continuous blur before an away recap (default 90)
 *   --recap-idle-seconds <n>   Idle-fallback delay after turn_end (default 120)
 *   --recap-disable-focus      Disable DECSET ?1004 focus reporting
 *   --recap-during-active      Allow away recaps while an agent turn is running
 *   --recap-disable            Disable the automatic recap entirely
 *   --recap-model <p/id>       Override the default (active) model
 *
 * Command:
 *   /recap                     Force-generate a recap right now
 */

import { completeSimple, getModel } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type ContentBlock = {
	type?: string;
	text?: string;
	name?: string;
	arguments?: Record<string, unknown>;
};

type Entry = {
	id?: string;
	type: string;
	summary?: string; // compaction / branch_summary entries
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

const DEFAULT_AWAY_SECONDS = 90;
const DEFAULT_IDLE_SECONDS = 120;

// Debounce after a turn ends while blurred, so mid-loop turn_ends (which are
// immediately followed by the next turn_start) don't trigger drafts.
const POST_TURN_DEBOUNCE_MS = 3000;

// Task-framing context limits (tier 1 of the transcript).
const EARLIER_USER_PROMPTS = 4;
const EARLIER_PROMPT_CHARS = 300;
const COMPACTION_SUMMARY_CHARS = 600;

// Widget body wrapping.
const WRAP_WIDTH = 100;
const MAX_BODY_LINES = 4;

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
 * Two-tier transcript:
 *
 *   Tier 1 — task framing (cheap): the most recent compaction/branch summary
 *   if present, plus the last few *user* prompts before the latest one,
 *   trimmed hard. This is what lets the model state the high-level task
 *   instead of parroting the last tool call. (Claude Code feeds the last 30
 *   raw messages to Haiku for this; we're on the active model, so we keep the
 *   framing to user prompts only — old tool results add cost, not
 *   orientation.)
 *
 *   Tier 2 — recent detail: everything since the last user message, with the
 *   same per-item trimming as before (assistant text, tool calls, results).
 */
function buildTranscript(entries: Entry[]): string {
	const userIdxs: number[] = [];
	for (let i = 0; i < entries.length; i++) {
		const e = entries[i];
		if (e.type === "message" && e.message?.role === "user") userIdxs.push(i);
	}
	const lastUserIdx = userIdxs.length > 0 ? userIdxs[userIdxs.length - 1] : -1;

	const lines: string[] = [];

	// Tier 1a: most recent compaction / branch summary — already-distilled task context.
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (
			(e.type === "compaction" || e.type === "branch_summary") &&
			typeof e.summary === "string" &&
			e.summary.trim()
		) {
			lines.push(`Session summary so far: ${e.summary.trim().slice(0, COMPACTION_SUMMARY_CHARS)}`);
			break;
		}
	}

	// Tier 1b: earlier user prompts (task framing), oldest → newest.
	const earlier = userIdxs.slice(0, -1).slice(-EARLIER_USER_PROMPTS);
	const earlierLines: string[] = [];
	for (const i of earlier) {
		const t = extractText(entries[i].message?.content).trim();
		if (t) earlierLines.push(`- ${t.slice(0, EARLIER_PROMPT_CHARS)}`);
	}
	if (earlierLines.length > 0) {
		lines.push("Earlier user prompts (task framing):");
		lines.push(...earlierLines);
	}

	// Tier 2: full compact detail since the last user message (inclusive).
	const slice = lastUserIdx >= 0 ? entries.slice(lastUserIdx) : entries;
	const detail: string[] = [];
	for (const e of slice) {
		if (e.type !== "message" || !e.message?.role) continue;
		const role = e.message.role;
		if (role === "user") {
			const t = extractText(e.message.content).trim();
			if (t) detail.push(`User: ${t.slice(0, 1200)}`);
		} else if (role === "assistant") {
			const t = extractText(e.message.content).trim();
			if (t) detail.push(`Assistant: ${t.slice(0, 1200)}`);
			const calls = extractToolCalls(e.message.content);
			if (calls.length) detail.push(...calls);
		} else if (role === "toolResult") {
			const t = extractText(e.message.content).trim();
			const name = e.message.toolName ?? "tool";
			if (t) detail.push(`Result(${name}): ${t.slice(0, 400)}`);
		}
	}
	if (detail.length > 0) {
		lines.push("Recent activity (since the user's last message):");
		lines.push(...detail);
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

function wrapText(text: string, width: number, maxLines: number): string[] {
	const words = text.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let cur = "";
	for (const w of words) {
		if (cur && cur.length + 1 + w.length > width) {
			lines.push(cur);
			cur = w;
		} else {
			cur = cur ? `${cur} ${w}` : w;
		}
	}
	if (cur) lines.push(cur);
	if (lines.length > maxLines) {
		const kept = lines.slice(0, maxLines);
		kept[maxLines - 1] += " …";
		return kept;
	}
	return lines;
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

	// Note: apiKey may legitimately be absent for env/ambient-auth providers —
	// only bail when auth resolution itself failed.
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth?.ok) return undefined;

	// Prompt philosophy mirrors Claude Code's away-summary: orient the user in
	// the high-level task, don't produce a status report — the last assistant
	// message is already visible in scrollback.
	const prompt =
		"The user stepped away from this coding-agent session and is coming back. " +
		"Write a short recap so they can re-enter flow.\n\n" +
		"Rules:\n" +
		"- Write 1-3 short sentences of plain text. No preamble, no markdown, no bullets.\n" +
		"- Start by stating the high-level task — what the user is building, fixing, or " +
		"debugging — not implementation minutiae.\n" +
		"- End with the concrete next step, if there is one.\n" +
		"- Skip status reports and commit recaps; orient the reader instead.\n" +
		"- If the last turn was aborted or errored, say so explicitly " +
		'(e.g. "aborted during X", "errored at Y").\n' +
		"- Use file/function names where they matter. Max ~400 characters.\n\n" +
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
			env: auth.env,
			signal,
			// Recaps are tiny, throwaway UI hints. Do not pay to create/read prompt
			// cache entries, and do not spend reasoning tokens. Claude Code's away
			// summary path likewise disables thinking for this job.
			cacheRetention: "none",
			maxTokens: 256,
		},
	);

	const text = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();

	return text ? text.slice(0, 600) : undefined;
}

function showRecap(ctx: ExtensionContext, recap: string) {
	if (!ctx.hasUI) return;
	const theme = ctx.ui.theme;
	const header = theme.fg("accent", theme.bold("✦ recap"));
	const body = wrapText(recap, WRAP_WIDTH, MAX_BODY_LINES).map((l) => theme.fg("dim", l));
	ctx.ui.setWidget(WIDGET_KEY, [header, ...body], { placement: "aboveEditor" });
}

function clearRecap(ctx: ExtensionContext) {
	if (!ctx.hasUI) return;
	ctx.ui.setWidget(WIDGET_KEY, undefined);
	ctx.ui.setStatus(STATUS_KEY, undefined);
}

// --- extension ---------------------------------------------------------------

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
		description: "Override the default (active) model, e.g. anthropic/claude-sonnet-4-6",
		type: "string",
		default: "",
	});

	// Timers. Only one recap request is ever in flight; starting a new one
	// aborts the previous.
	let idleTimer: NodeJS.Timeout | undefined; // fallback for no-focus-support terminals
	let awayTimer: NodeJS.Timeout | undefined; // continuous-blur timer
	let postTurnTimer: NodeJS.Timeout | undefined; // turn ended while blurred
	let activeController: AbortController | undefined;

	// Agent activity state. Like Claude Code's away summary, we don't draft
	// while a turn is still loading: if the away/post-turn trigger fires
	// mid-turn, we set a pending bit and generate on agent_end (if still
	// blurred). This avoids summarising a half-written branch.
	let agentActive = false;
	let focusDraftAfterAgent = false;

	// Focus reporting state.
	let focusListener: ((chunk: Buffer) => void) | undefined;
	let focusEnabled = false;
	let focusedOutAt: number | undefined;
	// True once we've seen any ESC[I / ESC[O this session — i.e. the terminal
	// demonstrably supports focus reporting, so the idle fallback is redundant.
	let focusEventsSeen = false;

	// Leaf-id of the branch state we last drafted for. Lets us skip regen when
	// nothing has happened in the session since the last recap.
	let lastDraftedLeafId: string | undefined;

	const awayMs = (): number => {
		const n = Number(pi.getFlag("recap-away-seconds") ?? DEFAULT_AWAY_SECONDS);
		return Math.max(5, Number.isFinite(n) ? n : DEFAULT_AWAY_SECONDS) * 1000;
	};
	const idleMs = (): number => {
		const n = Number(pi.getFlag("recap-idle-seconds") ?? DEFAULT_IDLE_SECONDS);
		return Math.max(5, Number.isFinite(n) ? n : DEFAULT_IDLE_SECONDS) * 1000;
	};
	const isDisabled = (): boolean => Boolean(pi.getFlag("recap-disable"));
	const isFocusDisabled = (): boolean => Boolean(pi.getFlag("recap-disable-focus"));
	const allowDuringActive = (): boolean => Boolean(pi.getFlag("recap-during-active"));
	const modelOverride = (): string | undefined => {
		const v = String(pi.getFlag("recap-model") ?? "").trim();
		return v.length > 0 ? v : undefined;
	};

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
		if (activeController) {
			activeController.abort();
			activeController = undefined;
		}
	};

	// The idle fallback only exists for terminals that don't report focus.
	// Once we've seen a real focus event, the away/post-turn triggers own the
	// job and the idle path would just be noise while the user is watching.
	const idleFallbackEligible = (): boolean =>
		!focusEnabled || isFocusDisabled() || !focusEventsSeen;

	const getLeafId = (ctx: ExtensionContext): string | undefined => {
		try {
			return ctx.sessionManager.getLeafId() ?? undefined;
		} catch {
			return undefined;
		}
	};

	const generateAndShow = async (ctx: ExtensionContext, opts: { reason: RecapReason }) => {
		const entries = ctx.sessionManager.getBranch() as Entry[];
		if (!hasMeaningfulActivity(entries) && opts.reason !== "manual") return;

		const transcript = buildTranscript(entries);
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

		const showStatus = opts.reason === "manual" || opts.reason === "idle";
		if (showStatus && ctx.hasUI)
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", "✦ drafting recap…"));

		try {
			const recap = await generateRecap(transcript, ctx, modelOverride(), controller.signal);
			if (!recap || controller.signal.aborted) return;
			// Discard the recap if the branch moved on while we were drafting.
			if (getLeafId(ctx) !== startLeaf) return;

			// Stamp with the leaf we actually summarised, not the live one.
			lastDraftedLeafId = startLeaf;
			// Another trigger has produced a recap for this leaf — kill the
			// other timers so we don't issue a second call later.
			clearIdleTimer();
			clearPostTurnTimer();

			// Show immediately. Away/post-turn recaps are drafted while the user
			// is away, so the widget is parked above the editor when they return;
			// if they returned mid-draft, it's still the "just got back" moment.
			showRecap(ctx, recap);
		} catch (err) {
			if (!controller.signal.aborted) console.error("[session-recap] failed:", err);
		} finally {
			if (activeController === controller) {
				activeController = undefined;
				if (showStatus && ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
			}
		}
	};

	// Shared gate for the away-timer / post-turn / deferred-after-agent paths.
	// Requires the terminal to still be blurred.
	const tryAwayRecap = (ctx: ExtensionContext) => {
		if (isDisabled() || !ctx.hasUI) return;
		if (focusedOutAt === undefined) return; // user came back — drop it
		if (agentActive && !allowDuringActive()) {
			// Turn still loading: defer to agent_end (Claude Code's pending bit).
			focusDraftAfterAgent = true;
			return;
		}
		if (activeController) return; // one request at a time

		// Skip regen if we already drafted for exactly this session state.
		const leaf = getLeafId(ctx);
		if (lastDraftedLeafId && leaf === lastDraftedLeafId) return;

		void generateAndShow(ctx, { reason: "focus" });
	};

	const scheduleIdleRecap = (ctx: ExtensionContext) => {
		clearIdleTimer();
		if (isDisabled() || !ctx.hasUI) return;
		idleTimer = setTimeout(() => {
			idleTimer = undefined;
			// Re-check at fire time: a focus event may have arrived since arming.
			if (!idleFallbackEligible()) return;
			void generateAndShow(ctx, { reason: "idle" });
		}, idleMs());
	};

	// --- focus reporting wiring -------------------------------------------

	const handleFocusOut = (ctx: ExtensionContext) => {
		focusEventsSeen = true;
		focusedOutAt = Date.now();
		// Focus reporting works — the idle fallback is now redundant.
		clearIdleTimer();
		if (isDisabled()) return;
		clearAwayTimer();
		awayTimer = setTimeout(() => {
			awayTimer = undefined;
			tryAwayRecap(ctx);
		}, awayMs());
	};

	const handleFocusIn = (_ctx: ExtensionContext) => {
		focusEventsSeen = true;
		focusedOutAt = undefined;
		focusDraftAfterAgent = false;
		clearAwayTimer();
		// The user is back and looking at the output — a post-turn recap now
		// would just repeat what's on screen.
		clearPostTurnTimer();
		clearIdleTimer();
		// Note: an in-flight draft (triggered by a genuine absence) is left to
		// finish — it lands moments after return, which is exactly when it helps.
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
		focusDraftAfterAgent = false;
	};

	// Lifecycle: recap triggers arm on turn_end (fires even on error/abort)
	// and are cleared by anything that indicates new activity or input.

	pi.on("turn_end", async (_event, ctx) => {
		// A new turn (successful or not) invalidates any prior draft.
		lastDraftedLeafId = undefined;
		if (isDisabled() || !ctx.hasUI) return;

		// Prime multi-tab moment: the agent produced output while the user is
		// away. Debounced so mid-loop turn_ends (followed by the next
		// turn_start within moments) don't trigger drafts; tryAwayRecap also
		// defers if the agent loop is still active when the timer fires.
		if (focusedOutAt !== undefined) {
			clearPostTurnTimer();
			postTurnTimer = setTimeout(() => {
				postTurnTimer = undefined;
				tryAwayRecap(ctx);
			}, POST_TURN_DEBOUNCE_MS);
		}

		// Fallback for terminals without focus reporting.
		if (idleFallbackEligible()) scheduleIdleRecap(ctx);
	});

	pi.on("turn_start", async () => {
		// Another turn is starting in the same agent loop — any armed trigger
		// or in-flight draft is stale.
		clearIdleTimer();
		clearPostTurnTimer();
		cancelActive();
		lastDraftedLeafId = undefined;
	});

	pi.on("input", async (_event, ctx) => {
		clearIdleTimer();
		clearPostTurnTimer();
		clearAwayTimer();
		cancelActive();
		focusDraftAfterAgent = false;
		lastDraftedLeafId = undefined;
		clearRecap(ctx);
	});

	pi.on("agent_start", async (_event, ctx) => {
		agentActive = true;
		clearIdleTimer();
		clearPostTurnTimer();
		cancelActive();
		lastDraftedLeafId = undefined;
		clearRecap(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		agentActive = false;
		if (focusDraftAfterAgent) {
			focusDraftAfterAgent = false;
			tryAwayRecap(ctx);
		}
	});

	pi.on("session_shutdown", async () => {
		agentActive = false;
		focusDraftAfterAgent = false;
		clearIdleTimer();
		clearAwayTimer();
		clearPostTurnTimer();
		cancelActive();
		detachFocusReporting();
	});

	// Session start: wire up focus reporting; on resume/fork, show a recap.
	pi.on("session_start", async (event, ctx) => {
		attachFocusReporting(ctx);
		if (isDisabled() || !ctx.hasUI) return;
		if (event.reason === "resume" || event.reason === "fork") {
			setTimeout(() => {
				void generateAndShow(ctx, { reason: "resume" });
			}, 300);
		}
	});

	// Manual command.
	pi.registerCommand("recap", {
		description: "Generate a recap of recent session activity",
		handler: async (_args, ctx) => {
			await generateAndShow(ctx, { reason: "manual" });
		},
	});
}
