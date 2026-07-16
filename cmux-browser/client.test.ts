import assert from "node:assert/strict";
import { access, link, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CmuxBrowserClient, type ExecCmux } from "./client.ts";
import { inspectionArguments, navigationTarget, snapshotRef, toolResult } from "./policy.ts";
import { readPrivateImage } from "./private-image.ts";

const SURFACE_A = "123e4567-e89b-42d3-a456-426614174000";
const SURFACE_B = "123e4567-e89b-42d3-a456-426614174001";

function recorder(outputs: Array<{ stdout?: string; stderr?: string; code?: number; killed?: boolean }> = []) {
	const calls: string[][] = [];
	const exec: ExecCmux = async (args) => {
		calls.push(args);
		const next = outputs.shift() ?? {};
		return { stdout: next.stdout ?? JSON.stringify({ ok: true }), stderr: next.stderr ?? "", code: next.code ?? 0, killed: next.killed };
	};
	return { calls, exec };
}

test("open accepts only a documented top-level UUID, stays backgrounded, and retains no URL", async () => {
	const secretUrl = "https://example.com/";
	const { calls, exec } = recorder([{ stdout: JSON.stringify({ surface_id: SURFACE_A, url: secretUrl }) }]);
	const client = new CmuxBrowserClient(exec);
	const result = await client.open(secretUrl);
	assert.equal(result.surface, SURFACE_A);
	assert.equal(client.getActiveSurface(), SURFACE_A);
	assert.equal(client.getOwnedSurfaceCount(), 1);
	assert.deepEqual(calls[0], [
		"--json", "--id-format", "uuids", "browser", "open", secretUrl, "--focus", "false",
	]);
	assert.deepEqual(result.command, ["browser", "open"]);
	assert.equal(result.exposure, "synthetic");
	assert.deepEqual(result.output, { ok: true, opened: true });
	assert.equal("stdout" in result, false);
	assert.equal("json" in result, false);
	assert.equal(JSON.stringify(result).includes(secretUrl), false);
});

test("nested or invalid attacker-controlled surface fields cannot poison the active handle", async () => {
	for (const payload of [
		{ surface: { surface_id: SURFACE_A } },
		{ result: { surface_id: SURFACE_A } },
		{ surface_id: "surface:1" },
		{ surface_id: "not-a-uuid" },
	]) {
		const { calls, exec } = recorder([{ stdout: JSON.stringify(payload) }]);
		const client = new CmuxBrowserClient(exec);
		await assert.rejects(() => client.open("about:blank"), /no valid top-level surface_id UUID/);
		await assert.rejects(() => client.open("about:blank"), /open lifecycle is uncertain/);
		assert.equal(calls.length, 1);
		assert.equal(client.getActiveSurface(), undefined);
		assert.equal(client.getOwnedSurfaceCount(), 0);
	}
});

test("one session cannot target arbitrary surfaces or open a second inaccessible surface", async () => {
	const { calls, exec } = recorder([
		{ stdout: JSON.stringify({ surface_id: SURFACE_A }) },
		{ stdout: JSON.stringify({ snapshot: "- document page", refs: {}, url: "about:blank" }) },
	]);
	const client = new CmuxBrowserClient(exec);
	await assert.rejects(() => client.browser(["snapshot"]), /action=open first/);
	await client.open("about:blank");
	await assert.rejects(() => client.open("about:blank"), /already active/);
	await client.browser(["snapshot"], undefined, 20_000, { captureSnapshot: true });
	assert.equal(calls[1]?.includes(SURFACE_A), true);
	assert.equal(calls.flat().includes(SURFACE_B), false);
});

test("concurrent open calls serialize and cannot create an orphaned second surface", async () => {
	const calls: string[][] = [];
	let releaseFirst!: () => void;
	const firstCanFinish = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});
	const exec: ExecCmux = async (args) => {
		calls.push(args);
		await firstCanFinish;
		return { stdout: JSON.stringify({ surface_id: SURFACE_A }), stderr: "", code: 0 };
	};
	const client = new CmuxBrowserClient(exec);
	const first = client.open("about:blank");
	const second = client.open("about:blank");
	const secondRejected = assert.rejects(second, /already active/);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(calls.length, 1);
	releaseFirst();
	await Promise.all([first, secondRejected]);
	assert.equal(calls.length, 1);
	assert.equal(client.getOwnedSurfaceCount(), 1);
	assert.equal(client.getActiveSurface(), SURFACE_A);
});

