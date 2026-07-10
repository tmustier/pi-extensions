import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateHead } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { CmuxBrowserClient, type BrowserCommandResult } from "./client.ts";

interface BrowserDetails {
	action: string;
	surface?: string;
	command: string[];
	json?: unknown;
	output?: string;
	path?: string;
}

function compactOutput(result: BrowserCommandResult): string {
	const raw = result.stdout.trim() || result.stderr.trim() || "ok";
	const truncated = truncateHead(raw, { maxBytes: 50 * 1024, maxLines: 2_000 });
	return truncated.truncated
		? `${truncated.content}\n\n[Output truncated: ${truncated.outputLines}/${truncated.totalLines} lines, ${truncated.outputBytes}/${truncated.totalBytes} bytes]`
		: truncated.content;
}

function toolResult(action: string, result: BrowserCommandResult, path?: string) {
	const output = compactOutput(result);
	const details: BrowserDetails = {
		action,
		surface: result.surface,
		command: result.args,
		json: result.json,
		output,
		path,
	};
	return { content: [{ type: "text" as const, text: output }], details };
}

function renderCall(name: string) {
	return (args: { action?: string; surface?: string }, theme: any) =>
		new Text(
			`${theme.fg("toolTitle", theme.bold(name))} ${theme.fg("accent", args.action ?? "")} ${theme.fg("dim", args.surface ?? "active surface")}`,
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
	if (details.path) text += ` ${theme.fg("dim", details.path)}`;
	if (options.expanded && details.output) text += `\n${theme.fg("toolOutput", details.output)}`;
	return new Text(text, 0, 0);
}

function recoverSurface(ctx: any): string | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry?.type !== "message" || entry.message?.role !== "toolResult") continue;
		if (!entry.message.toolName?.startsWith("browser_")) continue;
		const surface = entry.message.details?.surface;
		if (typeof surface === "string" && surface.trim()) return surface;
	}
	return undefined;
}

