import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CmuxBrowserClient, type ExecCmux } from "./client.ts";

function recorder(outputs: Array<{ stdout?: string; stderr?: string; code?: number }> = []) {
	const calls: string[][] = [];
	const exec: ExecCmux = async (args) => {
		calls.push(args);
		const next = outputs.shift() ?? {};
		return { stdout: next.stdout ?? JSON.stringify({ ok: true }), stderr: next.stderr ?? "", code: next.code ?? 0 };
	};
	return { calls, exec };
}

test("open targets the caller workspace implicitly and never steals focus", async () => {
	const { calls, exec } = recorder([{ stdout: JSON.stringify({ surface: { surface_id: "A-SURFACE-UUID" } }) }]);
	const client = new CmuxBrowserClient(exec);
	const result = await client.open("https://example.com", undefined);
	assert.equal(result.surface, "A-SURFACE-UUID");
	assert.equal(client.getActiveSurface(), "A-SURFACE-UUID");
	assert.deepEqual(calls[0], [
		"--json", "--id-format", "uuids", "browser", "open", "https://example.com", "--focus", "false",
	]);
	assert.equal(calls[0]?.includes("--workspace"), false);
});

test("open recovers a UUID from cmux's nested surface payload", async () => {
	const { exec } = recorder([{ stdout: JSON.stringify({ surface: { id: "nested-surface-uuid" } }) }]);
	const client = new CmuxBrowserClient(exec);
	assert.equal((await client.open("about:blank", undefined)).surface, "nested-surface-uuid");
});

test("explicit workspace remains backgrounded", async () => {
	const { calls, exec } = recorder();
	const client = new CmuxBrowserClient(exec);
	await client.open("about:blank", "workspace:7");
	assert.deepEqual(calls[0]?.slice(-4), ["--focus", "false", "--workspace", "workspace:7"]);
});

test("later browser operations reuse the persisted surface without a shell", async () => {
	const { calls, exec } = recorder();
	const client = new CmuxBrowserClient(exec, "surface-uuid");
	await client.browser(undefined, ["snapshot", "--interactive"]);
	assert.deepEqual(calls[0], [
		"--json", "--id-format", "uuids", "browser", "surface-uuid", "snapshot", "--interactive",
	]);
});

test("a missing surface produces an actionable recovery error", async () => {
	const { exec } = recorder();
	const client = new CmuxBrowserClient(exec);
	await assert.rejects(() => client.browser(undefined, ["get", "url"]), /action=open first/);
});

test("cmux socket failures are translated into lifecycle recovery guidance", async () => {
	const { exec } = recorder([{ code: 1, stderr: "Error: Failed to write to socket (Broken pipe, errno 32)" }]);
	const client = new CmuxBrowserClient(exec);
	await assert.rejects(() => client.open("https://example.com", undefined), /cmux ping/);
});

test("upload sends bounded page-eval chunks, dispatches file events, and never emits file contents", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-cmux-browser-test-"));
	const path = join(directory, "hello.txt");
	const secretFixture = "synthetic-upload-fixture-not-private";
	await writeFile(path, secretFixture);
	const { calls, exec } = recorder();
	const client = new CmuxBrowserClient(exec, "surface-uuid");
	const result = await client.upload(undefined, "#upload", path, directory);
	assert.equal(result.surface, "surface-uuid");
	assert.ok(calls.length >= 3);
	assert.ok(calls.every((call) => call[0] === "--json" && call.includes("eval")));
	const scripts = calls.map((call) => call[call.indexOf("--script") + 1] ?? "");
	assert.ok(scripts.some((script) => script.includes("new DataTransfer")));
	assert.ok(scripts.some((script) => script.includes("dispatchEvent(new Event('change'")));
	assert.ok(scripts.some((script) => script.includes("delete globalThis.__piCmuxUploadBase64")));
	assert.equal(JSON.stringify(result).includes(secretFixture), false);
});

test("failed upload chunks never expose source content or base64 while preserving safe diagnostics", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-cmux-browser-test-"));
	const path = join(directory, "UPLOAD_SECRET_SENTINEL_53.txt");
	await writeFile(path, "UPLOAD_SECRET_SENTINEL_53");
	const { exec } = recorder([
		{},
		{ code: 23, stderr: "cmux eval rejected script globalThis.__piCmuxUploadBase64 += \\\"VVBMT0FEX1NFQ1JFVF9TRU5USU5FTF81Mw==\\\"" },
		{},
	]);
	const client = new CmuxBrowserClient(exec, "surface-uuid");
	await assert.rejects(
		() => client.upload(undefined, "#upload", path, directory),
		(error: Error) => {
			assert.match(error.message, /cmux browser <surface> eval failed \(exit 23\)/);
			assert.match(error.message, /cmux eval rejected script/);
			assert.equal(error.message.includes("UPLOAD_SECRET_SENTINEL_53"), false);
			assert.equal(error.message.includes("VVBMT0FEX1NFQ1JFVF9TRU5USU5FTF81Mw=="), false);
			return true;
		},
	);
});

test("sensitive argv is absent from failures and successful command metadata", async () => {
	const cases = [
		["eval", "--script", "EVAL_SECRET_53"],
		["addscript", "--script", "SCRIPT_SECRET_53"],
		["addinitscript", "--script", "INIT_SECRET_53"],
		["cookies", "set", "--name", "session", "--value", "COOKIE_SECRET_53"],
		["cookies", "set", "--name", "structural-value", "--value", "open"],
		["storage", "local", "set", "auth", "STORAGE_SECRET_53"],
		["state", "load", "/tmp/STATE_SECRET_53.json"],
	];
	for (const args of cases) {
		const secret = args.at(-1)!;
		const failed = recorder([{ code: 9, stderr: `safe diagnostic: rejected ${secret}` }]);
		const client = new CmuxBrowserClient(failed.exec, "surface-uuid");
		await assert.rejects(() => client.browser(undefined, args), (error: Error) => {
			assert.match(error.message, /safe diagnostic: rejected \[REDACTED\]/);
			assert.match(error.message, /exit 9/);
			assert.equal(error.message.includes(secret), false);
			return true;
		});

		const succeeded = recorder([{ stdout: JSON.stringify({ diagnostic: secret }) }]);
		const result = await new CmuxBrowserClient(succeeded.exec, "surface-uuid").browser(undefined, args);
		assert.equal(JSON.stringify(result).includes(secret), false);
		assert.equal(result.stdout.includes("[REDACTED]"), true);
	}
});

test("upload rejects directories and oversized files before browser execution", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-cmux-browser-test-"));
	const { calls, exec } = recorder();
	const client = new CmuxBrowserClient(exec, "surface-uuid");
	await assert.rejects(() => client.upload(undefined, "#upload", directory, directory), /not a regular file/);
	assert.equal(calls.length, 0);
});
