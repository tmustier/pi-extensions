import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text, matchesKey } from "@mariozechner/pi-tui";
import type { Snippet } from "./snippets";
import { getSnippetPreview, truncatePreview } from "./snippets";
import { buildSearchIndex, rankedFilterItems } from "./search";

const PREVIEW_WIDTH = 52;

function buildSnippetLabel(snippet: Snippet, index: number, indexWidth: number, timeWidth: number): string {
	const preview = truncatePreview(getSnippetPreview(snippet), PREVIEW_WIDTH).padEnd(PREVIEW_WIDTH, " ");
	const number = String(index + 1).padStart(indexWidth, " ");
	const type = snippet.type === "block" ? "Block" : "Inline";
	const lang = snippet.type === "block" && snippet.language ? ` (${snippet.language})` : "";
	const time = snippet.sourceLabel.padEnd(timeWidth, " ");
	return `${number}. ${preview} ${time} ${type}${lang}`;
}

export type PickResult = {
	snippet: Snippet;
	action?: "copy" | "insert";
};

export async function pickSnippet(ctx: ExtensionCommandContext, snippets: Snippet[]): Promise<PickResult | undefined> {
	const indexWidth = String(snippets.length).length;
	const timeWidth = Math.max(...snippets.map((snippet) => snippet.sourceLabel.length));
	const items: SelectItem[] = snippets.map((snippet, idx) => ({
		value: String(idx),
		label: buildSnippetLabel(snippet, idx, indexWidth, timeWidth),
		description: "",
	}));
	const searchIndex = buildSearchIndex(snippets, items);

	const selectedIndex = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		const container = new Container();

		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		const title = new Text(theme.fg("accent", theme.bold("Select Code Snippet")), 1, 0);
		container.addChild(title);

		const list = new SelectList(items, Math.min(items.length, 12), {
			selectedPrefix: (t) => theme.fg("accent", t),
			selectedText: (t) => theme.fg("accent", t),
			description: (t) => theme.fg("muted", t),
			scrollInfo: (t) => theme.fg("dim", t),
			noMatch: (t) => theme.fg("warning", t),
		});

		list.onSelect = (item) => done(`copy:${item.value}`);
		list.onCancel = () => done(null);
		container.addChild(list);

		const help = new Text(
			theme.fg("dim", "Filter: (none)   Enter copy   Right/Tab insert   Up/Down navigate   Esc cancel"),
			1,
			0,
		);
		container.addChild(help);
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		let filter = "";
		const updateFilter = (next: string) => {
			filter = next;
			const listAny = list as unknown as { filteredItems: SelectItem[]; selectedIndex: number };
			listAny.filteredItems = rankedFilterItems(filter, items, searchIndex);
			listAny.selectedIndex = 0;

			help.setText(
				theme.fg(
					"dim",
					`Filter: ${filter.length > 0 ? filter : "(none)"}   Enter copy   Right/Tab insert   Up/Down navigate   Esc cancel`,
					),
				);
			list.invalidate();
			tui.requestRender();
		};

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, "backspace")) {
					if (filter.length > 0) updateFilter(filter.slice(0, -1));
					return;
				}

				if (matchesKey(data, "right") || matchesKey(data, "tab")) {
					const selected = list.getSelectedItem();
					if (selected) done(`insert:${selected.value}`);
					return;
				}

				if (data.length === 1 && data >= " " && data <= "~") {
					updateFilter(filter + data);
					return;
				}

				list.handleInput?.(data);
				tui.requestRender();
			},
		};
	});

	if (selectedIndex === null || selectedIndex === undefined) return undefined;
	const [action, rawIndex] = selectedIndex.split(":");
	const index = Number.parseInt(rawIndex ?? "", 10);
	if (Number.isNaN(index)) return undefined;
	const snippet = snippets[index];
	if (!snippet) return undefined;
	if (action === "copy" || action === "insert") {
		return { snippet, action };
	}
	return { snippet };
}

export async function pickAction(ctx: ExtensionCommandContext): Promise<"copy" | "insert" | "run" | undefined> {
	const action = await ctx.ui.select("Action", ["Copy", "Insert", "Run"]);
	if (!action) return undefined;
	return action.toLowerCase() as "copy" | "insert" | "run";
}