export default function cmuxBrowserExtension(pi: ExtensionAPI) {
	const client = new CmuxBrowserClient((args, options) => pi.exec("cmux", args, options));

	pi.on("session_start", (_event, ctx) => {
		client.setActiveSurface(recoverSurface(ctx));
		if (ctx.mode === "tui") {
			ctx.ui.setStatus(
				"cmux-browser",
				ctx.ui.theme.fg("dim", client.getActiveSurface() ? "browser ready" : "browser idle"),
			);
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.hasUI) ctx.ui.setStatus("cmux-browser", undefined);
	});

	pi.registerTool({
		name: "browser_navigate",
		label: "Browser Navigate",
		description:
			"Open and navigate the native cmux browser pane. New panes always open beside the calling Pi workspace with focus=false. Use open first; later calls reuse the active surface unless surface is provided.",
		promptSnippet: "Open or navigate the native cmux browser pane without stealing focus",
		promptGuidelines: [
			"Use browser_navigate action=open to create a native cmux browser surface; do not launch an external browser process.",
			"After browser_navigate changes the page, use browser_inspect action=snapshot to obtain fresh element refs.",
		],
		parameters: Type.Object({
			action: StringEnum(["open", "goto", "back", "forward", "reload", "url", "title", "status", "close"] as const),
			url: Type.Optional(Type.String({ description: "URL for open or goto" })),
			surface: Type.Optional(Type.String({ description: "cmux surface UUID/ref; defaults to the active surface" })),
			workspace: Type.Optional(Type.String({ description: "Optional cmux workspace UUID/ref for open" })),
		}),
		async execute(_id, params, signal) {
			let result: BrowserCommandResult;
			switch (params.action) {
				case "open":
					if (!params.url) throw new Error("url is required for open");
					result = await client.open(params.url, params.workspace, signal);
					break;
				case "goto":
					if (!params.url) throw new Error("url is required for goto");
					result = await client.browser(params.surface, ["goto", params.url, "--snapshot-after"], signal, 30_000);
					break;
				case "back":
				case "forward":
				case "reload":
					result = await client.browser(params.surface, [params.action, "--snapshot-after"], signal, 30_000);
					break;
				case "url":
				case "title":
					result = await client.browser(params.surface, ["get", params.action], signal);
					break;
				case "status":
					result = await client.run(["browser", "status"], signal);
					break;
				case "close":
					result = await client.closeSurface(params.surface, signal);
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
			"Inspect or debug the active native cmux browser: accessibility/DOM snapshot, text/html/value/attributes/count/box/styles, page JavaScript, screenshot, console, errors, or highlight. Outputs are capped at 50KB/2000 lines.",
		promptSnippet: "Snapshot, inspect, screenshot, or debug the native cmux browser",
		promptGuidelines: [
			"Use browser_inspect action=snapshot with interactive=true before browser_interact, and obtain fresh refs after DOM or navigation changes.",
			"Use browser_inspect action=screenshot when visual evidence matters; it returns the PNG to the model and saves it at path.",
		],
		parameters: Type.Object({
			action: StringEnum(["snapshot", "get", "eval", "screenshot", "console", "errors", "highlight"] as const),
			surface: Type.Optional(Type.String()),
			interactive: Type.Optional(Type.Boolean({ default: true })),
			compact: Type.Optional(Type.Boolean()),
			max_depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
			selector: Type.Optional(Type.String()),
			property: Type.Optional(StringEnum(["url", "title", "text", "html", "value", "attr", "count", "box", "styles"] as const)),
			attribute: Type.Optional(Type.String()),
			style_property: Type.Optional(Type.String()),
			script: Type.Optional(Type.String()),
			output_path: Type.Optional(Type.String({ description: "PNG path for screenshot; defaults to a temp file" })),
		}),
		async execute(_id, params, signal, _update, ctx) {
			let args: string[];
			let screenshotPath: string | undefined;
			switch (params.action) {
				case "snapshot":
					args = ["snapshot"];
					if (params.interactive !== false) args.push("--interactive");
					if (params.compact) args.push("--compact");
					if (params.max_depth) args.push("--max-depth", String(params.max_depth));
					if (params.selector) args.push("--selector", params.selector);
					break;
				case "get":
					if (!params.property) throw new Error("property is required for get");
					args = ["get", params.property];
					if (params.selector) args.push("--selector", params.selector);
					if (params.property === "attr") {
						if (!params.attribute) throw new Error("attribute is required for get attr");
						args.push("--attr", params.attribute);
					}
					if (params.property === "styles" && params.style_property) args.push("--property", params.style_property);
					break;
				case "eval":
					if (!params.script) throw new Error("script is required for eval");
					args = ["eval", "--script", params.script];
					break;
				case "screenshot":
					screenshotPath = resolve(ctx.cwd, params.output_path?.replace(/^@/, "") ?? `${tmpdir()}/pi-cmux-${randomUUID()}.png`);
					args = ["screenshot", "--out", screenshotPath];
					break;
				case "console":
				case "errors":
					args = [params.action, "list"];
					break;
				case "highlight":
					if (!params.selector) throw new Error("selector is required for highlight");
					args = ["highlight", "--selector", params.selector];
					break;
			}
			const result = await client.browser(params.surface, args, signal, params.action === "screenshot" ? 30_000 : 20_000);
			const response = toolResult(params.action, result, screenshotPath);
			if (screenshotPath) {
				const data = (await readFile(screenshotPath)).toString("base64");
				response.content.push({ type: "image" as const, data, mimeType: "image/png" } as any);
			}
			return response;
		},
		renderCall: renderCall("inspect"),
		renderResult,
	});

	pi.registerTool({
		name: "browser_interact",
		label: "Browser Interact",
		description:
			"Interact with the active native cmux browser using a fresh snapshot ref or CSS selector. Supports click, double click, hover, focus, fill, type, key events, select, checkbox, scrolling, waits, and scroll-into-view.",
		promptSnippet: "Interact with snapshot refs or selectors in the native cmux browser",
		promptGuidelines: [
			"Use browser_interact with fresh browser_inspect snapshot refs; re-snapshot after navigation, modal changes, or major DOM updates.",
			"Prefer browser_interact fill over type when replacing an input value, and use wait instead of polling snapshots.",
		],
		parameters: Type.Object({
			action: StringEnum(["click", "dblclick", "hover", "focus", "fill", "type", "press", "keydown", "keyup", "select", "check", "uncheck", "scroll", "scroll_into_view", "wait"] as const),
			surface: Type.Optional(Type.String()),
			target: Type.Optional(Type.String({ description: "Fresh element ref or CSS selector" })),
			text: Type.Optional(Type.String()),
			key: Type.Optional(Type.String()),
			value: Type.Optional(Type.String()),
			dx: Type.Optional(Type.Number()),
			dy: Type.Optional(Type.Number()),
			wait_text: Type.Optional(Type.String()),
			url: Type.Optional(Type.String()),
			url_contains: Type.Optional(Type.String()),
			load_state: Type.Optional(StringEnum(["interactive", "complete"] as const)),
			function_js: Type.Optional(Type.String()),
			timeout_ms: Type.Optional(Type.Integer({ minimum: 1, maximum: 120_000, default: 15_000 })),
		}),
		async execute(_id, params, signal) {
			let args: string[];
			const simpleTarget = ["click", "dblclick", "hover", "focus", "check", "uncheck", "scroll_into_view"].includes(params.action);
			if (simpleTarget) {
				if (!params.target) throw new Error(`target is required for ${params.action}`);
				args = [params.action === "scroll_into_view" ? "scroll-into-view" : params.action, params.target, "--snapshot-after"];
			} else if (params.action === "fill" || params.action === "type") {
				if (!params.target || params.text === undefined) throw new Error(`target and text are required for ${params.action}`);
				args = [params.action, params.target, params.text, "--snapshot-after"];
			} else if (["press", "keydown", "keyup"].includes(params.action)) {
				if (!params.key) throw new Error(`key is required for ${params.action}`);
				args = [params.action, "--key", params.key, "--snapshot-after"];
			} else if (params.action === "select") {
				if (!params.target || params.value === undefined) throw new Error("target and value are required for select");
				args = ["select", params.target, params.value, "--snapshot-after"];
			} else if (params.action === "scroll") {
				args = ["scroll"];
				if (params.target) args.push("--selector", params.target);
				if (params.dx !== undefined) args.push("--dx", String(params.dx));
				if (params.dy !== undefined) args.push("--dy", String(params.dy));
				args.push("--snapshot-after");
			} else {
				args = ["wait"];
				if (params.target) args.push("--selector", params.target);
				if (params.wait_text) args.push("--text", params.wait_text);
				if (params.url) args.push("--url", params.url);
				if (params.url_contains) args.push("--url-contains", params.url_contains);
				if (params.load_state) args.push("--load-state", params.load_state);
				if (params.function_js) args.push("--function", params.function_js);
				if (args.length === 1) throw new Error("wait requires target, wait_text, url, url_contains, load_state, or function_js");
				args.push("--timeout-ms", String(params.timeout_ms ?? 15_000));
			}
			const timeout = params.action === "wait" ? (params.timeout_ms ?? 15_000) + 5_000 : 30_000;
			return toolResult(params.action, await client.browser(params.surface, args, signal, timeout));
		},
		renderCall: renderCall("interact"),
		renderResult,
	});

	pi.registerTool({
		name: "browser_session",
		label: "Browser Session",
		description:
			"Manage native cmux browser tabs, profile/state lifecycle, downloads, and explicit local-file uploads. Auth stays in cmux's supported profile/data store; this tool does not read credential stores or print uploaded file contents.",
		promptSnippet: "Manage tabs, browser state/profiles, uploads, and downloads",
		promptGuidelines: [
			"Use browser_session state_save/state_load or cmux profiles for supported authenticated browser continuity; never scrape credential stores.",
			"Use browser_session upload only with an explicit local path and file-input selector; the operation sends that file to the currently loaded page without printing its contents.",
		],
		parameters: Type.Object({
			action: StringEnum(["tab_list", "tab_new", "tab_switch", "tab_close", "state_save", "state_load", "profile_list", "profile_add", "profile_rename", "profile_delete", "download_wait", "upload"] as const),
			surface: Type.Optional(Type.String()),
			url: Type.Optional(Type.String()),
			index: Type.Optional(Type.Integer({ minimum: 0 })),
			path: Type.Optional(Type.String()),
			selector: Type.Optional(Type.String()),
			name: Type.Optional(Type.String()),
			new_name: Type.Optional(Type.String()),
			timeout_ms: Type.Optional(Type.Integer({ minimum: 1, maximum: 120_000, default: 30_000 })),
		}),
		async execute(_id, params, signal, _update, ctx) {
			if (params.action === "upload") {
				if (!params.path || !params.selector) throw new Error("path and selector are required for upload");
				if (!ctx.hasUI) throw new Error("Browser uploads require interactive approval in Pi TUI/RPC mode.");
				const absolutePath = resolve(ctx.cwd, params.path.replace(/^@/, ""));
				const approved = await ctx.ui.confirm(
					"Upload local file to this page?",
					`${absolutePath}\n\nTarget: ${params.selector}`,
				);
				if (!approved) throw new Error("Browser upload cancelled by user.");
				return toolResult(params.action, await client.upload(params.surface, params.selector, params.path, ctx.cwd, signal));
			}
			if (params.action === "profile_delete") {
				if (!params.name) throw new Error("name is required for profile_delete");
				if (!ctx.hasUI || !(await ctx.ui.confirm("Delete cmux browser profile?", params.name))) {
					throw new Error("Browser profile deletion cancelled by user.");
				}
			}
			let args: string[];
			switch (params.action) {
				case "tab_list": args = ["tab", "list"]; break;
				case "tab_new": args = ["tab", "new", ...(params.url ? [params.url] : [])]; break;
				case "tab_switch":
				case "tab_close":
					if (params.index === undefined) throw new Error(`index is required for ${params.action}`);
					args = ["tab", params.action === "tab_switch" ? "switch" : "close", String(params.index)];
					break;
				case "state_save":
				case "state_load":
					if (!params.path) throw new Error(`path is required for ${params.action}`);
					args = ["state", params.action === "state_save" ? "save" : "load", resolve(ctx.cwd, params.path.replace(/^@/, ""))];
					break;
				case "profile_list": args = ["profiles", "list"]; break;
				case "profile_add":
					if (!params.name) throw new Error("name is required for profile_add");
					args = ["profiles", "add", params.name];
					break;
				case "profile_rename":
					if (!params.name || !params.new_name) throw new Error("name and new_name are required for profile_rename");
					args = ["profiles", "rename", params.name, params.new_name];
					break;
				case "profile_delete":
					if (!params.name) throw new Error("name is required for profile_delete");
					args = ["profiles", "delete", params.name];
					break;
				case "download_wait":
					args = ["download", "wait", "--timeout-ms", String(params.timeout_ms ?? 30_000)];
					if (params.path) args.push("--path", resolve(ctx.cwd, params.path.replace(/^@/, "")));
					break;
				default: throw new Error(`Unsupported session action: ${params.action}`);
			}
			const timeout = params.action === "download_wait" ? (params.timeout_ms ?? 30_000) + 5_000 : 30_000;
			const isProfileAction = params.action.startsWith("profile_");
			const result = isProfileAction
				? await client.run(["browser", ...args], signal, timeout)
				: await client.browser(params.surface, args, signal, timeout);
			return toolResult(params.action, result);
		},
		renderCall: renderCall("session"),
		renderResult,
	});

	pi.registerCommand("browser", {
		description: "Open a URL in a native cmux browser pane without moving focus",
		handler: async (args, ctx) => {
			const url = args.trim() || "about:blank";
			try {
				const result = await client.open(url, undefined);
				ctx.ui.setStatus("cmux-browser", ctx.ui.theme.fg("success", "browser ready"));
				ctx.ui.notify(`Opened native browser ${result.surface ?? "surface"} without changing focus`, "info");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
