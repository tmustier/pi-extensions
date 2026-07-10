import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { CmuxBrowserClient, type ExecCmux } from "./client.ts";

const execFileAsync = promisify(execFile);

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
	let surface: string | undefined;
	try {
		const opened = await client.open(baseUrl, undefined);
		surface = opened.surface;
		if (!surface) throw new Error(`open returned no surface: ${opened.stdout}`);
		await client.browser(surface, ["wait", "--load-state", "complete", "--timeout-ms", "15000"], undefined, 20_000);
		const snapshot = await client.browser(surface, ["snapshot", "--interactive"]);
		if (!/Name/.test(snapshot.stdout) || !/Upload/.test(snapshot.stdout)) throw new Error(`snapshot missing fixture controls: ${snapshot.stdout}`);
		await client.browser(surface, ["fill", "--selector", "#name", "--text", "Pi", "--snapshot-after"]);
		await client.browser(surface, ["click", "--selector", "#hello", "--snapshot-after"]);
		await client.browser(surface, ["wait", "--text", "Hello Pi", "--timeout-ms", "5000"]);
		await client.upload(surface, "#upload", `${fixtureDir}/upload.txt`, fixtureDir);
		await client.browser(surface, ["wait", "--text", "upload.txt", "--timeout-ms", "5000"]);
		const screenshotPath = `${fixtureDir}/browser.png`;
		await client.browser(surface, ["screenshot", "--out", screenshotPath], undefined, 30_000);
		if ((await stat(screenshotPath)).size === 0) throw new Error("screenshot is empty");
		await client.browser(surface, ["click", "--selector", "#download"]);
		const downloadPath = `${fixtureDir}/download.txt`;
		await client.browser(surface, ["download", "wait", "--path", downloadPath, "--timeout-ms", "10000"], undefined, 15_000);
		if ((await readFile(downloadPath, "utf8")).trim() !== "synthetic download") throw new Error("download content mismatch");
		await client.browser(surface, ["tab", "new", `${baseUrl}?tab=2`]);
		const tabs = await client.browser(surface, ["tab", "list"]);
		if (!tabs.stdout.includes("tab")) throw new Error(`tab list did not report tabs: ${tabs.stdout}`);
		await client.browser(surface, ["console", "list"]);
		await client.browser(surface, ["errors", "list"]);
		console.log(JSON.stringify({ ok: true, surface, screenshotPath, downloadPath }));
	} finally {
		if (surface) await client.closeSurface(surface).catch(() => undefined);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack ?? error.message : String(error));
	process.exitCode = 1;
});
