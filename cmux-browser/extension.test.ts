import assert from "node:assert/strict";
import test from "node:test";
import cmuxBrowserExtension from "./index.ts";

const SURFACE = "123e4567-e89b-42d3-a456-426614174000";

type ExecOutput = { stdout?: string; stderr?: string; code?: number; killed?: boolean };

type RegisteredTool = {
	executionMode?: "parallel" | "sequential";
	execute: (id: string, params: any, signal: AbortSignal | undefined, update: unknown, ctx: any) => Promise<any>;
};

function extensionHarness(outputs: ExecOutput[] = [], version = "cmux 0.64.13 (93) [reviewed]") {
	const calls: string[][] = [];
	const tools = new Map<string, RegisteredTool>();
	const handlers = new Map<string, (...args: any[]) => unknown>();
	const pi = {
		exec: async (_command: string, args: string[]) => {
			const separator = args.indexOf("--");
			const cmuxArgs = separator >= 0 ? args.slice(separator + 1) : args;
			if (cmuxArgs.length === 1 && cmuxArgs[0] === "--version") {
				return { stdout: version, stderr: "", code: 0, killed: false };
			}
			calls.push(cmuxArgs);
			const next = outputs.shift() ?? {};
			return {
				stdout: next.stdout ?? JSON.stringify({ ok: true }),
				stderr: next.stderr ?? "",
				code: next.code ?? 0,
				killed: next.killed,
			};
		},
		on: (name: string, handler: (...args: any[]) => unknown) => handlers.set(name, handler),
		registerTool: (tool: RegisteredTool & { name: string }) => tools.set(tool.name, tool),
		registerCommand: () => undefined,
	};
	cmuxBrowserExtension(pi as any);
	return { calls, handlers, tools };
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
	await tool.execute("open", { action: "open", url: "https://example.com/" }, undefined, undefined, ctx);
}

function snapshot(origin: string, text: string, refs: Record<string, unknown> = {}) {
	return {
		stdout: JSON.stringify({
			url: `${origin}/private?token=RAW_URL_SECRET`,
			snapshot: text,
			refs,
			page: { text: "RAW_PAGE_SECRET", html: "<input value=RAW_HTML_SECRET>" },
		}),
	};
}

test("only navigation and atomic read-only snapshot tools are registered sequentially", () => {
	const { tools } = extensionHarness();
	assert.deepEqual([...tools.keys()].sort(), ["browser_inspect", "browser_navigate"]);
	for (const tool of tools.values()) assert.equal(tool.executionMode, "sequential");
});

test("an unreviewed cmux version is refused before browser access", async () => {
	const { calls, tools } = extensionHarness([], "cmux 0.64.14 (94) [unreviewed]");
	await assert.rejects(
		() => openOwned(tools.get("browser_navigate")!, uiContext()),
		/requires exactly cmux 0\.64\.13/,
	);
	assert.equal(calls.length, 0);
});

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

test("snapshot strips all element names, including credential values behind misleading roles", async () => {
	const secret = "MANUALLY_ENTERED_PASSWORD_53";
	const { calls, tools } = extensionHarness([
		{ stdout: JSON.stringify({ surface_id: SURFACE }) },
		snapshot("https://example.com", `- button "${secret}" [ref=e4]\n- button "Submit" [ref=e5]`, {
			e4: { role: "button", name: secret },
			e5: { role: "button", name: "Submit" },
		}),
	]);
	const ctx = uiContext();
	await openOwned(tools.get("browser_navigate")!, ctx);
	const result = await tools.get("browser_inspect")!.execute(
		"snapshot",
		{ action: "snapshot", interactive: true },
		undefined,
		undefined,
		ctx,
	);
	assert.equal(result.content[0].text, "- button [ref=e4]\n- button [ref=e5]");
	assert.equal(JSON.stringify(result).includes(secret), false);
	assert.equal(JSON.stringify(result).includes("RAW_PAGE_SECRET"), false);
	assert.deepEqual(calls[1]?.slice(3), ["browser", SURFACE, "snapshot", "--interactive"]);
});

test("an unapproved snapshot origin is approved before a fresh same-origin snapshot is released", async () => {
	const prompts: string[] = [];
	const { tools } = extensionHarness([
		{ stdout: JSON.stringify({ surface_id: SURFACE }) },
		snapshot("https://redirected.example", '- document "private first capture"'),
		snapshot("https://redirected.example", '- document "fresh"\n- text "approved fresh capture"'),
	]);
	const ctx = uiContext(async (_title, message) => {
		prompts.push(message);
		return true;
	});
	await openOwned(tools.get("browser_navigate")!, ctx);
	const result = await tools.get("browser_inspect")!.execute(
		"snapshot", { action: "snapshot" }, undefined, undefined, ctx,
	);
	assert.equal(result.content[0].text, '- document\n- text "approved fresh capture"');
	assert.equal(result.content[0].text.includes("first capture"), false);
	assert.ok(prompts.some((message) => message.includes("https://redirected.example")));
});

test("snapshot refuses content when the atomically reported origin changes during approval", async () => {
	const { tools } = extensionHarness([
		{ stdout: JSON.stringify({ surface_id: SURFACE }) },
		snapshot("https://redirected.example", '- document "FIRST_SECRET"'),
		snapshot("https://other.example", '- document "SECOND_SECRET"'),
	]);
	const ctx = uiContext();
	await openOwned(tools.get("browser_navigate")!, ctx);
	await assert.rejects(
		() => tools.get("browser_inspect")!.execute(
			"snapshot", { action: "snapshot" }, undefined, undefined, ctx,
		),
		(error: Error) => /origin changed while approval was pending/.test(error.message)
			&& !error.message.includes("FIRST_SECRET") && !error.message.includes("SECOND_SECRET"),
	);
});

test("a failed shutdown close blocks opens after extension replacement", async () => {
	const first = extensionHarness([
		{ stdout: JSON.stringify({ surface_id: SURFACE }) },
		{ code: 1, stderr: "shutdown close failed" },
	]);
	const ctx = uiContext();
	await openOwned(first.tools.get("browser_navigate")!, ctx);
	await first.handlers.get("session_shutdown")!({ reason: "reload" }, ctx);

	const replacement = extensionHarness();
	await assert.rejects(
		() => openOwned(replacement.tools.get("browser_navigate")!, ctx),
		/open lifecycle is uncertain/,
	);
	assert.equal(replacement.calls.length, 0);
});