test("failures expose fixed metadata only, including transformed diagnostics", async () => {
	const secret = "PASSWORD_%31%32%33%34%35%36";
	const { exec } = recorder([
		{ stdout: JSON.stringify({ surface_id: SURFACE_A }) },
		{ stdout: JSON.stringify({ snapshot: '- button "Continue" [ref=e1]', refs: { e1: { role: "button" } }, url: "about:blank" }) },
		{ code: 17, stderr: `P\\u0041SSWORD transformed ${secret}\n${"x".repeat(80_000)}` },
	]);
	const client = new CmuxBrowserClient(exec);
	await client.open("about:blank");
	await client.browser(["snapshot", "--interactive"], undefined, 20_000, { captureSnapshot: true });
	await assert.rejects(() => client.browser(["click", "e1"]), (error: Error) => {
		assert.equal(error.message, "cmux browser <owned-surface> click failed (exit 17). Raw diagnostics were suppressed. If cmux may be unavailable, confirm Pi is running inside a live cmux workspace and run `cmux ping`.");
		for (const fragment of [secret, "P\\u0041SSWORD", "transformed", "xxxxx"]) {
			assert.equal(error.message.includes(fragment), false);
		}
		return true;
	});
});

test("socket failures retain lifecycle guidance but no raw output", async () => {
	const { exec } = recorder([{ code: 1, stderr: "Error: Failed to write to socket (Broken pipe) SECRET" }]);
	const client = new CmuxBrowserClient(exec);
	await assert.rejects(() => client.open("https://example.com"), (error: Error) => {
		assert.match(error.message, /cmux ping/);
		assert.equal(error.message.includes("SECRET"), false);
		return true;
	});
});

test("subprocess rejections expose fixed metadata without argv or exception diagnostics", async () => {
	const secret = "REJECTED_EXEC_SECRET_53";
	const exec: ExecCmux = async () => {
		throw new Error(`spawn failed with argv https://example.com/${secret}`);
	};
	const client = new CmuxBrowserClient(exec);
	await assert.rejects(() => client.open("https://example.com/"), (error: Error) => {
		assert.match(error.message, /cmux browser open could not be invoked/);
		assert.equal(error.message.includes(secret), false);
		assert.equal(error.message.includes("https://"), false);
		return true;
	});
});

test("failed open invocation terminally blocks retries that could create a second pane", async () => {
	let calls = 0;
	const client = new CmuxBrowserClient(async () => {
		calls += 1;
		if (calls === 1) throw new Error("transport failed after an uncertain create");
		return { stdout: JSON.stringify({ surface_id: SURFACE_B }), stderr: "", code: 0 };
	});
	await assert.rejects(() => client.open("about:blank"), /could not be invoked/);
	await assert.rejects(() => client.open("about:blank"), /open lifecycle is uncertain/);
	assert.equal(calls, 1);
	assert.equal(client.getOwnedSurfaceCount(), 0);
});

test("value-bearing browser capabilities are rejected before subprocess invocation", async () => {
	const secrets = ["PASSWORD_123456", "STATE_SECRET_53", "TAB_SECRET_53", "UPLOAD_SECRET_SENTINEL_53"];
	const { calls, exec } = recorder([{ stdout: JSON.stringify({ surface_id: SURFACE_A }) }]);
	const client = new CmuxBrowserClient(exec);
	await client.open("about:blank");
	for (const args of [
		["fill", "e1", secrets[0]],
		["state", "load", secrets[1]],
		["tab", "new", `https://example.com/${secrets[2]}`],
		["eval", secrets[3]],
	]) {
		await assert.rejects(() => client.browser(args), /Unsupported browser operation/);
	}
	assert.equal(calls.length, 1);
	assert.equal(secrets.some((secret) => JSON.stringify(calls).includes(secret)), false);
});

