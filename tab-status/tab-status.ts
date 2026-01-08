/**
 * Update the terminal tab title with Pi run status (:new/:running/:✅/:🚧/:🛑).
 */
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

type StatusState = "new" | "running" | "doneCommitted" | "doneNoCommit" | "timeout";

type StatusPayload = {
	version: number;
	pid: number;
	sessionFile?: string;
	sessionId?: string;
	cwd?: string;
	cwdBase: string;
	title: string;
	state: StatusState;
	running: boolean;
	sawCommit: boolean;
	lastActivity: number;
	lastUpdated: number;
	hasUI: boolean;
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
const STATUS_VERSION = 1;
const STATUS_DIR = join(homedir(), ".pi", "agent", "tab-status");

export default function (pi: ExtensionAPI) {
	let state: StatusState = "new";
	let sawCommit = false;
	let running = false;
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const nativeClearTimeout = globalThis.clearTimeout;
	let statusFilePath: string | undefined;
	let sessionFile: string | undefined;
	let sessionId: string | undefined;
	let lastActivity = Date.now();
	let lastUpdated = Date.now();

	const cwdBase = (ctx: ExtensionContext) => basename(ctx.cwd || "pi");

	const safeName = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_");

	const extractSessionId = (filePath: string | undefined) => {
		if (!filePath) return undefined;
		const name = basename(filePath).replace(/\.jsonl$/i, "");
		return name || undefined;
	};

	const initStatusFile = (ctx: ExtensionContext) => {
		sessionFile = ctx.sessionManager.getSessionFile();
		sessionId = extractSessionId(sessionFile);
		const fileKey = sessionId ? `session-${safeName(sessionId)}` : `pid-${process.pid}`;
		statusFilePath = join(STATUS_DIR, `${fileKey}.json`);
	};

	const buildTitle = (ctx: ExtensionContext, next: StatusState) => {
		return `pi - ${cwdBase(ctx)}${STATUS_TEXT[next]}`;
	};

	const persistStatus = async (ctx: ExtensionContext) => {
		try {
			if (!statusFilePath) {
				initStatusFile(ctx);
			}
			if (!statusFilePath) return;
			const now = Date.now();
			lastUpdated = now;
			const payload: StatusPayload = {
				version: STATUS_VERSION,
				pid: process.pid,
				sessionFile,
				sessionId,
				cwd: ctx.cwd,
				cwdBase: cwdBase(ctx),
				title: buildTitle(ctx, state),
				state,
				running,
				sawCommit,
				lastActivity,
				lastUpdated,
				hasUI: ctx.hasUI,
			};
			await fs.mkdir(STATUS_DIR, { recursive: true });
			await fs.writeFile(statusFilePath, `${JSON.stringify(payload)}\n`, "utf8");
		} catch {
			// Best-effort persistence for menu bar app.
		}
	};

	const removeStatusFile = async () => {
		try {
			if (!statusFilePath) return;
			await fs.unlink(statusFilePath);
		} catch {
			// Ignore cleanup failures.
		}
	};

	const setTitle = (ctx: ExtensionContext, next: StatusState) => {
		state = next;
		if (ctx.hasUI) {
			ctx.ui.setTitle(buildTitle(ctx, next));
		}
		void persistStatus(ctx);
	};

	const clearTabTimeout = () => {
		if (timeoutId === undefined) return;
		nativeClearTimeout(timeoutId);
		timeoutId = undefined;
	};

	const scheduleTimeout = (ctx: ExtensionContext) => {
		clearTabTimeout();
		timeoutId = setTimeout(() => {
			if (running && state === "running") {
				setTitle(ctx, "timeout");
			}
		}, INACTIVE_TIMEOUT_MS);
	};

	const markActivity = (ctx: ExtensionContext) => {
		if (!running) return;
		lastActivity = Date.now();
		if (state === "timeout") {
			setTitle(ctx, "running");
			scheduleTimeout(ctx);
			return;
		}
		scheduleTimeout(ctx);
		void persistStatus(ctx);
	};

	const reset = (ctx: ExtensionContext, next: StatusState) => {
		running = false;
		sawCommit = false;
		lastActivity = Date.now();
		clearTabTimeout();
		setTitle(ctx, next);
	};

	pi.on("session_start", async (_event, ctx) => {
		initStatusFile(ctx);
		reset(ctx, "new");
	});

	pi.on("session_switch", async (event, ctx) => {
		await removeStatusFile();
		initStatusFile(ctx);
		reset(ctx, event.reason === "new" ? "new" : "doneCommitted");
	});

	pi.on("agent_start", async (_event, ctx) => {
		running = true;
		sawCommit = false;
		lastActivity = Date.now();
		setTitle(ctx, "running");
		scheduleTimeout(ctx);
	});

	pi.on("turn_start", async (_event, ctx) => {
		markActivity(ctx);
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName === "bash") {
			const command = typeof event.input.command === "string" ? event.input.command : "";
			if (command && GIT_COMMIT_RE.test(command)) {
				sawCommit = true;
			}
		}
		markActivity(ctx);
	});

	pi.on("tool_result", async (_event, ctx) => {
		markActivity(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		running = false;
		clearTabTimeout();
		setTitle(ctx, sawCommit ? "doneCommitted" : "doneNoCommit");
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		clearTabTimeout();
		if (ctx.hasUI) {
			ctx.ui.setTitle(`pi - ${cwdBase(ctx)}`);
		}
		await removeStatusFile();
	});
}
