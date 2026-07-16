import { navigationTarget } from "./policy.ts";

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

export interface SyntheticBrowserOutput {
	ok: true;
	opened?: true;
	navigated?: true;
	closed?: true;
	interacted?: true;
	download_ready?: true;
}

export type SyntheticOutcome = "ok" | "opened" | "navigated" | "closed" | "interacted" | "download_ready";

const SYNTHETIC_OUTPUTS: Readonly<Record<SyntheticOutcome, Readonly<SyntheticBrowserOutput>>> = Object.freeze({
	ok: Object.freeze({ ok: true }),
	opened: Object.freeze({ ok: true, opened: true }),
	navigated: Object.freeze({ ok: true, navigated: true }),
	closed: Object.freeze({ ok: true, closed: true }),
	interacted: Object.freeze({ ok: true, interacted: true }),
	download_ready: Object.freeze({ ok: true, download_ready: true }),
});

interface BrowserCommandResultBase {
	command: string[];
	surface?: string;
}

export interface CapturedBrowserCommandResult extends BrowserCommandResultBase {
	/** Bounded stdout from an explicitly read-only operation; intentionally model-visible. */
	exposure: "captured";
	stdout: string;
	json?: unknown;
	/** Internally verified snapshot origin; tool rendering never forwards this field. */
	observedOrigin?: string;
}

export interface SyntheticBrowserCommandResult extends BrowserCommandResultBase {
	/** Fixed extension-owned metadata. Raw subprocess stdout/stderr cannot inhabit this variant. */
	exposure: "synthetic";
	output: Readonly<SyntheticBrowserOutput>;
}

export type BrowserCommandResult = CapturedBrowserCommandResult | SyntheticBrowserCommandResult;

export interface RunOptions {
	/** Retain bounded stdout for explicitly read-only inspection operations. */
	capture?: boolean;
	/** Parse exactly the documented top-level browser-open surface_id field. */
	captureOpenedSurface?: boolean;
	/** Project a raw cmux snapshot response to accessibility text and authoritative refs only. */
	captureSnapshot?: boolean;
	/** Require close output to confirm this exact owned top-level surface_id. */
	confirmClosedSurface?: string;
	/** Select one fixed extension-owned result when raw command output is discarded. */
	success?: SyntheticOutcome;
}

export interface BrowserLifecycleBlock {
	blocked: boolean;
}

const MAX_CAPTURE_BYTES = 50 * 1024;
const MAX_SNAPSHOT_RESPONSE_BYTES = 10 * 1024 * 1024;
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
const SNAPSHOT_REF_VALUE = /^e[1-9][0-9]*$/;
const REFERENCED_SNAPSHOT_NAME = /^(\s*-\s+[^\s]+)\s+"[^"]*"(\s+\[ref=e[1-9][0-9]*\].*)$/gm;
const DOCUMENT_SNAPSHOT_NAME = /^(\s*-\s+document)\s+"[^"]*"\s*$/gm;
const SAFE_KEY = new Set([
	"Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
	"Home", "End", "PageUp", "PageDown", "Space",
]);
const SAFE_ATTRIBUTE = new Set([
	"role", "aria-label", "aria-checked", "aria-disabled", "aria-expanded", "aria-hidden", "aria-selected",
	"alt", "name", "title", "type",
]);
function invalidArguments(): never {
	throw new Error("Invalid browser arguments; only the extension's fixed documented command shapes are allowed.");
}

