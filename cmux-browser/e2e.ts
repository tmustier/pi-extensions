import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CmuxBrowserClient, type ExecCmux } from "./client.ts";

const execFileAsync = promisify(execFile);

async function main() {
	const baseUrl = process.argv[2];
	if (!baseUrl) throw new Error("usage: npx tsx e2e.ts <base-url>");

	const execCmux: ExecCmux = async (args, { signal, timeout }) => {
		try {
			const { stdout, stderr } = await execFileAsync("cmux", args, { signal, timeout, maxBuffer: 12 * 1024 * 1024 });
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

	const version = await execCmux(["--version"], { timeout: 5_000 });
	if (version.killed || version.code !== 0 || !/^cmux 0\.64\.13(?:\s|$)/.test(version.stdout.trim())) {
		throw new Error("E2E requires exactly cmux 0.64.13");
	}

	const client = new CmuxBrowserClient(execCmux);
	let verifiedSnapshot = false;
	try {
		const opened = await client.open(baseUrl);
		if (!opened.surface || opened.exposure !== "synthetic") {
			throw new Error("open returned no synthetic owned-surface result");
		}

		let snapshotText = "";
		let observedOrigin: string | undefined;
		for (let attempt = 0; attempt < 20; attempt += 1) {
			const snapshot = await client.browser(["snapshot", "--interactive"], undefined, 20_000, { captureSnapshot: true });
			if (snapshot.exposure !== "captured") throw new Error("snapshot was not classified as captured output");
			snapshotText = snapshot.stdout;
			observedOrigin = snapshot.observedOrigin;
			if (/\bbutton\b.*\[ref=e[1-9][0-9]*\]/.test(snapshotText)) break;
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		if (!/\bbutton\b.*\[ref=e[1-9][0-9]*\]/.test(snapshotText)) {
			throw new Error("native accessibility snapshot did not load the fixture structure");
		}
		if (observedOrigin !== new URL(baseUrl).origin) throw new Error("snapshot origin did not match the fixture origin");
		verifiedSnapshot = true;
	} finally {
		if (!await client.closeAll()) throw new Error("native surface cleanup was not exactly acknowledged");
	}
	if (!verifiedSnapshot) throw new Error("native snapshot verification did not complete");
	console.log(JSON.stringify({ ok: true, surface: "closed", native_accessibility_snapshot: true, cleanup_confirmed: true }));
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
