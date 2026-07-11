import type { BrowserCommandResult } from "./client.ts";

export interface BrowserDetails {
	action: string;
	surface?: string;
	command: string[];
	output?: string;
}

export interface NavigationTarget {
	url: string;
	origin: string;
}

const MAX_TOOL_OUTPUT_BYTES = 50 * 1024;
const SENSITIVE_QUERY_KEY = /(?:^|[_-])(auth|authorization|code|credential|key|password|secret|session|sig|signature|token)(?:$|[_-])/i;
const SENSITIVE_COMPACT_KEY = /(?:token|secret|password|credential|authorization|session|signature)/i;
const SENSITIVE_EXACT_KEY = new Set(["apikey", "auth", "code", "key", "sig"]);
const SAFE_SYNTHETIC_KEYS = new Set([
	"ok", "opened", "navigated", "closed", "interacted", "updated", "download_ready",
]);

export const INSPECTION_ATTRIBUTES = [
	"role", "aria-label", "aria-checked", "aria-disabled", "aria-expanded", "aria-hidden", "aria-selected", "alt", "name", "title", "type",
] as const;
const SAFE_INSPECTION_ATTRIBUTES = new Set<string>(INSPECTION_ATTRIBUTES);

export function snapshotRef(value: string | undefined, action: string): string {
	if (!value || !/^e[1-9][0-9]*$/.test(value)) {
		throw new Error(`${action} requires a fresh snapshot ref such as e3; arbitrary CSS selectors are not accepted.`);
	}
	return value;
}

export function inspectionArguments(property: string, target: string, attribute?: string): string[] {
	const ref = snapshotRef(target, "get");
	if (property === "attr") {
		if (!attribute) throw new Error("attribute is required when property=attr.");
		if (!SAFE_INSPECTION_ATTRIBUTES.has(attribute)) {
			throw new Error("Only the documented non-value metadata attributes are available; inspect sensitive values manually in cmux.");
		}
		return ["get", "attr", "--selector", ref, "--attr", attribute];
	}
	if (property === "text" || property === "count" || property === "box") {
		return ["get", property, "--selector", ref];
	}
	throw new Error("Unsupported inspection property.");
}

function isSensitiveParameterKey(key: string): boolean {
	const compact = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
	return SENSITIVE_QUERY_KEY.test(key) || SENSITIVE_COMPACT_KEY.test(compact) || SENSITIVE_EXACT_KEY.has(compact);
}

export function navigationTarget(raw: string): NavigationTarget {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error("Navigation requires an absolute http(s) URL or exactly about:blank.");
	}
	if (url.protocol === "about:" && url.href === "about:blank") return { url: url.href, origin: "about:blank" };
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("Only http:, https:, and exactly about:blank are allowed. Open local/custom schemes manually in cmux.");
	}
	if (url.username || url.password) throw new Error("URLs containing credentials are not allowed; authenticate in the native pane.");
	for (const key of url.searchParams.keys()) {
		if (isSensitiveParameterKey(key)) {
			throw new Error("URLs with credential-like parameters are not allowed; navigate manually in the native pane.");
		}
	}
	if (url.hash) {
		let fragment: string;
		try {
			fragment = decodeURIComponent(url.hash.slice(1));
		} catch {
			throw new Error("Navigation URL fragments must use valid percent encoding.");
		}
		for (const part of fragment.split(/[?&;]/)) {
			const equals = part.indexOf("=");
			if (equals >= 0 && isSensitiveParameterKey(part.slice(0, equals).replace(/^.*\//, ""))) {
				throw new Error("URLs with credential-like parameters are not allowed; navigate manually in the native pane.");
			}
		}
	}
	return { url: url.href, origin: url.origin };
}

export function compactOutput(result: BrowserCommandResult): string {
	if (result.exposure === "synthetic") {
		const safe: Record<string, boolean | number> = {};
		if (result.json && typeof result.json === "object" && !Array.isArray(result.json)) {
			for (const [key, value] of Object.entries(result.json)) {
				if (SAFE_SYNTHETIC_KEYS.has(key) && (typeof value === "boolean" || typeof value === "number")) safe[key] = value;
			}
		}
		return JSON.stringify(Object.keys(safe).length > 0 ? safe : { ok: true });
	}

	const raw = result.stdout.trim() || result.stderr.trim() || "ok";
	const bytes = Buffer.from(raw, "utf8");
	if (bytes.length <= MAX_TOOL_OUTPUT_BYTES) return raw;
	return `${bytes.subarray(0, MAX_TOOL_OUTPUT_BYTES).toString("utf8")}\n\n[Output truncated at ${MAX_TOOL_OUTPUT_BYTES} bytes]`;
}

export function toolResult(action: string, result: BrowserCommandResult) {
	const output = compactOutput(result);
	const details: BrowserDetails = {
		action,
		surface: result.surface ? "owned" : undefined,
		command: result.command,
		output,
	};
	return { content: [{ type: "text" as const, text: output }], details };
}