function assertSafeNavigationUrl(raw: string | undefined): void {
	if (!raw) invalidArguments();
	try {
		navigationTarget(raw);
	} catch {
		invalidArguments();
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

function confirmsClosedSurface(json: unknown, expected: string): boolean {
	if (!json || typeof json !== "object" || Array.isArray(json)) return false;
	return (json as Record<string, unknown>).surface_id === expected;
}

function projectSnapshot(raw: string): {
	stdout: string;
	json: { snapshot: string; refs: string[] };
	observedOrigin: string;
} {
	if (Buffer.byteLength(raw, "utf8") > MAX_SNAPSHOT_RESPONSE_BYTES) {
		throw new Error("cmux snapshot response exceeded the private processing limit; raw output was suppressed.");
	}
	const parsed = parseJson(raw);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("cmux snapshot returned no valid top-level accessibility payload; raw output was suppressed.");
	}
	const payload = parsed as Record<string, unknown>;
	if (typeof payload.snapshot !== "string") {
		throw new Error("cmux snapshot returned no valid top-level accessibility text; raw output was suppressed.");
	}
	if (typeof payload.url !== "string") {
		throw new Error("cmux snapshot returned no valid top-level URL for origin verification; raw output was suppressed.");
	}
	let observedOrigin: string;
	try {
		const url = new URL(payload.url);
		if (url.href === "about:blank") observedOrigin = "about:blank";
		else if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== "null") observedOrigin = url.origin;
		else throw new Error("unsupported snapshot origin");
	} catch {
		throw new Error("cmux snapshot returned an unsupported top-level URL; raw output was suppressed.");
	}
	// cmux 0.64.13 may use an input's live value as its accessibility name even
	// when the input declares a misleading explicit ARIA role. Remove every
	// ref-bearing name (and the document title) rather than trusting page roles.
	const sanitizedSnapshot = payload.snapshot
		.replace(REFERENCED_SNAPSHOT_NAME, "$1$2")
		.replace(DOCUMENT_SNAPSHOT_NAME, "$1");
	const snapshot = utf8Prefix(sanitizedSnapshot, MAX_CAPTURE_BYTES);
	const refsObject = payload.refs && typeof payload.refs === "object" && !Array.isArray(payload.refs)
		? payload.refs as Record<string, unknown>
		: {};
	const refs = Object.keys(refsObject).filter((ref) => SNAPSHOT_REF_VALUE.test(ref));
	return { stdout: snapshot, json: { snapshot, refs }, observedOrigin };
}

export class CmuxBrowserClient {
	private activeSurface?: string;
	private readonly ownedSurfaces = new Set<string>();
	private readonly freshSnapshotRefs = new Set<string>();
	private readonly execCmux: ExecCmux;
	private operationTail: Promise<void> = Promise.resolve();
	private openLifecycleUncertain: boolean;
	private readonly lifecycleBlock?: BrowserLifecycleBlock;

	constructor(execCmux: ExecCmux, lifecycleBlock?: BrowserLifecycleBlock) {
		this.execCmux = execCmux;
		this.lifecycleBlock = lifecycleBlock;
		this.openLifecycleUncertain = lifecycleBlock?.blocked ?? false;
	}

