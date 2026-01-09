export type SnippetType = "block" | "inline";

export type Snippet = {
	id: number;
	type: SnippetType;
	language?: string;
	content: string;
	messageId: string;
	sourceLabel: string;
};

const INLINE_FILTER = {
	minSlashCount: 2,
};

const IGNORED_INLINE = new Set([
	"main",
	"inline",
	"blocks",
	"bash -lc",
	"ls",
	"pwd",
	"cd",
	"git status",
	"git diff",
	"git add",
	"git commit",
	"git push",
	"git pull",
	"git checkout",
	"git switch",
	"npm install",
	"pnpm install",
	"yarn install",
	"bun install",
	"npm test",
	"pnpm test",
	"yarn test",
	"npm run",
	"pnpm run",
	"yarn run",
	"make",
	"make test",
	"make lint",
	"make build",
]);

export function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	let text = "";
	for (const part of content) {
		if (part && typeof part === "object" && (part as { type?: string }).type === "text") {
			const value = (part as { text?: string }).text;
			if (value) text += value;
		}
	}

	return text;
}

function shouldIncludeInlineSnippet(content: string): boolean {
	const trimmed = content.trim();
	if (trimmed.length === 0) return false;
	if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) return false;
	if (IGNORED_INLINE.has(trimmed)) return false;
	if (/^[A-Za-z0-9._-]{1,5}$/.test(trimmed)) return false;
	const slashCount = (trimmed.match(/\//g) || []).length;
	if (slashCount < INLINE_FILTER.minSlashCount) return false;
	return true;
}

export function extractSnippets(
	text: string,
	messageId: string,
	sourceLabel: string,
	startId: number,
	includeInline: boolean,
	limit: number,
): Snippet[] {
	const snippets: Snippet[] = [];
	const fencedRanges: Array<{ start: number; end: number }> = [];
	const fencedRegex = /```([^\n`]*)\n([\s\S]*?)```/g;
	let match: RegExpExecArray | null;

	while ((match = fencedRegex.exec(text))) {
		if (snippets.length >= limit) return snippets;
		const language = match[1]?.trim() || undefined;
		const content = match[2]?.replace(/\n$/, "") ?? "";
		snippets.push({
			id: startId + snippets.length,
			type: "block",
			language,
			content,
			messageId,
			sourceLabel,
		});
		fencedRanges.push({ start: match.index, end: match.index + match[0].length });
	}

	if (!includeInline) return snippets;

	const inlineRegex = /`([^`\n]+)`/g;
	while ((match = inlineRegex.exec(text))) {
		if (snippets.length >= limit) return snippets;
		const index = match.index;
		const inFence = fencedRanges.some((range) => index >= range.start && index < range.end);
		if (inFence) continue;

		const content = match[1] ?? "";
		if (!shouldIncludeInlineSnippet(content)) continue;

		snippets.push({
			id: startId + snippets.length,
			type: "inline",
			content,
			messageId,
			sourceLabel,
		});
	}

	return snippets;
}

export function getSnippetPreview(snippet: Snippet): string {
	const content = snippet.content.trim();
	if (content.length === 0) return "(empty)";

	if (snippet.type === "block") {
		return content.replace(/\s+/g, " ");
	}

	const lines = content.split(/\r?\n/);
	const firstNonEmpty = lines.find((line) => line.trim().length > 0) ?? lines[0] ?? "";
	const preview = firstNonEmpty.trim();
	return preview.length > 0 ? preview : "(empty)";
}

export function truncatePreview(value: string, width: number): string {
	if (value.length <= width) return value;
	if (width <= 1) return value.slice(0, width);
	return `${value.slice(0, width - 1)}…`;
}
