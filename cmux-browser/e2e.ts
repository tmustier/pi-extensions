import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { open as openFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { promisify } from "node:util";
import { CmuxBrowserClient, type ExecCmux } from "./client.ts";
import { snapshotRef } from "./policy.ts";

const execFileAsync = promisify(execFile);

function refFor(payload: unknown, label: string): string {
	const snapshot = payload && typeof payload === "object" && !Array.isArray(payload)
		? (payload as Record<string, unknown>).snapshot
		: undefined;
	if (typeof snapshot !== "string") throw new Error("snapshot response did not contain documented snapshot text");
	const line = snapshot.split("\n").find((candidate) => candidate.includes(label));
	const ref = line?.match(/\bref=(e[1-9][0-9]*)\b/)?.[1];
	return snapshotRef(ref, `find ${label}`);
}

async function main() {
	const baseUrl = process.argv[2];
	const fixtureDir = process.argv[3];
	if (!baseUrl || !fixtureDir) throw new Error("usage: npx tsx e2e.ts <base-url> <fixture-dir>");

	const execCmux: ExecCmux = async (args, { signal, timeout }) => {
		try {
			const { stdout, stderr } = await execFileAsync("cmux", args, { signal, timeout, maxBuffer: 2 * 1024 * 1024 });
			return { stdout, stderr, code: 0 };
		} catch (error: any) {
			return {
				stdout: error?.stdout ?? "",
				stderr: error?.stderr ?? error?.message ?? String(error),
				code: typeof error?.code === "number" ? error.code : 1,
				killed: Boolean(error?.killed),
			};
		}
	};

	const client = new CmuxBrowserClient(execCmux);
	const screenshotPath = join(fixtureDir, `${randomUUID()}.png`);
	try {
		const opened = await client.open(baseUrl);
		if (!opened.surface || opened.exposure !== "synthetic") throw new Error("open returned no synthetic owned-surface result");
		await client.browser(["wait", "--load-state", "complete", "--timeout-ms", "15000"], undefined, 20_000);

		const before = await client.browser(["snapshot", "--interactive"], undefined, 20_000, { capture: true });
		if (before.exposure !== "captured") throw new Error("snapshot was not classified as captured output");
		const buttonRef = refFor(before.json, "Say hello");
		await client.browser(["click", buttonRef]);

		const after = await client.browser(["snapshot"], undefined, 20_000, { capture: true });
		if (!after.stdout.includes("Clicked")) throw new Error("ref click did not update the native page");

		await client.browser(["screenshot", "--out", screenshotPath], undefined, 30_000);
		let handle;
		try {
			handle = await openFile(screenshotPath, constants.O_RDONLY | constants.O_NOFOLLOW);
			const metadata = await handle.stat();
			if (!metadata.isFile() || metadata.size === 0) throw new Error("screenshot is empty or not a regular file");
		} finally {
			await handle?.close().catch(() => undefined);
		}

		await client.browser(["console", "list"], undefined, 20_000, { capture: true });
		await client.browser(["errors", "list"], undefined, 20_000, { capture: true });
		console.log(JSON.stringify({ ok: true, surface: "owned", native_ref_click: true, screenshot: true }));
	} finally {
		await client.closeAll();
		await rm(screenshotPath, { force: true }).catch(() => undefined);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
