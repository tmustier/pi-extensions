import assert from "node:assert/strict";
import { access, writeFile } from "node:fs/promises";
import test from "node:test";
import cmuxBrowserExtension from "./index.ts";

const SURFACE = "123e4567-e89b-42d3-a456-426614174000";

type ExecOutput = { stdout?: string; stderr?: string; code?: number };

type RegisteredTool = {
	execute: (id: string, params: any, signal: AbortSignal | undefined, update: unknown, ctx: any) => Promise<any>;
};

function extensionHarness(outputs: ExecOutput[] = []) {
	const calls: string[][] = [];
	const tools = new Map<string, RegisteredTool>();
	const handlers = new Map<string, (...args: any[]) => unknown>();
	const pi = {
		exec: async (_command: string, args: string[]) => {
			calls.push(args);
			const next = outputs.shift() ?? {};
			return { stdout: next.stdout ?? JSON.stringify({ ok: true }), stderr: next.stderr ?? "", code: next.code ?? 0 };
		},
		on: (name: string, handler: (...args: any[]) => unknown) => handlers.set(name, handler),
		registerTool: (tool: RegisteredTool & { name: string }) => tools.set(tool.name, tool),
		registerCommand: () => undefined,
	};
	cmuxBrowserExtension(pi as any);
	return { calls, handlers, pi, tools };
}

function uiContext(confirm: (title: string, message: string) => Promise<boolean> = async () => true) {
	return {
		hasUI: true,
		mode: "tui",
		ui: {
			confirm,
			notify: () => undefined,
			setStatus: () => undefined,
			theme: { fg: (_name: string, value: string) => value },
		},
	};
}

async function openOwned(tool: RegisteredTool, ctx: any): Promise<void> {
	await tool.execute("open", { action: "open", url: "https://example.com/start" }, undefined, undefined, ctx);
}

test("registered tools deny shared-profile or origin access before invoking cmux", async () => {
	for (const decisions of [[false], [true, false]]) {
		let offset = 0;
		const ctx = uiContext(async () => decisions[offset++] ?? false);
		const { calls, tools } = extensionHarness();
		await assert.rejects(
			() => openOwned(tools.get("browser_navigate")!, ctx),
			/shared cmux profile access was not approved|browser origin access was not approved/i,
		);
		assert.equal(calls.length, 0);
	}
});

test("registered inspect emits exact documented get argv after revalidating origin", async () => {
	const origin = JSON.stringify({ url: "https://example.com/private?ordinary=hidden" });
	const { calls, tools } = extensionHarness([
		{ stdout: JSON.stringify({ surface_id: SURFACE }) },
		{ stdout: origin },
		{ stdout: origin },
		{ stdout: JSON.stringify({ snapshot: '- button "Submit" [ref=e4]' }) },
		{ stdout: origin },
		{ stdout: origin },
		{ stdout: JSON.stringify({ value: "button" }) },
	]);
	const ctx = uiContext();
	await openOwned(tools.get("browser_navigate")!, ctx);
	await tools.get("browser_inspect")!.execute(
		"snapshot",
		{ action: "snapshot", interactive: true },
		undefined,
		undefined,
		ctx,
	);
	await tools.get("browser_inspect")!.execute(
		"inspect",
		{ action: "get", property: "attr", target: "e4", attribute: "role" },
		undefined,
		undefined,
		ctx,
	);
	assert.deepEqual(calls[6]?.slice(3), [
		"browser", SURFACE, "get", "attr", "--selector", "e4", "--attr", "role",
	]);
});

