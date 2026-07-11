import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { CmuxBrowserClient, type BrowserCommandResult, type BrowserLifecycleBlock, type ExecCmux } from "./client.ts";
import { navigationTarget, toolResult, type BrowserDetails, type NavigationTarget } from "./policy.ts";

const MAX_CMUX_OUTPUT_BYTES = 10 * 1024 * 1024;
const BOUNDED_CMUX_RUNNER = String.raw`
const { spawn } = require("node:child_process");
const child = spawn("cmux", process.argv.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
const limit = ${MAX_CMUX_OUTPUT_BYTES};
let written = 0;
let exceeded = false;
const forward = (source, target) => source.on("data", (chunk) => {
	if (exceeded) return;
	const remaining = limit - written;
	if (chunk.length > remaining) {
		if (remaining > 0) target.write(chunk.subarray(0, remaining));
		written = limit;
		exceeded = true;
		child.kill("SIGKILL");
		return;
	}
	written += chunk.length;
	target.write(chunk);
});
forward(child.stdout, process.stdout);
forward(child.stderr, process.stderr);
const stop = () => child.kill("SIGKILL");
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("error", () => process.exit(127));
child.on("close", (code, signal) => process.exit(exceeded ? 124 : signal ? 125 : (code ?? 1)));
`;
const PROCESS_LIFECYCLE_KEY = Symbol.for("pi-extensions.cmux-browser.lifecycle-block.v1");

function sharedLifecycleBlock(): BrowserLifecycleBlock {
	const registry = globalThis as unknown as Record<symbol, BrowserLifecycleBlock | undefined>;
	return registry[PROCESS_LIFECYCLE_KEY] ??= { blocked: false };
}

function renderCall(name: string) {
	return (args: { action?: string }, theme: any) =>
		new Text(
			`${theme.fg("toolTitle", theme.bold(name))} ${theme.fg("accent", args.action ?? "")}`,
			0,
			0,
		);
}

function renderResult(result: { details?: BrowserDetails }, options: { expanded: boolean; isPartial: boolean }, theme: any) {
	if (options.isPartial) return new Text(theme.fg("warning", "Working with native cmux browser…"), 0, 0);
	const details = result.details;
	if (!details) return new Text(theme.fg("success", "✓ browser operation complete"), 0, 0);
	let text = `${theme.fg("success", "✓")} ${details.action}`;
	if (details.surface) text += ` ${theme.fg("dim", details.surface)}`;
	if (options.expanded && details.output) text += `\n${theme.fg("toolOutput", details.output)}`;
	return new Text(text, 0, 0);
}

