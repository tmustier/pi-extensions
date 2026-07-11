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
	command: string[];
	stdout: string;
	json?: unknown;
	surface?: string;
	/** Captured output is intentionally model-visible; synthetic output is fixed extension metadata. */
	exposure: "captured" | "synthetic";
}

export interface RunOptions {
	/** Retain bounded stdout for explicitly read-only inspection operations. */
	capture?: boolean;
	/** Parse exactly the documented top-level browser-open surface_id field. */
	captureOpenedSurface?: boolean;
	/** Safe synthetic result used when raw command output is intentionally discarded. */
	success?: Record<string, boolean | number>;
}

const MAX_CAPTURE_BYTES = 50 * 1024;
const SURFACE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BROWSER_COMMANDS = new Set([
	"open", "goto", "reload", "snapshot", "wait", "click", "dblclick", "hover", "focus", "press",
	"check", "uncheck", "scroll", "scroll-into-view", "screenshot", "get", "console", "errors", "highlight", "download",
]);
const CAPTURED_BROWSER_READS = new Set(["snapshot", "get", "console", "errors"]);
const REF_TARGET_OPERATIONS = new Set([
	"click", "dblclick", "hover", "focus", "check", "uncheck", "scroll-into-view",
]);
const REF_INVALIDATING_OPERATIONS = new Set([
	"goto", "reload", "wait", "click", "dblclick", "hover", "focus", "press", "check", "uncheck", "scroll", "scroll-into-view",
]);
const SNAPSHOT_REF_MARKER = /\bref=(e[1-9][0-9]*)\b/g;
const SNAPSHOT_REF_VALUE = /^e[1-9][0-9]*$/;
const SAFE_KEY = new Set([
	"Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
	"Home", "End", "PageUp", "PageDown", "Space",
]);
const SAFE_ATTRIBUTE = new Set([
	"role", "aria-label", "aria-checked", "aria-disabled", "aria-expanded", "aria-hidden", "aria-selected",
	"alt", "name", "title", "type",
]);
const SENSITIVE_QUERY_KEY = /(?:^|[_-])(auth|authorization|code|credential|key|password|secret|session|sig|signature|token)(?:$|[_-])/i;
const SENSITIVE_COMPACT_KEY = /(?:token|secret|password|credential|authorization|session|signature)/i;
const SENSITIVE_EXACT_KEY = new Set(["apikey", "auth", "code", "key", "sig"]);

function invalidArguments(): never {
	throw new Error("Invalid browser arguments; only the extension's fixed documented command shapes are allowed.");
}

function isSensitiveParameterKey(key: string): boolean {
	const compact = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
	return SENSITIVE_QUERY_KEY.test(key) || SENSITIVE_COMPACT_KEY.test(compact) || SENSITIVE_EXACT_KEY.has(compact);
}

