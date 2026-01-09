import type { SelectItem } from "@mariozechner/pi-tui";
import type { Snippet } from "./snippets";
import { getSnippetPreview } from "./snippets";

export type SearchIndexItem = {
	item: SelectItem;
	idx: number;
	raw: string;
	normalized: string;
};

export function normalizeForSearch(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function buildSearchIndex(snippets: Snippet[], items: SelectItem[]): SearchIndexItem[] {
	return snippets.map((snippet, idx) => {
		const preview = getSnippetPreview(snippet);
		const type = snippet.type;
		const lang = snippet.language ?? "";
		const raw = `${preview} ${type} ${lang} ${snippet.sourceLabel}`.toLowerCase();
		return {
			item: items[idx]!,
			idx,
			raw,
			normalized: normalizeForSearch(raw),
		};
	});
}

export function rankedFilterItems(
	filter: string,
	items: SelectItem[],
	searchIndex: SearchIndexItem[],
): SelectItem[] {
	const lower = filter.toLowerCase();
	if (lower.length === 0) return items;

	const norm = normalizeForSearch(lower);
	const tokens = norm.length > 0 ? norm.split(" ") : [];
	const scored: Array<{ item: SelectItem; idx: number; score: number }> = [];

	for (const entry of searchIndex) {
		let score = 0;

		const rawIndex = entry.raw.indexOf(lower);
		if (rawIndex !== -1) {
			score = 1000 - rawIndex;
		} else if (tokens.length > 0) {
			let allMatch = true;
			let firstPos = Number.MAX_SAFE_INTEGER;
			for (const token of tokens) {
				const pos = entry.normalized.indexOf(token);
				if (pos === -1) {
					allMatch = false;
					break;
				}
				firstPos = Math.min(firstPos, pos);
			}
			if (!allMatch) continue;
			score = 500 - firstPos;
		} else {
			continue;
		}

		scored.push({ item: entry.item, idx: entry.idx, score });
	}

	scored.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		return a.idx - b.idx;
	});

	return scored.map((entry) => entry.item);
}