test("allowed operations reject undocumented argument shapes before subprocess invocation", async () => {
	const secret = "ARGUMENT_SHAPE_SECRET_53";
	const { calls, exec } = recorder([{ stdout: JSON.stringify({ surface_id: SURFACE_A }) }]);
	const client = new CmuxBrowserClient(exec);
	await client.open("about:blank");
	for (const args of [
		["goto", `https://example.com/?token=${secret}`],
		["goto", `https://example.com/#accessToken=${secret}`],
		["reload", secret],
		["snapshot", "--selector", secret],
		["snapshot", "--compact", "--compact"],
		["snapshot", "--max-depth", "0"],
		["snapshot", "--max-depth", "21"],
		["get", "attr", "--selector", "e1", "--attr", "value"],
		["get", "text", "--selector", "e0"],
		["console", "list", secret],
		["errors", "list", "extra"],
		["press", "--key", secret],
		["scroll", "--dx", "10001"],
		["scroll", "--dy", "NaN"],
		["wait", "--load-state", "networkidle", "--timeout-ms", "1"],
		["wait", "--load-state", "complete", "--timeout-ms", "0"],
		["download", "wait", "--timeout-ms", "120001"],
		["download", "wait", "--timeout-ms", "1", "--out", secret],
		["screenshot", "--out", "/private/path.png", secret],
	]) {
		await assert.rejects(
			() => client.browser(args),
			(error: Error) => /fixed documented command shapes/.test(error.message) && !error.message.includes(secret),
		);
	}
	assert.equal(calls.length, 1);
	assert.equal(JSON.stringify(calls).includes(secret), false);
});

test("open rejects unsafe navigation before subprocess invocation", async () => {
	const secret = "NAVIGATION_SECRET_53";
	for (const url of [
		`https://user:${secret}@example.com/`,
		`https://example.com/?apiKey=${secret}`,
		`https://example.com/?SAMLResponse=${secret}`,
		`https://example.com/?SAMLRequest=${secret}`,
		`https://example.com/?RelayState=${secret}`,
		`https://example.com/?clientState=${secret}`,
		`https://example.com/?assertion=${secret}`,
		`https://example.com/?jwt=${secret}`,
		`https://example.com/?oauth=${secret}`,
		`https://example.com/?oidc=${secret}`,
		`https://example.com/?ticket=${secret}`,
		`https://example.com/#/callback?refreshToken=${secret}`,
		"https://example.com/#bad%ZZ",
		"file:///private/secret",
	]) {
		const { calls, exec } = recorder();
		const client = new CmuxBrowserClient(exec);
		await assert.rejects(
			() => client.open(url),
			(error: Error) => /fixed documented command shapes/.test(error.message) && !error.message.includes(secret),
		);
		assert.equal(calls.length, 0);
	}
});

test("explicit read capture bounds stdout, suppresses successful stderr, and does not parse truncated JSON", async () => {
	const hugeSecret = `start-${"x".repeat(80_000)}-END_SECRET`;
	const { exec } = recorder([
		{ stdout: JSON.stringify({ surface_id: SURFACE_A }) },
		{ stdout: hugeSecret, stderr: "e".repeat(80_000) },
	]);
	const client = new CmuxBrowserClient(exec);
	await client.open("about:blank");
	const result = await client.browser(["console", "list"], undefined, 20_000, { capture: true });
	assert.equal(result.exposure, "captured");
	if (result.exposure !== "captured") throw new Error("expected captured result");
	assert.ok(Buffer.byteLength(result.stdout) < 52 * 1024);
	assert.equal("stderr" in result, false);
	assert.equal(result.stdout.includes("END_SECRET"), false);
	assert.equal(result.json, undefined);
});

test("successful non-read operations discard raw subprocess output by construction", async () => {
	const secret = "SUCCESS_OUTPUT_SECRET_53";
	const { exec } = recorder([
		{ stdout: JSON.stringify({ surface_id: SURFACE_A, diagnostic: secret }), stderr: `open-${secret}` },
		{ stdout: JSON.stringify({ diagnostic: secret }), stderr: `reload-${secret}` },
	]);
	const client = new CmuxBrowserClient(exec);
	const opened = await client.open("about:blank");
	const reloaded = await client.browser(["reload"], undefined, 20_000, { success: "navigated" });
	for (const result of [opened, reloaded]) {
		assert.equal(result.exposure, "synthetic");
		assert.equal("stdout" in result, false);
		assert.equal("json" in result, false);
		assert.equal(JSON.stringify(result).includes(secret), false);
	}
});