export default function cmuxBrowserExtension(pi: ExtensionAPI) {
	const execCmux: ExecCmux = (args, options) => pi.exec(
		process.execPath,
		["-e", BOUNDED_CMUX_RUNNER, "--", ...args],
		options,
	);
	const client = new CmuxBrowserClient(execCmux, sharedLifecycleBlock());
	const approvedOrigins = new Set<string>();
	let sharedProfileApproved = false;

	async function requireExactCmuxVersion(signal?: AbortSignal): Promise<void> {
		let result;
		try {
			result = await execCmux(["--version"], { signal, timeout: 5_000 });
		} catch {
			throw new Error("Could not verify the required cmux 0.64.13 runtime; operation refused.");
		}
		if (result.killed || result.code !== 0 || !/^cmux 0\.64\.13(?:\s|$)/.test(result.stdout.trim())) {
			throw new Error("This extension requires exactly cmux 0.64.13; operation refused before browser access.");
		}
	}

	async function approveSharedProfile(ctx: any): Promise<void> {
		if (sharedProfileApproved) return;
		if (!ctx.hasUI) throw new Error("cmux profile access requires approval in Pi TUI mode.");
		const approved = await ctx.ui.confirm(
			"Use cmux's currently selected browser profile?",
			"cmux 0.64.13 cannot select a profile when automation opens a browser surface. The new pane therefore uses cmux's current profile, which may be shared with other cmux panes. For stronger isolation, cancel, select a dedicated profile in cmux, then retry. The extension will not read, create, switch, clear, or delete profiles.",
		);
		if (!approved) throw new Error("Shared cmux profile access was not approved.");
		sharedProfileApproved = true;
	}

	async function approveOrigin(ctx: any, target: NavigationTarget, purpose: string): Promise<void> {
		if (approvedOrigins.has(target.origin)) return;
		if (!ctx.hasUI) throw new Error("New browser origins require approval in Pi TUI mode.");
		const approved = await ctx.ui.confirm(
			"Allow model browser access to this origin?",
			`${target.origin}\n\nPurpose: ${purpose}\n\nThis uses cmux's currently selected browser profile. Credentials and tokens must be entered manually in the native pane.`,
		);
		if (!approved) throw new Error("Browser origin access was not approved.");
		approvedOrigins.add(target.origin);
	}

	async function currentApprovedOrigin(ctx: any, signal: AbortSignal | undefined, purpose: string): Promise<string> {
		const origin = await client.currentOrigin(signal);
		await approveOrigin(ctx, { url: origin, origin }, purpose);
		const revalidatedOrigin = await client.currentOrigin(signal);
		if (revalidatedOrigin !== origin) {
			throw new Error("The browser origin changed while approval was pending; operation refused. Review the native pane and retry.");
		}
		return origin;
	}

	async function captureApprovedSnapshot(
		ctx: any,
		args: string[],
		signal: AbortSignal | undefined,
	): Promise<BrowserCommandResult> {
		let result = await client.browser(args, signal, 20_000, { captureSnapshot: true });
		if (result.exposure !== "captured" || !result.observedOrigin) {
			throw new Error("Could not bind the accessibility snapshot to a browser origin; operation refused.");
		}
		const observedOrigin = result.observedOrigin;
		const wasApproved = approvedOrigins.has(observedOrigin);
		await approveOrigin(ctx, { url: observedOrigin, origin: observedOrigin }, "inspect the accessibility snapshot");
		if (!wasApproved) {
			// The first snapshot remains private while approval is pending. Capture again so
			// the released text and its origin come from one cmux operation after approval.
			result = await client.browser(args, signal, 20_000, { captureSnapshot: true });
			if (result.exposure !== "captured" || result.observedOrigin !== observedOrigin) {
				throw new Error("The browser origin changed while approval was pending; snapshot refused.");
			}
		}
		return result;
	}

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode === "tui") ctx.ui.setStatus("cmux-browser", ctx.ui.theme.fg("dim", "browser idle"));
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		await client.closeAll();
		approvedOrigins.clear();
		sharedProfileApproved = false;
		if (ctx.hasUI) ctx.ui.setStatus("cmux-browser", undefined);
	});

	pi.registerTool({
		name: "browser_navigate",
		label: "Browser Navigate",
		description:
			"Open or navigate one extension-owned native cmux browser pane to an approved origin root. Paths, queries, fragments, local/custom schemes, and focus theft are refused.",
		promptSnippet: "Open or navigate the owned native cmux browser pane without stealing focus",
		promptGuidelines: [
			"Use action=open once; later calls reuse only this Pi session's owned surface.",
			"Never put credentials, tokens, signed secrets, or local-file URLs in navigation parameters; ask the user to enter them in the native pane.",
		],
		parameters: Type.Object({
			action: StringEnum(["open", "goto", "origin", "close"] as const),
			url: Type.Optional(Type.String({ description: "Absolute http(s) origin root (no path/query/fragment) or exactly about:blank" })),
		}),
		executionMode: "sequential",
		async execute(_id, params, signal, _update, ctx) {
			await requireExactCmuxVersion(signal);
			let result: BrowserCommandResult;
			switch (params.action) {
				case "open": {
					if (!params.url) throw new Error("url is required for open");
					const target = navigationTarget(params.url);
					await approveSharedProfile(ctx);
					await approveOrigin(ctx, target, "open a native browser surface");
					result = await client.open(target.url, signal);
					break;
				}
				case "goto": {
					if (!params.url) throw new Error("url is required for goto");
					const target = navigationTarget(params.url);
					await approveOrigin(ctx, target, "navigate the active surface");
					result = await client.browser(["goto", target.url], signal, 30_000, { success: "navigated" });
					break;
				}
				case "origin": {
					const origin = await currentApprovedOrigin(ctx, signal, "read the active page origin");
					result = {
						command: ["browser", "get"], stdout: origin, surface: client.getActiveSurface(), exposure: "captured",
					};
					break;
				}
				case "close":
					result = await client.closeActive(signal);
					approvedOrigins.clear();
					break;
			}
			return toolResult(params.action, result);
		},
		renderCall: renderCall("browser"),
		renderResult,
	});

	pi.registerTool({
		name: "browser_inspect",
		label: "Browser Inspect",
		description:
			"Read a bounded, element-name-redacted structural accessibility snapshot from one atomically reported and approved origin. Raw page text, HTML, URLs, screenshots, console output, and arbitrary page JavaScript are not exposed.",
		promptSnippet: "Read the approved native cmux page's accessibility snapshot",
		promptGuidelines: [
			"Snapshot is read-only. Perform interactions, credential entry, downloads, and screenshots manually in the visible native pane.",
		],
		parameters: Type.Object({
			action: StringEnum(["snapshot"] as const),
			interactive: Type.Optional(Type.Boolean({ default: true })),
			compact: Type.Optional(Type.Boolean()),
			max_depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
		}),
		executionMode: "sequential",
		async execute(_id, params, signal, _update, ctx) {
			await requireExactCmuxVersion(signal);
			const args = ["snapshot"];
			if (params.interactive !== false) args.push("--interactive");
			if (params.compact) args.push("--compact");
			if (params.max_depth) args.push("--max-depth", String(params.max_depth));
			return toolResult(params.action, await captureApprovedSnapshot(ctx, args, signal));
		},
		renderCall: renderCall("inspect"),
		renderResult,
	});

	pi.registerCommand("browser", {
		description: "Open or navigate the owned native cmux browser pane without moving focus",
		handler: async (args, ctx) => {
			try {
				await requireExactCmuxVersion();
				const target = navigationTarget(args.trim() || "about:blank");
				await approveSharedProfile(ctx);
				approvedOrigins.add(target.origin); // Direct slash-command input is explicit user authorization for this origin.
				if (client.getActiveSurface()) {
					await client.browser(["goto", target.url], undefined, 30_000, { success: "navigated" });
				} else {
					await client.open(target.url);
				}
				ctx.ui.setStatus("cmux-browser", ctx.ui.theme.fg("success", "browser ready"));
				ctx.ui.notify("Native browser ready on the owned surface", "info");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