function assertSafeNavigationUrl(raw: string | undefined): void {
	if (!raw) invalidArguments();
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		invalidArguments();
	}
	if (url.protocol === "about:" && url.href === "about:blank") return;
	if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) invalidArguments();
	for (const key of url.searchParams.keys()) if (isSensitiveParameterKey(key)) invalidArguments();
	if (url.hash) {
		let fragment: string;
		try {
			fragment = decodeURIComponent(url.hash.slice(1));
		} catch {
			invalidArguments();
		}
		for (const part of fragment.split(/[?&;]/)) {
			const equals = part.indexOf("=");
			if (equals >= 0 && isSensitiveParameterKey(part.slice(0, equals).replace(/^.*\//, ""))) invalidArguments();
		}
	}
}

function isFiniteNumber(value: string | undefined, minimum: number, maximum: number): boolean {
	if (value === undefined || value.trim() === "") return false;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum;
}

function isInteger(value: string | undefined, minimum: number, maximum: number): boolean {
	return value !== undefined && /^\d+$/.test(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function validateOptions(args: string[], allowed: Record<string, (value?: string) => boolean>): void {
	const seen = new Set<string>();
	for (let index = 1; index < args.length;) {
		const flag = args[index]!;
		const accepts = allowed[flag];
		if (!accepts || seen.has(flag)) invalidArguments();
		seen.add(flag);
		if (accepts()) {
			index += 1;
		} else {
			if (!accepts(args[index + 1])) invalidArguments();
			index += 2;
		}
	}
}

function validateBrowserArguments(args: string[]): void {
	const operation = args[0];
	if (!operation) invalidArguments();
	if (operation === "goto") {
		if (args.length !== 2) invalidArguments();
		assertSafeNavigationUrl(args[1]);
		return;
	}
	if (operation === "reload") {
		if (args.length !== 1) invalidArguments();
		return;
	}
	if (operation === "snapshot") {
		validateOptions(args, {
			"--interactive": (value) => value === undefined,
			"--compact": (value) => value === undefined,
			"--max-depth": (value) => isInteger(value, 1, 20),
		});
		return;
	}
	if (["click", "dblclick", "hover", "focus", "check", "uncheck", "scroll-into-view"].includes(operation)) {
		if (args.length !== 2 || !SNAPSHOT_REF_VALUE.test(args[1] ?? "")) invalidArguments();
		return;
	}
	if (operation === "press") {
		if (args.length !== 3 || args[1] !== "--key" || !SAFE_KEY.has(args[2] ?? "")) invalidArguments();
		return;
	}
	if (operation === "scroll") {
		validateOptions(args, {
			"--selector": (value) => value !== undefined && SNAPSHOT_REF_VALUE.test(value),
			"--dx": (value) => isFiniteNumber(value, -10_000, 10_000),
			"--dy": (value) => isFiniteNumber(value, -10_000, 10_000),
		});
		if (args.length === 1) invalidArguments();
		return;
	}
	if (operation === "wait") {
		validateOptions(args, {
			"--selector": (value) => value !== undefined && SNAPSHOT_REF_VALUE.test(value),
			"--load-state": (value) => value === "interactive" || value === "complete",
			"--timeout-ms": (value) => isInteger(value, 1, 120_000),
		});
		if (args.length < 5 || !args.includes("--timeout-ms") || (!args.includes("--selector") && !args.includes("--load-state"))) invalidArguments();
		return;
	}
	if (operation === "get") {
		if ((args[1] === "url" || args[1] === "title") && args.length === 2) return;
		if (["text", "count", "box"].includes(args[1] ?? "") && args.length === 4 && args[2] === "--selector" && SNAPSHOT_REF_VALUE.test(args[3] ?? "")) return;
		if (args[1] === "attr" && args.length === 6 && args[2] === "--selector" && SNAPSHOT_REF_VALUE.test(args[3] ?? "") && args[4] === "--attr" && SAFE_ATTRIBUTE.has(args[5] ?? "")) return;
		invalidArguments();
	}
	if ((operation === "console" || operation === "errors") && args.length === 2 && args[1] === "list") return;
	if (operation === "highlight" && args.length === 3 && args[1] === "--selector" && SNAPSHOT_REF_VALUE.test(args[2] ?? "")) return;
	if (operation === "screenshot" && args.length === 3 && args[1] === "--out" && Boolean(args[2])) return;
	if (operation === "download" && args.length === 4 && args[1] === "wait" && args[2] === "--timeout-ms" && isInteger(args[3], 1, 120_000)) return;
	invalidArguments();
}

function parseJson(text: string): unknown | undefined {
	const trimmed = text.trim();
	if (!trimmed) return undefined;
	try {
		return JSON.parse(trimmed);
	} catch {
		return undefined;
	}
}

function utf8Prefix(text: string, maxBytes: number): string {
	const bytes = Buffer.from(text, "utf8");
	if (bytes.length <= maxBytes) return text;
	return `${bytes.subarray(0, maxBytes).toString("utf8")}\n[output truncated at ${maxBytes} bytes]`;
}

/** Return only fixed operation labels. No URL, selector, text, path, script, or handle is retained. */
function safeCommand(args: string[]): string[] {
	if (args[0] === "close-surface") return ["close-surface"];
	if (args[0] !== "browser") return ["cmux"];
	if (args[1] && BROWSER_COMMANDS.has(args[1])) return ["browser", args[1]];
	if (args[2] && BROWSER_COMMANDS.has(args[2])) return ["browser", "<owned-surface>", args[2]];
	return ["browser"];
}

function lifecycleFailure(args: string[], outcome: string): Error {
	const command = safeCommand(args).join(" ");
	return new Error(
		`cmux ${command} ${outcome}. Raw diagnostics were suppressed. If cmux may be unavailable, confirm Pi is running inside a live cmux workspace and run \`cmux ping\`.`,
	);
}

function formatFailure(args: string[], result: ExecResult): Error {
	return lifecycleFailure(args, `failed (exit ${result.code})`);
}

function openedSurface(json: unknown): string | undefined {
	if (!json || typeof json !== "object" || Array.isArray(json)) return undefined;
	const value = (json as Record<string, unknown>).surface_id;
	return typeof value === "string" && SURFACE_UUID.test(value) ? value : undefined;
}

export class CmuxBrowserClient {
	private activeSurface?: string;
	private readonly ownedSurfaces = new Set<string>();
	private readonly freshSnapshotRefs = new Set<string>();
	private readonly execCmux: ExecCmux;

	constructor(execCmux: ExecCmux) {
		this.execCmux = execCmux;
	}

	getActiveSurface(): string | undefined {
		return this.activeSurface;
	}

	getOwnedSurfaceCount(): number {
		return this.ownedSurfaces.size;
	}

	private requireOwnedSurface(): string {
		const surface = this.activeSurface;
		if (!surface || !this.ownedSurfaces.has(surface)) {
			throw new Error("No extension-owned browser surface is active. Call browser_navigate with action=open first.");
		}
		return surface;
	}

	private referencedSnapshotRef(args: string[]): string | undefined {
		const operation = args[0] ?? "";
		if (REF_TARGET_OPERATIONS.has(operation)) return args[1];
		if (operation === "get" && args[1] !== "url") {
			const index = args.indexOf("--selector");
			return index >= 0 ? args[index + 1] : undefined;
		}
		if (operation === "highlight" || operation === "wait" || operation === "scroll") {
			const index = args.indexOf("--selector");
			return index >= 0 ? args[index + 1] : undefined;
		}
		return undefined;
	}

	private recordSnapshotRefs(result: BrowserCommandResult): void {
		this.freshSnapshotRefs.clear();
		if (!result.json || typeof result.json !== "object" || Array.isArray(result.json)) return;
		const snapshot = (result.json as Record<string, unknown>).snapshot;
		if (typeof snapshot !== "string") return;
		for (const match of snapshot.matchAll(SNAPSHOT_REF_MARKER)) this.freshSnapshotRefs.add(match[1]!);
	}

	private async run(args: string[], signal?: AbortSignal, timeout = 20_000, options: RunOptions = {}): Promise<BrowserCommandResult> {
		let result: ExecResult;
		try {
			result = await this.execCmux(["--json", "--id-format", "uuids", ...args], { signal, timeout });
		} catch {
			throw lifecycleFailure(args, "could not be invoked");
		}
		if (result.code !== 0) throw formatFailure(args, result);

		let surface = this.activeSurface;
		if (options.captureOpenedSurface) {
			const parsed = parseJson(utf8Prefix(result.stdout, 8 * 1024));
			const opened = openedSurface(parsed);
			if (!opened) {
				throw new Error("cmux browser open succeeded but returned no valid top-level surface_id UUID; raw output was suppressed.");
			}
			this.ownedSurfaces.add(opened);
			this.activeSurface = opened;
			surface = opened;
		}

		if (options.capture) {
			const stdout = utf8Prefix(result.stdout, MAX_CAPTURE_BYTES);
			return { command: safeCommand(args), stdout, json: parseJson(stdout), surface, exposure: "captured" };
		}

		const json = options.success ?? { ok: true };
		return {
			command: safeCommand(args),
			stdout: JSON.stringify(json),
			json,
			surface,
			exposure: "synthetic",
		};
	}

	async open(url: string, signal?: AbortSignal): Promise<BrowserCommandResult> {
		if (this.activeSurface) throw new Error("An extension-owned browser surface is already active; close it before opening another.");
		assertSafeNavigationUrl(url);
		this.freshSnapshotRefs.clear();
		return this.run(
			["browser", "open", url, "--focus", "false"],
			signal,
			30_000,
			{ captureOpenedSurface: true, success: { ok: true, opened: true } },
		);
	}

	async browser(
		args: string[],
		signal?: AbortSignal,
		timeout = 20_000,
		options: RunOptions = {},
	): Promise<BrowserCommandResult> {
		const surface = this.requireOwnedSurface();
		const operation = args[0] ?? "";
		if (!BROWSER_COMMANDS.has(operation) || operation === "open") {
			throw new Error("Unsupported browser operation; only the extension's fixed capability set is allowed.");
		}
		validateBrowserArguments(args);
		if (options.capture && !CAPTURED_BROWSER_READS.has(operation)) {
			throw new Error("Captured output is allowed only for browser snapshot/get/console/errors reads.");
		}
		const referenced = this.referencedSnapshotRef(args);
		if (referenced !== undefined && !this.freshSnapshotRefs.has(referenced)) {
			throw new Error("The requested element ref is not present in the latest successful snapshot; take a fresh snapshot first.");
		}
		if (operation === "snapshot" || REF_INVALIDATING_OPERATIONS.has(operation)) this.freshSnapshotRefs.clear();
		const result = await this.run(["browser", surface, ...args], signal, timeout, options);
		if (operation === "snapshot") this.recordSnapshotRefs(result);
		return result;
	}

	async currentOrigin(signal?: AbortSignal): Promise<string> {
		const result = await this.browser(["get", "url"], signal, 20_000, { capture: true });
		const parsed = result.json;
		const raw = parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>).url
			: undefined;
		if (typeof raw !== "string") {
			throw new Error("Could not verify an approved http(s) browser origin; operation refused.");
		}
		try {
			const url = new URL(raw);
			if (url.href === "about:blank") return "about:blank";
			if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== "null") return url.origin;
			throw new Error("unsupported browser origin");
		} catch {
			throw new Error("Could not verify an approved http(s) browser origin; operation refused.");
		}
	}

	async closeActive(signal?: AbortSignal): Promise<BrowserCommandResult> {
		const target = this.requireOwnedSurface();
		// Relinquish ownership before the subprocess call so an aborted or failed
		// close can never resurrect a stale handle in this extension instance.
		this.ownedSurfaces.delete(target);
		this.activeSurface = undefined;
		this.freshSnapshotRefs.clear();
		const result = await this.run(
			["close-surface", "--surface", target],
			signal,
			20_000,
			{ success: { ok: true, closed: true } },
		);
		return { ...result, surface: undefined };
	}

	async closeAll(): Promise<void> {
		for (const surface of [...this.ownedSurfaces]) {
			try {
				await this.run(
					["close-surface", "--surface", surface],
					undefined,
					5_000,
					{ success: { ok: true, closed: true } },
				);
			} catch {
				// Shutdown cleanup is best-effort and deliberately does not retain raw diagnostics.
			}
			this.ownedSurfaces.delete(surface);
		}
		this.activeSurface = undefined;
		this.freshSnapshotRefs.clear();
	}
}