test("close is terminal, cannot resurrect the old handle, and shutdown closes all owned surfaces", async () => {
	const { calls, exec } = recorder([
		{ stdout: JSON.stringify({ surface_id: SURFACE_A }) },
		{ stdout: JSON.stringify({ surface_id: SURFACE_A }) },
	]);
	const client = new CmuxBrowserClient(exec);
	await client.open("about:blank");
	const closed = await client.closeActive();
	assert.equal(closed.surface, undefined);
	assert.equal(client.getActiveSurface(), undefined);
	assert.equal(client.getOwnedSurfaceCount(), 0);
	await assert.rejects(() => client.browser(["snapshot"]), /action=open first/);
	assert.deepEqual(calls[1]?.slice(3), ["close-surface", "--surface", SURFACE_A]);

	const second = recorder([
		{ stdout: JSON.stringify({ surface_id: SURFACE_B }) },
		{ stdout: JSON.stringify({ surface_id: SURFACE_B }) },
	]);
	const shutdownClient = new CmuxBrowserClient(second.exec);
	await shutdownClient.open("about:blank");
	assert.equal(await shutdownClient.closeAll(), true);
	assert.equal(shutdownClient.getOwnedSurfaceCount(), 0);
	assert.deepEqual(second.calls[1]?.slice(3), ["close-surface", "--surface", SURFACE_B]);
});

test("interrupted or malformed closes preserve ownership until an exact acknowledgement", async () => {
	const { calls, exec } = recorder([
		{ stdout: JSON.stringify({ surface_id: SURFACE_A }) },
		{ stdout: JSON.stringify({ surface_id: SURFACE_A }), code: 0, killed: true },
		{ stdout: JSON.stringify({ ok: true }), code: 0 },
		{ stdout: JSON.stringify({ surface_id: SURFACE_A }), code: 0 },
	]);
	const client = new CmuxBrowserClient(exec);
	await client.open("about:blank");
	await assert.rejects(() => client.closeActive(), /interrupted before completion could be confirmed/);
	await assert.rejects(() => client.closeActive(), /without confirming the exact owned surface_id/);
	assert.equal(client.getActiveSurface(), SURFACE_A);
	assert.equal(client.getOwnedSurfaceCount(), 1);
	await assert.rejects(() => client.open("about:blank"), /already active/);
	assert.equal(calls.filter((args) => args.includes("open")).length, 1);
	await client.closeActive();
	assert.equal(client.getActiveSurface(), undefined);
	assert.equal(client.getOwnedSurfaceCount(), 0);
});

test("best-effort closeAll preserves ownership after failure for a later retry", async () => {
	const { exec } = recorder([
		{ stdout: JSON.stringify({ surface_id: SURFACE_A }) },
		{ code: 1, stderr: "first shutdown close failed" },
		{ stdout: JSON.stringify({ surface_id: SURFACE_A }) },
	]);
	const client = new CmuxBrowserClient(exec);
	await client.open("about:blank");
	assert.equal(await client.closeAll(), false);
	assert.equal(client.getActiveSurface(), SURFACE_A);
	assert.equal(client.getOwnedSurfaceCount(), 1);
	assert.equal(await client.closeAll(), true);
	assert.equal(client.getActiveSurface(), undefined);
	assert.equal(client.getOwnedSurfaceCount(), 0);
});

test("current origin keeps URL details internal and returns only the parsed origin", async () => {
	const full = "https://example.com/private/path?ordinary=VALUE_SECRET_53";
	const { exec } = recorder([
		{ stdout: JSON.stringify({ surface_id: SURFACE_A }) },
		{ stdout: JSON.stringify({ url: full }) },
	]);
	const client = new CmuxBrowserClient(exec);
	await client.open("about:blank");
	assert.equal(await client.currentOrigin(), "https://example.com");
});

