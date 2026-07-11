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
const SAFE_SYNTHETIC_KEYS = new Set([
	"ok", "opened", "navigated", "closed", "interacted", "download_ready",
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
	if (url.pathname !== "/" || url.search || url.hash) {
		throw new Error("Model navigation is limited to an origin root with no path, query, or fragment; navigate deeper manually in the native pane.");
	}
	return { url: `${url.origin}/`, origin: url.origin };
}

export function compactOutput(result: BrowserCommandResult): string {
	if (result.exposure === "synthetic") {
		const safe: Record<string, boolean> = {};
		for (const [key, value] of Object.entries(result.output)) {
			if (SAFE_SYNTHETIC_KEYS.has(key) && typeof value === "boolean") safe[key] = value;
		}
		return JSON.stringify(Object.keys(safe).length > 0 ? safe : { ok: true });
	}

	const raw = result.stdout.trim() || "ok";
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
