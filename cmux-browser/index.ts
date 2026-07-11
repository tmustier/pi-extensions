import { chmod, mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { CmuxBrowserClient, type BrowserCommandResult } from "./client.ts";
import { INSPECTION_ATTRIBUTES, inspectionArguments, navigationTarget, snapshotRef, toolResult, type BrowserDetails, type NavigationTarget } from "./policy.ts";
import { readPrivateImage } from "./private-image.ts";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

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
	const client = new CmuxBrowserClient((args, options) => pi.exec("cmux", args, options));
	const approvedOrigins = new Set<string>();
	let sharedProfileApproved = false;
	let privateRootPromise: Promise<string> | undefined;

	async function privateRoot(): Promise<string> {
		privateRootPromise ??= mkdtemp(join(tmpdir(), "pi-cmux-browser-")).then(async (path) => {
			await chmod(path, 0o700);
			return path;
		});
		return privateRootPromise;
	}

	async function cleanupPrivateRoot(): Promise<void> {
		if (!privateRootPromise) return;
		const root = await privateRootPromise.catch(() => undefined);
		if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined);
		privateRootPromise = undefined;
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
			throw new Error("The browser origin changed while approval was pending; action refused. Review the native pane and retry.");
		}
		return origin;
	}

	async function approveSensitiveAction(ctx: any, signal: AbortSignal | undefined, action: string): Promise<string> {
		const origin = await currentApprovedOrigin(ctx, signal, action);
		if (!ctx.hasUI) throw new Error("Consequential browser actions require approval in Pi TUI mode.");
		const approved = await ctx.ui.confirm(
			`Allow browser action: ${action}?`,
			`${origin}\n\nReview the native browser pane first. Do not approve credential entry, purchases, submissions, deletions, permission changes, or other external side effects unless you explicitly requested them.`,
		);
		if (!approved) throw new Error(`Browser action ${action} was not approved.`);
		const revalidatedOrigin = await client.currentOrigin(signal);
		if (revalidatedOrigin !== origin) {
			throw new Error("The browser origin changed while approval was pending; action refused. Review the native pane and retry.");
		}
		return origin;
	}

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode === "tui") ctx.ui.setStatus("cmux-browser", ctx.ui.theme.fg("dim", "browser idle"));
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		await client.closeAll();
		await cleanupPrivateRoot();
		approvedOrigins.clear();
		sharedProfileApproved = false;
		if (ctx.hasUI) ctx.ui.setStatus("cmux-browser", undefined);
	});

	pi.registerTool({
		name: "browser_navigate",
		label: "Browser Navigate",
		description:
			"Open and navigate one extension-owned native cmux browser pane. New origins require approval, new panes never steal focus, and local/custom URL schemes are refused.",
		promptSnippet: "Open or navigate the owned native cmux browser pane without stealing focus",
		promptGuidelines: [
			"Use action=open once; later calls reuse only this Pi session's owned surface.",
			"Never put credentials, tokens, signed secrets, or local-file URLs in navigation parameters; ask the user to enter them in the native pane.",
		],
		parameters: Type.Object({
			action: StringEnum(["open", "goto", "reload", "origin", "close"] as const),
			url: Type.Optional(Type.String({ description: "Absolute http(s) URL or exactly about:blank" })),
		}),
		async execute(_id, params, signal, _update, ctx) {
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
					result = await client.browser(["goto", target.url], signal, 30_000, { success: { ok: true, navigated: true } });
					break;
				}
				case "reload":
					await currentApprovedOrigin(ctx, signal, "reload the active page");
					result = await client.browser(["reload"], signal, 30_000, { success: { ok: true, navigated: true } });
					break;
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
			"Inspect the approved origin on the owned native cmux browser surface: accessibility/DOM snapshot, bounded property reads, screenshots, console, errors, or highlight. Arbitrary page JavaScript is intentionally not exposed.",
		promptSnippet: "Snapshot, inspect, screenshot, or debug the owned native cmux browser",
		promptGuidelines: [
			"Use snapshot with interactive=true before browser_interact; obtain fresh refs after DOM or navigation changes.",
			"Screenshots require explicit approval, are capped at 10 MiB, and are deleted from the private temp root immediately after reading.",
		],
		parameters: Type.Object({
			action: StringEnum(["snapshot", "get", "screenshot", "console", "errors", "highlight"] as const),
			interactive: Type.Optional(Type.Boolean({ default: true })),
			compact: Type.Optional(Type.Boolean()),
			max_depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
			target: Type.Optional(Type.String({ description: "Fresh snapshot ref such as e3" })),
			property: Type.Optional(StringEnum(["text", "attr", "count", "box"] as const)),
			attribute: Type.Optional(StringEnum(INSPECTION_ATTRIBUTES, { description: "Allowlisted non-value metadata attribute when property=attr." })),
		}),
		async execute(_id, params, signal, _update, ctx) {
			if (params.action === "screenshot") await approveSensitiveAction(ctx, signal, "share a screenshot with the model");
			else await currentApprovedOrigin(ctx, signal, `inspect page (${params.action})`);
			let args: string[];
			let capture = true;
			let screenshotPath: string | undefined;
			switch (params.action) {
				case "snapshot":
					args = ["snapshot"];
					if (params.interactive !== false) args.push("--interactive");
					if (params.compact) args.push("--compact");
					if (params.max_depth) args.push("--max-depth", String(params.max_depth));
					break;
				case "get":
					if (!params.property) throw new Error("property is required for get");
					args = inspectionArguments(params.property, params.target ?? "", params.attribute);
					break;
				case "screenshot":
					screenshotPath = join(await privateRoot(), `${randomUUID()}.png`);
					args = ["screenshot", "--out", screenshotPath];
					capture = false;
					break;
				case "console":
				case "errors":
					args = [params.action, "list"];
					break;
				case "highlight":
					args = ["highlight", "--selector", snapshotRef(params.target, "highlight")];
					capture = false;
					break;
			}
			try {
				const result = await client.browser(args, signal, params.action === "screenshot" ? 30_000 : 20_000, capture ? { capture: true } : undefined);
				const response = toolResult(params.action, result);
				if (screenshotPath) {
					const data = await readPrivateImage(screenshotPath, MAX_IMAGE_BYTES);
					response.content.push({ type: "image" as const, data, mimeType: "image/png" } as any);
				}
				return response;
			} finally {
				if (screenshotPath) await rm(screenshotPath, { force: true }).catch(() => undefined);
			}
		},
		renderCall: renderCall("inspect"),
		renderResult,
	});

	pi.registerTool({
		name: "browser_interact",
		label: "Browser Interact",
		description:
			"Interact with fresh snapshot refs on the approved origin. Text/value entry and arbitrary CSS selectors are intentionally absent so credentials and other values never enter process arguments; enter them manually in the native pane.",
		promptSnippet: "Interact with fresh snapshot refs on the owned native cmux browser",
		promptGuidelines: [
			"Use fresh snapshot refs and re-snapshot after navigation or major DOM changes.",
			"Ask the user to enter all text, selections, credentials, tokens, and one-time codes directly in the native pane.",
		],
		parameters: Type.Object({
			action: StringEnum(["click", "dblclick", "hover", "focus", "press", "check", "uncheck", "scroll", "scroll_into_view", "wait"] as const),
			target: Type.Optional(Type.String({ description: "Fresh snapshot ref such as e3" })),
			key: Type.Optional(StringEnum(["Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Space"] as const)),
			dx: Type.Optional(Type.Number({ minimum: -10000, maximum: 10000 })),
			dy: Type.Optional(Type.Number({ minimum: -10000, maximum: 10000 })),
			load_state: Type.Optional(StringEnum(["interactive", "complete"] as const)),
			timeout_ms: Type.Optional(Type.Integer({ minimum: 1, maximum: 120_000, default: 15_000 })),
		}),
		async execute(_id, params, signal, _update, ctx) {
			const consequential = ["click", "dblclick", "press", "check", "uncheck"].includes(params.action);
			if (consequential) await approveSensitiveAction(ctx, signal, params.action);
			else await currentApprovedOrigin(ctx, signal, params.action);
			let args: string[];
			const simpleTarget = ["click", "dblclick", "hover", "focus", "check", "uncheck", "scroll_into_view"].includes(params.action);
			if (simpleTarget) {
				const target = snapshotRef(params.target, params.action);
				args = [params.action === "scroll_into_view" ? "scroll-into-view" : params.action, target];
			} else if (params.action === "press") {
				if (!params.key) throw new Error("key is required for press");
				args = ["press", "--key", params.key];
			} else if (params.action === "scroll") {
				args = ["scroll"];
				if (params.target) args.push("--selector", snapshotRef(params.target, "scroll"));
				if (params.dx !== undefined) args.push("--dx", String(params.dx));
				if (params.dy !== undefined) args.push("--dy", String(params.dy));
			} else {
				args = ["wait"];
				if (params.target) args.push("--selector", snapshotRef(params.target, "wait"));
				if (params.load_state) args.push("--load-state", params.load_state);
				if (args.length === 1) throw new Error("wait requires target or load_state");
				args.push("--timeout-ms", String(params.timeout_ms ?? 15_000));
			}
			const timeout = params.action === "wait" ? (params.timeout_ms ?? 15_000) + 5_000 : 30_000;
			return toolResult(params.action, await client.browser(args, signal, timeout, { success: { ok: true, interacted: true } }));
		},
		renderCall: renderCall("interact"),
		renderResult,
	});

	pi.registerTool({
		name: "browser_download",
		label: "Browser Download",
		description:
			"Wait for a download managed by the owned native cmux browser. Download host paths and raw cmux output are intentionally not returned.",
		promptSnippet: "Wait for a user-approved download on the owned browser",
		promptGuidelines: [
			"Ask the user to handle uploads, credentials, and any downloaded-file opening directly in the native pane or filesystem.",
		],
		parameters: Type.Object({
			action: StringEnum(["wait"] as const),
			timeout_ms: Type.Optional(Type.Integer({ minimum: 1, maximum: 120_000, default: 30_000 })),
		}),
		async execute(_id, params, signal, _update, ctx) {
			await approveSensitiveAction(ctx, signal, "wait for a cmux-managed download");
			const timeout = (params.timeout_ms ?? 30_000) + 5_000;
			const result = await client.browser(
				["download", "wait", "--timeout-ms", String(params.timeout_ms ?? 30_000)],
				signal,
				timeout,
				{ success: { ok: true, download_ready: true } },
			);
			return toolResult(params.action, result);
		},
		renderCall: renderCall("download"),
		renderResult,
	});

	pi.registerCommand("browser", {
		description: "Open or navigate the owned native cmux browser pane without moving focus",
		handler: async (args, ctx) => {
			try {
				const target = navigationTarget(args.trim() || "about:blank");
				await approveSharedProfile(ctx);
				approvedOrigins.add(target.origin); // Direct slash-command input is explicit user authorization for this origin.
				if (client.getActiveSurface()) {
					await client.browser(["goto", target.url], undefined, 30_000, { success: { ok: true, navigated: true } });
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