test("current origin refuses non-contract output without reflecting it into diagnostics", async () => {
	const secret = "ORIGIN_OUTPUT_SECRET_53";
	for (const stdout of [JSON.stringify({ value: secret }), JSON.stringify({ result: secret }), JSON.stringify(secret), secret]) {
		const { exec } = recorder([
			{ stdout: JSON.stringify({ surface_id: SURFACE_A }) },
			{ stdout },
		]);
		const client = new CmuxBrowserClient(exec);
		await client.open("about:blank");
		await assert.rejects(
			() => client.currentOrigin(),
			(error: Error) => !error.message.includes(secret) && /operation refused/.test(error.message),
		);
	}
});

test("synthetic tool results persist only allowlisted metadata, never raw output or values", () => {
	const secret = "PASSWORD_123456";
	const hostileResult = {
		command: ["browser", "<owned-surface>", "click"],
		stdout: `raw-${secret}`,
		stderr: `stderr-${secret}`,
		json: { diagnostic: `transformed-${secret}` },
		output: { ok: true, interacted: true, diagnostic: `transformed-${secret}` },
		surface: SURFACE_A,
		exposure: "synthetic",
	} as unknown as Parameters<typeof toolResult>[1];
	const result = toolResult("click", hostileResult);
	assert.deepEqual(Object.keys(result.details).sort(), ["action", "command", "output", "surface"].sort());
	assert.deepEqual(result.details.command, ["browser", "<owned-surface>", "click"]);
	assert.deepEqual(result.content, [{ type: "text", text: JSON.stringify({ ok: true, interacted: true }) }]);
	assert.equal(JSON.stringify(result).includes(secret), false);
	assert.equal(JSON.stringify(result).includes("transformed"), false);
	assert.equal(JSON.stringify(result).includes(SURFACE_A), false);
	assert.equal(result.details.surface, "owned");
	assert.equal("json" in result.details, false);
});

test("snapshots expose only accessibility text and authorize refs from the top-level refs map", async () => {
	for (const value of [undefined, "", "e0", "E1", "e1,body", "#password", "[name=token]", "e2 --script SECRET"]) {
		assert.throws(() => snapshotRef(value, "click"), /fresh snapshot ref/);
	}
	assert.equal(snapshotRef("e3", "click"), "e3");
	assert.equal(snapshotRef("e999", "click"), "e999");

	const hiddenSecret = "HIDDEN_DOM_SECRET_53";
	const { calls, exec } = recorder([
		{ stdout: JSON.stringify({ surface_id: SURFACE_A }) },
		{ stdout: JSON.stringify({
			snapshot: `- button "${hiddenSecret}" [ref=e1]\n- button "Current" [ref=e2]\n- text "ref=e9 is untrusted page text"`,
			refs: { e1: { role: "button", name: hiddenSecret }, e2: { role: "button", name: "Current" } },
			page: { text: hiddenSecret, html: `<input value="${hiddenSecret}">` },
			title: hiddenSecret,
			url: `https://example.com/?token=${hiddenSecret}`,
		}) },
	]);
	const client = new CmuxBrowserClient(exec);
	await client.open("about:blank");
	await assert.rejects(() => client.browser(["click", "e2"]), /latest successful snapshot/);
	const snapshot = await client.browser(["snapshot", "--interactive"], undefined, 20_000, { captureSnapshot: true });
	assert.equal(snapshot.exposure, "captured");
	if (snapshot.exposure !== "captured") throw new Error("expected captured snapshot");
	assert.equal(snapshot.stdout.includes(hiddenSecret), false);
	assert.equal(JSON.stringify(snapshot.json).includes(hiddenSecret), false);
	assert.deepEqual(snapshot.json, {
		snapshot: '- button [ref=e1]\n- button [ref=e2]\n- text "ref=e9 is untrusted page text"',
		refs: ["e1", "e2"],
	});
	await assert.rejects(() => client.browser(["click", "e9"]), /latest successful snapshot/);
	assert.equal(calls.some((args) => args.includes("click")), false);
	await client.browser(["click", "e2"]);
	await assert.rejects(() => client.browser(["click", "e2"]), /latest successful snapshot/);
	assert.equal(calls.filter((args) => args.includes("click")).length, 1);
});