test("registered consequential action refuses an origin change while approval is pending", async () => {
	const originA = JSON.stringify({ url: "https://example.com/one" });
	const originB = JSON.stringify({ url: "https://other.example/two" });
	const { calls, tools } = extensionHarness([
		{ stdout: JSON.stringify({ surface_id: SURFACE }) },
		{ stdout: originA },
		{ stdout: originA },
		{ stdout: originB },
	]);
	const ctx = uiContext();
	await openOwned(tools.get("browser_navigate")!, ctx);
	await assert.rejects(
		() => tools.get("browser_interact")!.execute(
			"click", { action: "click", target: "e1" }, undefined, undefined, ctx,
		),
		/origin changed while approval was pending/,
	);
	assert.equal(calls.some((args) => args.includes("click")), false);
});

test("registered screenshot returns bounded image content and removes its private path", async () => {
	const calls: string[][] = [];
	const tools = new Map<string, RegisteredTool>();
	let screenshotPath: string | undefined;
	const origin = JSON.stringify({ url: "https://example.com/private" });
	let originReads = 0;
	const pi = {
		exec: async (_command: string, args: string[]) => {
			calls.push(args);
			if (args.includes("open")) return { stdout: JSON.stringify({ surface_id: SURFACE }), stderr: "", code: 0 };
			if (args.includes("screenshot")) {
				screenshotPath = args.at(-1);
				await writeFile(screenshotPath!, "png-bytes", { mode: 0o666 });
				return { stdout: JSON.stringify({ path: screenshotPath }), stderr: "", code: 0 };
			}
			if (args.includes("url")) {
				originReads += 1;
				return { stdout: origin, stderr: "", code: 0 };
			}
			return { stdout: JSON.stringify({ ok: true }), stderr: "", code: 0 };
		},
		on: () => undefined,
		registerTool: (tool: RegisteredTool & { name: string }) => tools.set(tool.name, tool),
		registerCommand: () => undefined,
	};
	cmuxBrowserExtension(pi as any);
	const ctx = uiContext();
	await openOwned(tools.get("browser_navigate")!, ctx);
	const result = await tools.get("browser_inspect")!.execute(
		"screenshot", { action: "screenshot" }, undefined, undefined, ctx,
	);
	assert.equal(originReads, 3);
	assert.equal(result.content[1].type, "image");
	assert.equal(Buffer.from(result.content[1].data, "base64").toString("utf8"), "png-bytes");
	assert.ok(screenshotPath);
	await assert.rejects(() => access(screenshotPath!));
});

test("registered screenshot removes its private path and suppresses raw failure diagnostics", async () => {
	const tools = new Map<string, RegisteredTool>();
	let screenshotPath: string | undefined;
	const secret = "SCREENSHOT_FAILURE_SECRET_53";
	const origin = JSON.stringify({ url: "https://example.com/private" });
	const pi = {
		exec: async (_command: string, args: string[]) => {
			if (args.includes("open")) return { stdout: JSON.stringify({ surface_id: SURFACE }), stderr: "", code: 0 };
			if (args.includes("url")) return { stdout: origin, stderr: "", code: 0 };
			if (args.includes("screenshot")) {
				screenshotPath = args.at(-1);
				await writeFile(screenshotPath!, "partial-image", { mode: 0o600 });
				return { stdout: "", stderr: `${secret} at ${screenshotPath}`, code: 1 };
			}
			return { stdout: JSON.stringify({ ok: true }), stderr: "", code: 0 };
		},
		on: () => undefined,
		registerTool: (tool: RegisteredTool & { name: string }) => tools.set(tool.name, tool),
		registerCommand: () => undefined,
	};
	cmuxBrowserExtension(pi as any);
	const ctx = uiContext();
	await openOwned(tools.get("browser_navigate")!, ctx);
	await assert.rejects(
		() => tools.get("browser_inspect")!.execute(
			"screenshot", { action: "screenshot" }, undefined, undefined, ctx,
		),
		(error: Error) => !error.message.includes(secret) && !error.message.includes(screenshotPath!)
			&& /Raw diagnostics were suppressed/.test(error.message),
	);
	assert.ok(screenshotPath);
	await assert.rejects(() => access(screenshotPath!));
});