	private withExclusiveOperation<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.operationTail.then(operation, operation);
		this.operationTail = result.then(() => undefined, () => undefined);
		return result;
	}

	private blockFutureOpens(): void {
		this.openLifecycleUncertain = true;
		if (this.lifecycleBlock) this.lifecycleBlock.blocked = true;
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
		if (result.exposure !== "captured") return;
		if (!result.json || typeof result.json !== "object" || Array.isArray(result.json)) return;
		const refs = (result.json as Record<string, unknown>).refs;
		if (!Array.isArray(refs)) return;
		for (const ref of refs) {
			if (typeof ref === "string" && SNAPSHOT_REF_VALUE.test(ref)) this.freshSnapshotRefs.add(ref);
		}
	}

	private async run(args: string[], signal?: AbortSignal, timeout = 20_000, options: RunOptions = {}): Promise<BrowserCommandResult> {
		let result: ExecResult;
		try {
			result = await this.execCmux(["--json", "--id-format", "uuids", ...args], { signal, timeout });
		} catch {
			throw lifecycleFailure(args, "could not be invoked");
		}
		if (result.killed) throw lifecycleFailure(args, "was interrupted before completion could be confirmed");
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

		if (options.confirmClosedSurface) {
			const parsed = parseJson(utf8Prefix(result.stdout, 8 * 1024));
			if (!confirmsClosedSurface(parsed, options.confirmClosedSurface)) {
				throw new Error("cmux close succeeded without confirming the exact owned surface_id; raw output was suppressed.");
			}
		}

		if (options.captureSnapshot) {
			const projected = projectSnapshot(result.stdout);
			return { command: safeCommand(args), ...projected, surface, exposure: "captured" };
		}

		if (options.capture) {
			const stdout = utf8Prefix(result.stdout, MAX_CAPTURE_BYTES);
			return { command: safeCommand(args), stdout, json: parseJson(stdout), surface, exposure: "captured" };
		}

		return {
			command: safeCommand(args),
			output: SYNTHETIC_OUTPUTS[options.success ?? "ok"],
			surface,
			exposure: "synthetic",
		};
	}

	async open(url: string, signal?: AbortSignal): Promise<BrowserCommandResult> {
		return this.withExclusiveOperation(async () => {
			if (this.openLifecycleUncertain) {
				throw new Error("Browser open lifecycle is uncertain after an earlier failed or malformed response. Close any unowned native pane manually and restart Pi before opening another.");
			}
			if (this.activeSurface) throw new Error("An extension-owned browser surface is already active; close it before opening another.");
			assertSafeNavigationUrl(url);
			this.freshSnapshotRefs.clear();
			try {
				return await this.run(
					["browser", "open", url, "--focus", "false"],
					signal,
					30_000,
					{ captureOpenedSurface: true, success: "opened" },
				);
			} catch (error) {
				// cmux may create the pane before an abort, timeout, transport failure,
				// or malformed response prevents us from learning its UUID. Refuse all
				// later opens in this instance rather than risk orphaning a second pane.
				this.blockFutureOpens();
				throw error;
			}
		});
	}

	private async browserUnlocked(
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
		if ((options.capture || options.captureSnapshot) && !CAPTURED_BROWSER_READS.has(operation)) {
			throw new Error("Captured output is allowed only for browser snapshot/get/console/errors reads.");
		}
		if (operation === "snapshot" && !options.captureSnapshot) {
			throw new Error("Snapshot output must use the accessibility-only projection.");
		}
		if (operation !== "snapshot" && options.captureSnapshot) {
			throw new Error("The accessibility-only projection is valid only for snapshots.");
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

	async browser(
		args: string[],
		signal?: AbortSignal,
		timeout = 20_000,
		options: RunOptions = {},
	): Promise<BrowserCommandResult> {
		return this.withExclusiveOperation(() => this.browserUnlocked(args, signal, timeout, options));
	}

	async currentOrigin(signal?: AbortSignal): Promise<string> {
		return this.withExclusiveOperation(async () => {
			const result = await this.browserUnlocked(["get", "url"], signal, 20_000, { capture: true });
			if (result.exposure !== "captured") {
				throw new Error("Could not verify an approved http(s) browser origin; operation refused.");
			}
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
		});
	}

	async closeActive(signal?: AbortSignal): Promise<BrowserCommandResult> {
		return this.withExclusiveOperation(async () => {
			const target = this.requireOwnedSurface();
			// Keep ownership until cmux confirms success. A failed or aborted close
			// may have left the pane alive, so forgetting it would permit a second open.
			const result = await this.run(
				["close-surface", "--surface", target],
				signal,
				20_000,
				{ confirmClosedSurface: target, success: "closed" },
			);
			this.ownedSurfaces.delete(target);
			this.activeSurface = undefined;
			this.freshSnapshotRefs.clear();
			return { ...result, surface: undefined };
		});
	}

	async closeAll(): Promise<boolean> {
		return this.withExclusiveOperation(async () => {
			for (const surface of [...this.ownedSurfaces]) {
				try {
					await this.run(
						["close-surface", "--surface", surface],
						undefined,
						5_000,
						{ confirmClosedSurface: surface, success: "closed" },
					);
					this.ownedSurfaces.delete(surface);
				} catch {
					// Shutdown cleanup is best-effort and deliberately does not retain raw diagnostics.
					// Preserve ownership so an explicit retry in this instance cannot open a second pane.
				}
			}
			if (this.activeSurface && !this.ownedSurfaces.has(this.activeSurface)) this.activeSurface = undefined;
			if (this.ownedSurfaces.size > 0) this.blockFutureOpens();
			this.freshSnapshotRefs.clear();
			return this.ownedSurfaces.size === 0;
		});
	}
}