test("every navigation or interaction invalidator clears the latest snapshot refs", async () => {
	const invalidators = [
		["goto", "https://example.com/"],
		["reload"],
		["wait", "--load-state", "complete", "--timeout-ms", "1"],
		["click", "e2"],
		["dblclick", "e2"],
		["hover", "e2"],
		["focus", "e2"],
		["press", "--key", "Tab"],
		["check", "e2"],
		["uncheck", "e2"],
		["scroll", "--dy", "1"],
		["scroll-into-view", "e2"],
	];
	const outputs = [{ stdout: JSON.stringify({ surface_id: SURFACE_A }) }];
	for (let index = 0; index < invalidators.length; index += 1) {
		outputs.push({ stdout: JSON.stringify({ snapshot: '- button "Current" [ref=e2]', refs: { e2: { role: "button" } }, url: "https://example.com/" }) });
		outputs.push({ stdout: JSON.stringify({ ok: true }) });
	}
	const { calls, exec } = recorder(outputs);
	const client = new CmuxBrowserClient(exec);
	await client.open("about:blank");
	for (const args of invalidators) {
		await client.browser(["snapshot", "--interactive"], undefined, 20_000, { captureSnapshot: true });
		await client.browser(args);
		const callsBeforeStaleAttempt = calls.length;
		await assert.rejects(() => client.browser(["click", "e2"]), /latest successful snapshot/);
		assert.equal(calls.length, callsBeforeStaleAttempt);
	}
});

test("a failed replacement snapshot leaves no previously recorded refs usable", async () => {
	const { calls, exec } = recorder([
		{ stdout: JSON.stringify({ surface_id: SURFACE_A }) },
		{ stdout: JSON.stringify({ snapshot: '- button "Current" [ref=e2]', refs: { e2: { role: "button" } }, url: "about:blank" }) },
		{ code: 1, stderr: "snapshot backend secret" },
	]);
	const client = new CmuxBrowserClient(exec);
	await client.open("about:blank");
	await client.browser(["snapshot", "--interactive"], undefined, 20_000, { captureSnapshot: true });
	await assert.rejects(() => client.browser(["snapshot"], undefined, 20_000, { captureSnapshot: true }), /failed \(exit 1\)/);
	await assert.rejects(() => client.browser(["click", "e2"]), /latest successful snapshot/);
	assert.equal(calls.some((args) => args.includes("click")), false);
});

test("navigation policy allows only origin roots, excluding all path/query/fragment credential channels", () => {
	for (const url of [
		"https://example.com/private",
		"https://example.com/?q=ordinary",
		"https://example.com/#ordinary",
		"https://example.com/?token=SECRET",
		"https://example.com/?apiKey=SECRET",
		"https://example.com/?SAMLResponse=SECRET",
		"https://example.com/?SAMLRequest=SECRET",
		"https://example.com/?RelayState=SECRET",
		"https://example.com/?clientState=SECRET",
		"https://example.com/?assertion=SECRET",
		"https://example.com/?jwt=SECRET",
		"https://example.com/?oauth=SECRET",
		"https://example.com/?oidc=SECRET",
		"https://example.com/?ticket=SECRET",
		"https://example.com/#oauth=SECRET",
		"https://example.com/#oidc=SECRET",
		"https://example.com/#RelayState=SECRET",
		"https://example.com/#SAMLRequest=SECRET",
		"https://example.com/#clientState=SECRET",
		"https://example.com/#accessToken=SECRET",
		"https://example.com/#/callback?clientSecret=SECRET",
		"https://example.com/#bad%ZZ",
		"https://user:password@example.com/",
		"file:///etc/passwd",
		"javascript:alert(1)",
		"about:config",
	]) {
		assert.throws(() => navigationTarget(url));
	}
	assert.deepEqual(navigationTarget("https://example.com"), {
		url: "https://example.com/",
		origin: "https://example.com",
	});
	assert.deepEqual(navigationTarget("about:blank"), { url: "about:blank", origin: "about:blank" });
});

