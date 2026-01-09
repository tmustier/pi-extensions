import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { extractSnippets, extractText } from "./snippets";
import type { Snippet } from "./snippets";
import { pickAction, pickSnippet } from "./ui";
import type { PickResult } from "./ui";
import { copyToClipboard, insertIntoEditor, runSnippet } from "./actions";

type ParsedArgs = {
	scope: "last" | "all";
	action?: "copy" | "insert" | "run";
	index?: number;
	includeInline: boolean;
	limit: number;
};

function parseArgs(args?: string): ParsedArgs {
	const tokens = args?.trim().split(/\s+/).filter(Boolean) ?? [];
	const parsed: ParsedArgs = { scope: "all", includeInline: true, limit: 200 };

	for (const token of tokens) {
		if (token === "all" || token === "last") {
			parsed.scope = token;
			continue;
		}
		if (token === "inline") {
			parsed.includeInline = true;
			continue;
		}
		if (token === "blocks") {
			parsed.includeInline = false;
			continue;
		}
		if (token === "copy" || token === "insert" || token === "run") {
			parsed.action = token;
			continue;
		}
		if (token.startsWith("limit=")) {
			const value = Number.parseInt(token.slice("limit=".length), 10);
			if (!Number.isNaN(value) && value > 0) parsed.limit = value;
			continue;
		}
		if (/^\d+$/.test(token)) {
			parsed.index = Math.max(0, Number.parseInt(token, 10) - 1);
		}
	}

	return parsed;
}

function collectSnippets(
	ctx: ExtensionCommandContext,
	scope: "last" | "all",
	includeInline: boolean,
	limit: number,
): Snippet[] {
	const branchEntries = ctx.sessionManager.getBranch();
	const assistantEntries = branchEntries.filter(
		(entry) => entry.type === "message" && entry.message?.role === "assistant",
	);

	if (assistantEntries.length === 0) return [];

	const sorted = assistantEntries.slice().sort((a, b) => {
		const aTime = Date.parse(a.timestamp);
		const bTime = Date.parse(b.timestamp);
		return bTime - aTime;
	});

	const entriesToScan = scope === "all" ? sorted : [sorted[0]!];

	let snippets: Snippet[] = [];
	let nextId = 0;
	for (const entry of entriesToScan) {
		if (snippets.length >= limit) break;
		const text = extractText(entry.message.content);
		if (!text) continue;
		const label = new Date(entry.timestamp).toLocaleTimeString();
		const extracted = extractSnippets(text, entry.id, label, nextId, includeInline, limit - snippets.length);
		snippets = snippets.concat(extracted);
		nextId = snippets.length;
	}

	return snippets;
}

export default function codeActionsExtension(pi: ExtensionAPI) {
	pi.registerCommand("code", {
		description: "Pick code from assistant messages and copy/insert/run it",
		handler: async (args, ctx) => {
			if (!ctx.hasUI && (!args || args.trim().length === 0)) {
				return;
			}

			const parsed = parseArgs(args);
			const snippets = collectSnippets(ctx, parsed.scope, parsed.includeInline, parsed.limit);

			if (snippets.length === 0) {
				if (ctx.hasUI) ctx.ui.notify("No code snippets found. /code tracks code blocks and filepaths only.", "warning");
				return;
			}

			let snippet: Snippet | undefined;
			let pickedAction: PickResult["action"] | undefined;
			if (parsed.index !== undefined) {
				snippet = snippets[parsed.index];
				if (!snippet) {
					if (ctx.hasUI) ctx.ui.notify("Snippet index out of range.", "warning");
					return;
				}
			} else {
				if (!ctx.hasUI) return;
				const result = await pickSnippet(ctx, snippets);
				if (!result) return;
				snippet = result.snippet;
				pickedAction = result.action;
			}

			let action = parsed.action ?? pickedAction;
			if (!action) {
				if (!ctx.hasUI) return;
				action = await pickAction(ctx);
			}
			if (!action) return;

			if (action === "copy") {
				const ok = await copyToClipboard(pi, snippet.content);
				if (ctx.hasUI) {
					ctx.ui.notify(ok ? "Copied to clipboard." : "Failed to copy to clipboard.", ok ? "info" : "error");
				}
				return;
			}

			if (action === "insert") {
				if (!ctx.hasUI) return;
				insertIntoEditor(ctx, snippet.content);
				ctx.ui.notify("Inserted snippet into editor.", "info");
				return;
			}

			if (action === "run") {
				if (!ctx.hasUI) return;
				const ok = await ctx.ui.confirm("Run snippet?", "This will execute the selected snippet in your shell.");
				if (!ok) return;
				await runSnippet(pi, ctx, snippet.content);
			}
		},
	});
}
