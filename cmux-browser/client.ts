import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

export interface ExecResult {
	stdout: string;
	stderr: string;
	code: number;
	killed?: boolean;
}

export type ExecCmux = (
	args: string[],
	options: { signal?: AbortSignal; timeout: number },
) => Promise<ExecResult>;

export interface BrowserCommandResult {
	args: string[];
	stdout: string;
	stderr: string;
	json?: unknown;
	surface?: string;
}

const SURFACE_KEYS = new Set(["surface", "surfaceId", "surface_id", "surfaceUUID", "surface_uuid"]);
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const UPLOAD_CHUNK_CHARS = 64 * 1024;

function findSurface(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findSurface(item);
			if (found) return found;
		}
		return undefined;
	}
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		if (SURFACE_KEYS.has(key) && typeof item === "string" && item.trim()) return item;
		if (key === "surface" && item && typeof item === "object") {
			const nested = item as Record<string, unknown>;
			const id = nested.id ?? nested.uuid ?? nested.surface_id ?? nested.surfaceId;
			if (typeof id === "string" && id.trim()) return id;
		}
		const found = findSurface(item);
		if (found) return found;
	}
	return undefined;
}

function parseJson(stdout: string): unknown | undefined {
	const text = stdout.trim();
	if (!text) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function formatFailure(args: string[], result: ExecResult): Error {
	const detail = (result.stderr || result.stdout || `exit ${result.code}`).trim();
	if (/broken pipe|failed to write to socket|connection refused|no such file/i.test(detail)) {
		return new Error(
			`cmux browser is unavailable (${detail}). Confirm Pi is running inside a live cmux workspace, run \`cmux ping\`, and retry.`,
		);
	}
	if (/not[_ -]supported/i.test(detail)) {
		return new Error(`cmux/WKWebView does not support this operation: ${detail}`);
	}
	return new Error(`cmux ${args.join(" ")} failed: ${detail}`);
}

export class CmuxBrowserClient {
	private activeSurface?: string;

	constructor(
		private readonly execCmux: ExecCmux,
		initialSurface?: string,
	) {
		this.activeSurface = initialSurface;
	}

	getActiveSurface(): string | undefined {
		return this.activeSurface;
	}

	setActiveSurface(surface: string | undefined): void {
		this.activeSurface = surface?.trim() || undefined;
	}

	private requireSurface(surface?: string): string {
		const resolved = surface?.trim() || this.activeSurface;
		if (!resolved) {
			throw new Error("No browser surface is active. Call browser_navigate with action=open first, or pass surface explicitly.");
		}
		return resolved;
	}

	async run(args: string[], signal?: AbortSignal, timeout = 20_000): Promise<BrowserCommandResult> {
		const fullArgs = ["--json", "--id-format", "uuids", ...args];
		const result = await this.execCmux(fullArgs, { signal, timeout });
		if (result.code !== 0) throw formatFailure(args, result);
		const json = parseJson(result.stdout);
		const surface = findSurface(json);
		if (surface) this.activeSurface = surface;
		return { args, stdout: result.stdout, stderr: result.stderr, json, surface: surface ?? this.activeSurface };
	}

	async open(url: string, workspace: string | undefined, signal?: AbortSignal): Promise<BrowserCommandResult> {
		const args = ["browser", "open", url, "--focus", "false"];
		if (workspace?.trim()) args.push("--workspace", workspace.trim());
		return this.run(args, signal, 30_000);
	}

	async browser(surface: string | undefined, args: string[], signal?: AbortSignal, timeout?: number): Promise<BrowserCommandResult> {
		return this.run(["browser", this.requireSurface(surface), ...args], signal, timeout);
	}

	async closeSurface(surface: string | undefined, signal?: AbortSignal): Promise<BrowserCommandResult> {
		const target = this.requireSurface(surface);
		const result = await this.run(["close-surface", "--surface", target], signal);
		if (target === this.activeSurface) this.activeSurface = undefined;
		return { ...result, surface: undefined };
	}

	async upload(
		surface: string | undefined,
		selector: string,
		path: string,
		cwd: string,
		signal?: AbortSignal,
	): Promise<BrowserCommandResult> {
		const absolutePath = resolve(cwd, path.replace(/^@/, ""));
		const info = await stat(absolutePath);
		if (!info.isFile()) throw new Error(`Upload path is not a regular file: ${absolutePath}`);
		if (info.size > MAX_UPLOAD_BYTES) {
			throw new Error(`Upload is ${info.size} bytes; the safe DOM upload limit is ${MAX_UPLOAD_BYTES} bytes.`);
		}
		const data = (await readFile(absolutePath)).toString("base64");
		const target = this.requireSurface(surface);
		const evalScript = (script: string) => this.browser(target, ["eval", "--script", script], signal, 30_000);
		await evalScript("globalThis.__piCmuxUploadBase64 = ''");
		try {
			for (let offset = 0; offset < data.length; offset += UPLOAD_CHUNK_CHARS) {
				const chunk = data.slice(offset, offset + UPLOAD_CHUNK_CHARS);
				await evalScript(`globalThis.__piCmuxUploadBase64 += ${JSON.stringify(chunk)}`);
			}
			const script = `(() => {
				const input = document.querySelector(${JSON.stringify(selector)});
				if (!(input instanceof HTMLInputElement) || input.type !== 'file') throw new Error('selector must resolve to <input type="file">');
				const raw = atob(globalThis.__piCmuxUploadBase64 || '');
				const bytes = new Uint8Array(raw.length);
				for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
				const file = new File([bytes], ${JSON.stringify(basename(absolutePath))}, { type: 'application/octet-stream' });
				const transfer = new DataTransfer();
				transfer.items.add(file);
				input.files = transfer.files;
				input.dispatchEvent(new Event('input', { bubbles: true }));
				input.dispatchEvent(new Event('change', { bubbles: true }));
				return { name: file.name, size: file.size, files: input.files?.length ?? 0 };
			})()`;
			return await evalScript(script);
		} finally {
			await evalScript("delete globalThis.__piCmuxUploadBase64").catch(() => undefined);
		}
	}
}