test("get actions use cmux 0.64.13's exact selector and attr argv", () => {
	assert.deepEqual(inspectionArguments("text", "e3"), ["get", "text", "--selector", "e3"]);
	assert.deepEqual(inspectionArguments("attr", "e4", "role"), ["get", "attr", "--selector", "e4", "--attr", "role"]);
	assert.deepEqual(inspectionArguments("count", "e5"), ["get", "count", "--selector", "e5"]);
	assert.deepEqual(inspectionArguments("box", "e6"), ["get", "box", "--selector", "e6"]);
	assert.throws(() => inspectionArguments("attr", "e4"), /attribute is required/);
	assert.throws(() => inspectionArguments("attr", "e4", "value"), /non-value metadata attributes/);
});

test("private screenshot reads normalize permissions and remove the file", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-cmux-browser-image-test-"));
	const path = join(root, "image.png");
	try {
		await writeFile(path, "image-bytes", { mode: 0o666 });
		const data = await readPrivateImage(path, 1024);
		assert.equal(Buffer.from(data, "base64").toString("utf8"), "image-bytes");
		await assert.rejects(() => access(path));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("private screenshot reads refuse symlink substitution without touching the target", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-cmux-browser-image-test-"));
	const external = join(root, "external.png");
	const link = join(root, "image.png");
	try {
		await writeFile(external, "outside-secret", { mode: 0o600 });
		await symlink(external, link);
		await assert.rejects(() => readPrivateImage(link, 1024));
		assert.equal(await readFile(external, "utf8"), "outside-secret");
		assert.equal((await stat(external)).isFile(), true);
		await assert.rejects(() => access(link));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("private screenshot reads refuse hard-linked files before changing the target", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-cmux-browser-image-test-"));
	const external = join(root, "external.png");
	const candidate = join(root, "image.png");
	try {
		await writeFile(external, "outside-secret", { mode: 0o644 });
		const originalMode = (await stat(external)).mode & 0o777;
		await link(external, candidate);
		await assert.rejects(() => readPrivateImage(candidate, 1024), /private standalone file/);
		assert.equal(await readFile(external, "utf8"), "outside-secret");
		assert.equal((await stat(external)).mode & 0o777, originalMode);
		await assert.rejects(() => access(candidate));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("private screenshot failures suppress host paths and enforce the read bound", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-cmux-browser-image-test-"));
	const missing = join(root, "sensitive-basename.png");
	const oversized = join(root, "oversized.png");
	try {
		await assert.rejects(
			() => readPrivateImage(missing, 8),
			(error: Error) => error.message === "cmux screenshot output could not be read securely."
				&& !error.message.includes(root)
				&& !error.message.includes("sensitive-basename"),
		);
		await writeFile(oversized, Buffer.alloc(9), { mode: 0o600 });
		await assert.rejects(() => readPrivateImage(oversized, 8), /exceeded the 8 byte safety limit/);
		await assert.rejects(() => access(oversized));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("extension source exposes only navigation and atomic accessibility snapshots", async () => {
	const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
	const imageSource = await readFile(new URL("./private-image.ts", import.meta.url), "utf8");
	for (const forbidden of [
		'"upload"', '"eval"', '"addscript"', '"addinitscript"', '"profile_add"', '"profile_delete"',
		'"fill"', '"select"', '"keydown"', '"keyup"', '"tab_list"', '"tab_new"', '"tab_switch"', '"tab_close"',
		'"state_save"', '"state_load"', '"browser_interact"', '"browser_download"', '"screenshot"', '"console"', '"errors"',
		'"highlight"', '"reload"', "output_path: Type", "allowed_root: Type", "workspace: Type", "surface: Type", "recoverSurface", "setActiveSurface",
	]) {
		assert.equal(source.includes(forbidden), false, `unexpected exposed capability: ${forbidden}`);
	}
	assert.doesNotMatch(source, /action:\s*StringEnum\(\[[^\]]*"type"/);
	assert.match(source, /session_shutdown[\s\S]{0,200}client\.closeAll\(\)/);
	assert.match(source, /pi\.exec\([\s\S]{0,100}process\.execPath/);
	assert.match(source, /spawn\(\"cmux\"/);
	assert.match(source, /MAX_CMUX_OUTPUT_BYTES = 10 \* 1024 \* 1024/);
	assert.match(source, /child\.kill\(\"SIGKILL\"\)/);
	assert.match(source, /captureApprovedSnapshot/);
	assert.match(imageSource, /O_NOFOLLOW/);
});
