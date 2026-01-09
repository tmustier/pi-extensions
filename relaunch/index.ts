import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const SCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const SESSION_FLAGS = new Set(["--session", "--continue", "-c", "--resume", "-r", "--no-session"]);
const FORCE_EXIT_TIMEOUT_MS = 300;

type RelaunchCommand = {
	command: string;
	args: string[];
};

function looksLikeScriptPath(value: string): boolean {
	const ext = path.extname(value).toLowerCase();
	if (!SCRIPT_EXTENSIONS.has(ext)) return false;
	return fs.existsSync(value);
}

function stripSessionArgs(args: string[]): string[] {
	const cleaned: string[] = [];

	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (SESSION_FLAGS.has(arg)) {
			if (arg === "--session") {
				i += 1;
			}
			continue;
		}
		if (arg.startsWith("--session=")) {
			continue;
		}
		cleaned.push(arg);
	}

	return cleaned;
}

function buildRelaunchCommand(sessionFile: string): RelaunchCommand {
	const rawArgs = process.argv.slice(1);
	let scriptPath: string | null = null;
	let remainingArgs = rawArgs;

	if (rawArgs.length > 0 && looksLikeScriptPath(rawArgs[0])) {
		scriptPath = rawArgs[0];
		remainingArgs = rawArgs.slice(1);
	}

	const filteredArgs = stripSessionArgs(remainingArgs);
	const args = scriptPath ? [scriptPath, ...filteredArgs] : filteredArgs;
	args.push("--session", sessionFile);

	return { command: process.execPath, args };
}

function shellQuote(value: string): string {
	if (value.length === 0) return "''";
	return `'${value.replace(/'/g, "'\\''")}'`;
}

function psQuote(value: string): string {
	const escaped = value.replace(/`/g, "``").replace(/"/g, '""');
	return `"${escaped}"`;
}

function buildPosixWrapper(pid: number, command: string, args: string[]): RelaunchCommand {
	const full = [command, ...args].map(shellQuote).join(" ");
	const script = `while kill -0 ${pid} 2>/dev/null; do sleep 0.05; done; exec ${full}`;
	return { command: "sh", args: ["-c", script] };
}

function buildWindowsWrapper(pid: number, command: string, args: string[]): RelaunchCommand {
	const full = [command, ...args].map(psQuote).join(" ");
	const script = `Wait-Process -Id ${pid}; & ${full}`;
	return { command: "powershell", args: ["-NoProfile", "-Command", script] };
}

async function relaunch(ctx: ExtensionCommandContext): Promise<void> {
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile) {
		if (ctx.hasUI) {
			ctx.ui.notify("Cannot relaunch: current session is not saved.", "warning");
		}
		return;
	}

	const { command, args } = buildRelaunchCommand(sessionFile);
	const wrapper = process.platform === "win32"
		? buildWindowsWrapper(process.pid, command, args)
		: buildPosixWrapper(process.pid, command, args);

	const child = spawn(wrapper.command, wrapper.args, { stdio: "inherit", detached: true });
	child.once("spawn", () => {
		if (ctx.hasUI) {
			ctx.ui.notify("Relaunching pi...", "info");
		}

		if (!ctx.isIdle()) {
			ctx.abort();
		}

		ctx.shutdown();

		const timer = setTimeout(() => process.exit(0), FORCE_EXIT_TIMEOUT_MS);
		if (typeof timer.unref === "function") {
			timer.unref();
		}
	});
	child.once("error", (err) => {
		if (ctx.hasUI) {
			ctx.ui.notify(`Failed to relaunch: ${err.message}`, "error");
		}
	});
	child.unref();
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("relaunch-4", {
		description: "Exit pi and resume the current session (temp test name)",
		handler: async (_args, ctx) => {
			await relaunch(ctx);
		},
	});
}
