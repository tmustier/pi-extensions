/**
 * /usage - Usage statistics dashboard
 *
 * Shows an inline view with usage stats grouped by provider.
 * - Tab cycles: Today → This Week → Last Week → All Time
 * - Arrow keys navigate providers
 * - Enter expands/collapses to show models
 *
 * Data collection and caching live in ./data.ts.
 */

import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { CancellableLoader, Container, Spacer, matchesKey, visibleWidth, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import { collectUsageData, TAB_ORDER } from "./data";
import type { CollectProgress } from "./data";
import type { BaseStats, TabName, UsageData } from "./data";
import {
	buildGraphModel,
	renderChart,
	GROUP_LABELS,
	GROUP_ORDER,
	METRIC_LABELS,
	METRIC_ORDER,
	TOTAL_SERIES_KEY,
} from "./graph";
import type { GraphGroupBy, GraphMetric, GraphModel } from "./graph";
import { buildGraphCsv, buildInsightsJson, buildTableCsv, exportFileName } from "./export";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

type ViewMode = "table" | "insights" | "graph";

const VIEW_CYCLE: ViewMode[] = ["graph", "table", "insights"];

const VIEW_LABELS: Record<ViewMode, string> = {
	graph: "Graphs",
	table: "Table",
	insights: "Insights",
};

// =============================================================================
// Column Configuration
// =============================================================================

interface DataColumn {
	label: string;
	width: number;
	dimmed?: boolean;
	getValue: (stats: BaseStats & { sessions: Set<string> | number }) => string;
}

interface TableLayoutCandidate {
	columns: DataColumn[];
	minNameWidth: number;
	compact?: boolean;
}

interface TableLayout {
	columns: DataColumn[];
	nameWidth: number;
	tableWidth: number;
	compact: boolean;
}

const MAX_NAME_COL_WIDTH = 26;

const SESSIONS_COLUMN: DataColumn = {
	label: "Sessions",
	width: 9,
	getValue: (s) => formatNumber(typeof s.sessions === "number" ? s.sessions : s.sessions.size),
};

const MSGS_COLUMN: DataColumn = {
	label: "Msgs",
	width: 9,
	getValue: (s) => formatNumber(s.messages),
};

const COST_COLUMN: DataColumn = {
	label: "Cost",
	width: 9,
	getValue: (s) => formatCost(s.cost),
};

const TOKENS_COLUMN: DataColumn = {
	label: "Tokens",
	width: 9,
	getValue: (s) => formatTokens(s.tokens.total),
};

const INPUT_COLUMN: DataColumn = {
	label: "↑In",
	width: 8,
	dimmed: true,
	// Include cacheWrite so this reflects fresh input tokens sent this turn,
	// even for providers like Anthropic that split cached prompt creation out
	// from the regular input token count.
	getValue: (s) => formatTokens(s.tokens.input + s.tokens.cacheWrite),
};

const OUTPUT_COLUMN: DataColumn = {
	label: "↓Out",
	width: 8,
	dimmed: true,
	getValue: (s) => formatTokens(s.tokens.output),
};

const CACHE_COLUMN: DataColumn = {
	label: "Cache",
	width: 8,
	dimmed: true,
	getValue: (s) => formatTokens(s.tokens.cacheRead + s.tokens.cacheWrite),
};

const FULL_DATA_COLUMNS: DataColumn[] = [
	SESSIONS_COLUMN,
	MSGS_COLUMN,
	COST_COLUMN,
	TOKENS_COLUMN,
	INPUT_COLUMN,
	OUTPUT_COLUMN,
	CACHE_COLUMN,
];

const TABLE_LAYOUTS: TableLayoutCandidate[] = [
	{ columns: FULL_DATA_COLUMNS, minNameWidth: MAX_NAME_COL_WIDTH },
	{ columns: [SESSIONS_COLUMN, MSGS_COLUMN, COST_COLUMN, TOKENS_COLUMN], minNameWidth: 14, compact: true },
	{ columns: [SESSIONS_COLUMN, COST_COLUMN, TOKENS_COLUMN], minNameWidth: 12, compact: true },
	{ columns: [COST_COLUMN, TOKENS_COLUMN], minNameWidth: 10, compact: true },
	{ columns: [COST_COLUMN], minNameWidth: 8, compact: true },
];

// =============================================================================
// Formatting Helpers
// =============================================================================

function formatCost(cost: number): string {
	if (cost === 0) return "-";
	if (cost < 0.01) return `$${cost.toFixed(4)}`;
	if (cost < 1) return `$${cost.toFixed(2)}`;
	if (cost < 10) return `$${cost.toFixed(2)}`;
	if (cost < 100) return `$${cost.toFixed(1)}`;
	return `$${Math.round(cost)}`;
}

function formatTokens(count: number): string {
	if (count === 0) return "-";
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function formatNumber(n: number): string {
	if (n === 0) return "-";
	return n.toLocaleString();
}

// Compact axis/legend formatters for the graph view.
function formatAxisCost(v: number): string {
	if (v === 0) return "$0";
	if (v < 1) return `$${v.toFixed(2)}`;
	if (v < 100) return `$${v.toFixed(1)}`;
	if (v < 10_000) return `$${Math.round(v)}`;
	if (v < 1_000_000) return `$${(v / 1000).toFixed(1)}k`;
	return `$${(v / 1_000_000).toFixed(2)}M`;
}

function formatAxisCount(v: number): string {
	if (v === 0) return "0";
	if (v < 1000) return String(Math.round(v));
	if (v < 1_000_000) return `${(v / 1000).toFixed(v < 10_000 ? 1 : 0)}k`;
	if (v < 1_000_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
	return `${(v / 1_000_000_000).toFixed(1)}B`;
}

// Bright ANSI palette for graph series (Total uses index 0).
const SERIES_COLORS = ["\x1b[97m", "\x1b[96m", "\x1b[95m", "\x1b[93m", "\x1b[92m", "\x1b[94m", "\x1b[91m", "\x1b[90m"];
const COLOR_RESET = "\x1b[39m";

function seriesColor(index: number): string {
	return SERIES_COLORS[index % SERIES_COLORS.length]!;
}

/** "14:32" if the timestamp is today, otherwise "16 Jul" (with year if not this year). */
function formatSinceDate(ms: number): string {
	const d = new Date(ms);
	const now = new Date();
	if (d.toDateString() === now.toDateString()) {
		return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
	}
	const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
	if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
	return d.toLocaleDateString(undefined, opts);
}

function padLeft(s: string, len: number): string {
	const vis = visibleWidth(s);
	if (vis >= len) return s;
	return " ".repeat(len - vis) + s;
}

function padRight(s: string, len: number): string {
	const vis = visibleWidth(s);
	if (vis >= len) return s;
	return s + " ".repeat(len - vis);
}

function sumColumnWidths(columns: DataColumn[]): number {
	return columns.reduce((sum, col) => sum + col.width, 0);
}

function fitCell(s: string, len: number, align: "left" | "right" = "left"): string {
	if (len <= 0) return "";
	const truncated = truncateToWidth(s, len);
	return align === "right" ? padLeft(truncated, len) : padRight(truncated, len);
}

function clampLines(lines: string[], width: number): string[] {
	return lines.map((line) => truncateToWidth(line, Math.max(width, 0)));
}

function pickFittingText(width: number, variants: string[]): string {
	for (const variant of variants) {
		if (visibleWidth(variant) <= width) return variant;
	}
	return variants[variants.length - 1] || "";
}

function getTableLayout(width: number): TableLayout {
	const safeWidth = Math.max(width, 0);

	for (const candidate of TABLE_LAYOUTS) {
		const columnsWidth = sumColumnWidths(candidate.columns);
		const nameWidth = Math.min(MAX_NAME_COL_WIDTH, Math.max(safeWidth - columnsWidth, 0));
		if (nameWidth >= candidate.minNameWidth) {
			return {
				columns: candidate.columns,
				nameWidth,
				tableWidth: nameWidth + columnsWidth,
				compact: candidate.compact ?? false,
			};
		}
	}

	const fallback = TABLE_LAYOUTS[TABLE_LAYOUTS.length - 1]!;
	const fallbackColumnsWidth = sumColumnWidths(fallback.columns);
	const fallbackNameWidth = Math.min(MAX_NAME_COL_WIDTH, Math.max(safeWidth - fallbackColumnsWidth, 0));
	return {
		columns: fallback.columns,
		nameWidth: fallbackNameWidth,
		tableWidth: fallbackNameWidth + fallbackColumnsWidth,
		compact: fallback.compact ?? false,
	};
}

// =============================================================================
// Component
// =============================================================================

const TAB_LABELS: Record<TabName, string> = {
	today: "Today",
	thisWeek: "This Week",
	lastWeek: "Last Week",
	last30Days: "Last 30 Days",
	allTime: "All Time",
};

class UsageComponent {
	private activeTab: TabName = "allTime";
	private viewMode: ViewMode = "graph";
	private data: UsageData;
	private selectedIndex = 0;
	private expanded = new Set<string>();
	private providerOrder: string[] = [];
	private theme: Theme;
	private requestRender: () => void;
	private done: () => void;

	// Graph explorer state.
	private graphMetric: GraphMetric = "cost";
	private graphGroupBy: GraphGroupBy = "provider";
	private graphCumulative = true;
	private exportNote: { text: string; ok: boolean } | null = null;
	private graphHidden = new Set<string>();
	private graphLegendIndex = 0;

	constructor(theme: Theme, data: UsageData, requestRender: () => void, done: () => void) {
		this.theme = theme;
		this.requestRender = requestRender;
		this.done = done;
		this.data = data;
		this.updateProviderOrder();
	}

	private updateProviderOrder(): void {
		const stats = this.data[this.activeTab];
		this.providerOrder = Array.from(stats.providers.entries())
			.sort((a, b) => b[1].cost - a[1].cost)
			.map(([name]) => name);
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.providerOrder.length - 1));
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "q")) {
			this.done();
			return;
		}

		if (matchesKey(data, "v")) {
			const idx = VIEW_CYCLE.indexOf(this.viewMode);
			this.viewMode = VIEW_CYCLE[(idx + 1) % VIEW_CYCLE.length]!;
			this.exportNote = null;
			this.requestRender();
			return;
		}

		if (matchesKey(data, "e")) {
			this.exportCurrentView();
			this.requestRender();
			return;
		}

		if (this.viewMode === "graph" && this.handleGraphInput(data)) {
			return;
		}

		if (matchesKey(data, "tab") || matchesKey(data, "right")) {
			const idx = TAB_ORDER.indexOf(this.activeTab);
			this.activeTab = TAB_ORDER[(idx + 1) % TAB_ORDER.length]!;
			this.updateProviderOrder();
			this.exportNote = null;
			this.requestRender();
		} else if (matchesKey(data, "shift+tab") || matchesKey(data, "left")) {
			const idx = TAB_ORDER.indexOf(this.activeTab);
			this.activeTab = TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length]!;
			this.updateProviderOrder();
			this.exportNote = null;
			this.requestRender();
		} else if (this.viewMode === "graph") {
			// Graph-specific keys were handled above; swallow table-only keys.
		} else if (this.viewMode === "table" && matchesKey(data, "up")) {
			if (this.selectedIndex > 0) {
				this.selectedIndex--;
				this.requestRender();
			}
		} else if (this.viewMode === "table" && matchesKey(data, "down")) {
			if (this.selectedIndex < this.providerOrder.length - 1) {
				this.selectedIndex++;
				this.requestRender();
			}
		} else if (this.viewMode === "table" && (matchesKey(data, "enter") || matchesKey(data, "space"))) {
			const provider = this.providerOrder[this.selectedIndex];
			if (provider) {
				if (this.expanded.has(provider)) {
					this.expanded.delete(provider);
				} else {
					this.expanded.add(provider);
				}
				this.requestRender();
			}
		}
	}

	// -------------------------------------------------------------------------
	// Render Methods
	// -------------------------------------------------------------------------

	private handleGraphInput(data: string): boolean {
		if (matchesKey(data, "m")) {
			const idx = METRIC_ORDER.indexOf(this.graphMetric);
			this.graphMetric = METRIC_ORDER[(idx + 1) % METRIC_ORDER.length]!;
		} else if (matchesKey(data, "g")) {
			const idx = GROUP_ORDER.indexOf(this.graphGroupBy);
			this.graphGroupBy = GROUP_ORDER[(idx + 1) % GROUP_ORDER.length]!;
			this.graphHidden.clear();
			this.graphLegendIndex = 0;
		} else if (matchesKey(data, "c")) {
			this.graphCumulative = !this.graphCumulative;
		} else if (matchesKey(data, "a")) {
			this.graphHidden.clear();
		} else if (matchesKey(data, "up")) {
			this.graphLegendIndex = Math.max(0, this.graphLegendIndex - 1);
		} else if (matchesKey(data, "down")) {
			const count = this.buildGraphModelForView().series.length;
			this.graphLegendIndex = Math.min(Math.max(count - 1, 0), this.graphLegendIndex + 1);
		} else if (matchesKey(data, "enter") || matchesKey(data, "space")) {
			const model = this.buildGraphModelForView();
			const target = model.series[this.graphLegendIndex];
			if (target) {
				if (this.graphHidden.has(target.key)) this.graphHidden.delete(target.key);
				else this.graphHidden.add(target.key);
			}
		} else {
			return false;
		}
		this.requestRender();
		return true;
	}

	private exportCurrentView(): void {
		const now = new Date();
		let name: string;
		let content: string;
		const stats = this.data[this.activeTab];
		if (this.viewMode === "graph") {
			const slice = `${this.graphCumulative ? "cumulative" : "per-bucket"}-${this.graphMetric}-by-${this.graphGroupBy}`;
			name = exportFileName("graph", this.activeTab, slice, "csv", now);
			content = buildGraphCsv(this.buildGraphModelForView());
		} else if (this.viewMode === "insights") {
			name = exportFileName("insights", this.activeTab, null, "json", now);
			content = buildInsightsJson(this.activeTab, stats.totals, stats.insights.insights);
		} else {
			name = exportFileName("table", this.activeTab, null, "csv", now);
			content = buildTableCsv(stats.providers, stats.totals);
		}
		try {
			const path = join(process.cwd(), name);
			writeFileSync(path, content);
			this.exportNote = { text: `Saved ${name}`, ok: true };
		} catch (err) {
			this.exportNote = { text: `Export failed: ${err instanceof Error ? err.message : String(err)}`, ok: false };
		}
	}

	private buildGraphModelForView(): GraphModel {
		return buildGraphModel(this.data.hourly, {
			period: this.activeTab,
			metric: this.graphMetric,
			groupBy: this.graphGroupBy,
			cumulative: this.graphCumulative,
			hidden: this.graphHidden,
			bounds: this.data.bounds,
		});
	}

	render(width: number): string[] {
		if (this.viewMode === "graph") {
			return clampLines(
				[...this.renderTitle(width), ...this.renderTabs(width, getTableLayout(width)), ...this.renderGraph(width), ...this.renderHelp(width)],
				width
			);
		}

		if (this.viewMode === "insights") {
			return clampLines(
				[
					...this.renderTitle(width),
					...this.renderTabs(width, getTableLayout(width)),
					...this.renderInsights(width),
					...this.renderHelp(width),
				],
				width
			);
		}

		const layout = getTableLayout(width);
		return clampLines(
			[
				...this.renderTitle(width),
				...this.renderTabs(width, layout),
				...this.renderHeader(layout),
				...this.renderRows(layout),
				...this.renderTotals(layout),
				...this.renderFormulaNote(width),
				...this.renderHelp(width),
			],
			width
		);
	}

	private renderTitle(width: number): string[] {
		const th = this.theme;
		const title = th.fg("accent", th.bold("Usage"));
		// Render the views as a tab strip (like the period tabs) so it is
		// obvious there are multiple views and [v] switches between them.
		const fullStrip = VIEW_CYCLE.map((view) =>
			view === this.viewMode ? th.fg("accent", `[${VIEW_LABELS[view]}]`) : th.fg("dim", ` ${VIEW_LABELS[view]} `)
		).join(" ");
		const activeOnly = th.fg("accent", `[${VIEW_LABELS[this.viewMode]}]`);
		const line = pickFittingText(width, [
			`${title}   ${fullStrip}  ${th.fg("dim", "[v]")}`,
			`${title}   ${activeOnly}  ${th.fg("dim", "[v]")}`,
			`${title} ${activeOnly}`,
		]);
		return [line, ""];
	}

	private renderGraph(width: number): string[] {
		const th = this.theme;
		const model = this.buildGraphModelForView();
		const lines: string[] = [];

		const modeLabel = `${this.graphCumulative ? "Cumulative" : "Per bucket"} ${METRIC_LABELS[this.graphMetric]} · ${GROUP_LABELS[this.graphGroupBy]}`;
		lines.push(th.fg("muted", modeLabel));
		lines.push("");

		if (model.groupedTotal === 0 && model.series.every((s) => s.total === 0)) {
			lines.push(th.fg("dim", "  No usage data for this period"));
			lines.push("");
			return lines;
		}

		const formatValue = this.graphMetric === "cost" ? formatAxisCost : formatAxisCount;
		const spanMs = model.domainEndMs - model.domainStartMs;
		const formatTime = (ms: number): string => {
			const d = new Date(ms);
			if (spanMs <= 26 * 3_600_000) {
				return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			}
			return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
		};

		const chartHeight = 12;
		const chart = renderChart(model, {
			width: Math.max(Math.min(width, 110), 30),
			height: chartHeight,
			formatValue,
			formatTime,
			colorize: (seriesIndex, text) => {
				if (seriesIndex < 0) return th.fg("dim", text);
				return seriesColor(seriesIndex) + text + COLOR_RESET;
			},
		});
		lines.push(...chart);
		lines.push("");

		// Legend with selection cursor and hide/show state.
		for (let i = 0; i < model.series.length; i++) {
			const s = model.series[i]!;
			const cursor = i === this.graphLegendIndex ? th.fg("accent", "▸ ") : "  ";
			const marker = s.hidden ? th.fg("dim", "○") : seriesColor(i) + "●" + COLOR_RESET;
			const value = this.graphMetric === "cost" ? formatAxisCost(s.total) : formatAxisCount(s.total);
			const pct =
				s.key !== TOTAL_SERIES_KEY && model.groupedTotal > 0
					? ` ${th.fg("dim", `${Math.round((s.total / model.groupedTotal) * 100)}%`)}`
					: "";
			const label = s.hidden ? th.fg("dim", s.label) : s.key === TOTAL_SERIES_KEY ? th.bold(s.label) : s.label;
			lines.push(`${cursor}${marker} ${padRight(label, 24)} ${padLeft(value, 8)}${pct}`);
		}
		lines.push("");
		return lines;
	}

	private renderInsights(width: number): string[] {
		const th = this.theme;
		const stats = this.data[this.activeTab];
		const { insights } = stats.insights;
		const hasMessages = stats.totals.messages > 0;
		const hasCost = stats.totals.cost > 0;
		const lines: string[] = [];

		// Cap the content column so advice stays readable on very wide terminals.
		const contentWidth = Math.max(Math.min(width, 100), 40);

		lines.push(th.bold("What's contributing to your cost?"));
		const subtitle = "Approximate, based on local sessions on this machine (these are independent and don't sum to 100%).";
		for (const wrapped of wrapTextWithAnsi(subtitle, contentWidth)) {
			lines.push(th.fg("dim", wrapped));
		}
		lines.push("");

		if (!hasMessages) {
			lines.push(th.fg("dim", "  No usage recorded for this period."));
			lines.push("");
			return lines;
		}
		if (!hasCost) {
			lines.push(th.fg("dim", "  No cost data recorded for this period."));
			lines.push("");
			return lines;
		}
		if (insights.length === 0) {
			lines.push(th.fg("dim", "  Nothing notable for this period."));
			lines.push("");
			return lines;
		}

		// Columns: marker(2) + stat(6) + gap(1); advice aligns under the headline.
		const indent = "         ";
		const adviceWidth = Math.max(contentWidth - indent.length, 30);

		const sectionHeader = (label: string, color: "warning" | "accent"): string => {
			const rule = "─".repeat(Math.max(contentWidth - label.length - 1, 4));
			return `${th.fg(color, th.bold(label))} ${th.fg("border", rule)}`;
		};

		const renderOne = (insight: (typeof insights)[number]): void => {
			const isAlarm = insight.kind === "alarm";
			const marker = isAlarm ? th.fg("warning", "⚠ ") : "  ";
			const statText = padLeft(insight.stat, 6);
			const stat = isAlarm ? th.fg("warning", th.bold(statText)) : th.fg("accent", th.bold(statText));
			// De-emphasise the trailing period-share parenthetical on alarm headlines.
			const match = insight.headline.match(/^(.*?)\s*(\(\d[\d.,]*% of this period\))$/);
			const headline = match ? `${match[1]} ${th.fg("dim", match[2]!)}` : insight.headline;
			lines.push(`${marker}${stat} ${headline}`);
			if (insight.advice) {
				for (const wrapped of wrapTextWithAnsi(insight.advice, adviceWidth)) {
					lines.push(`${indent}${th.fg("dim", wrapped)}`);
				}
			}
			lines.push("");
		};

		const alarms = insights.filter((i) => i.kind === "alarm");
		const structure = insights.filter((i) => i.kind === "structure");
		// Facts first, flagged waste second.
		if (structure.length > 0) {
			lines.push(sectionHeader("Where it went", "accent"));
			for (const insight of structure) renderOne(insight);
		}
		lines.push(sectionHeader("Worth attention", "warning"));
		if (alarms.length > 0) {
			for (const insight of alarms) renderOne(insight);
		} else {
			lines.push(`  ${th.fg("success", padLeft("✓", 6))} ${th.fg("dim", "no waste patterns flagged for this period")}`);
			lines.push("");
		}

		return lines;
	}

	private renderTabs(width: number, layout: TableLayout): string[] {
		const th = this.theme;
		const fullTabs = TAB_ORDER.map((tab) => {
			const label = TAB_LABELS[tab];
			return tab === this.activeTab ? th.fg("accent", `[${label}]`) : th.fg("dim", ` ${label} `);
		}).join("  ");

		const activeTabOnly = th.fg("accent", `[${TAB_LABELS[this.activeTab]}]`);
		const tabLine = pickFittingText(width, [
			fullTabs,
			`${activeTabOnly}  ${th.fg("dim", "[Tab/←→]")}`,
			activeTabOnly,
		]);

		// Compact-note only applies to the table view — it's meaningless for insights.
		const infoLines =
			this.viewMode === "table" && layout.compact
				? wrapTextWithAnsi(th.fg("dim", "Compact view. Widen the terminal for more columns."), Math.max(width, 1))
				: [];

		return [tabLine, ...infoLines, ""];
	}

	private renderHeader(layout: TableLayout): string[] {
		const th = this.theme;

		let headerLine = fitCell("Provider / Model", layout.nameWidth);
		for (const col of layout.columns) {
			const label = fitCell(col.label, col.width, "right");
			headerLine += col.dimmed ? th.fg("dim", label) : label;
		}

		return [th.fg("muted", headerLine), th.fg("border", "─".repeat(layout.tableWidth))];
	}

	private renderDataRow(
		name: string,
		stats: BaseStats & { sessions: Set<string> | number },
		layout: TableLayout,
		options: { indent?: number; selected?: boolean; dimAll?: boolean; prefix?: string } = {}
	): string {
		const th = this.theme;
		const { indent = 0, selected = false, dimAll = false, prefix } = options;

		const rawPrefix = prefix ?? " ".repeat(indent);
		const safePrefix = layout.nameWidth > 0 ? truncateToWidth(rawPrefix, layout.nameWidth, "") : "";
		const prefixWidth = visibleWidth(safePrefix);
		const innerNameWidth = Math.max(layout.nameWidth - prefixWidth, 0);
		const truncName = innerNameWidth > 0 ? truncateToWidth(name, innerNameWidth) : "";
		const styledName = selected ? th.fg("accent", truncName) : dimAll ? th.fg("dim", truncName) : truncName;

		let row = safePrefix + (innerNameWidth > 0 ? padRight(styledName, innerNameWidth) : "");

		for (const col of layout.columns) {
			const value = fitCell(col.getValue(stats), col.width, "right");
			const shouldDim = col.dimmed || dimAll;
			row += shouldDim ? th.fg("dim", value) : value;
		}

		return row;
	}

	private renderRows(layout: TableLayout): string[] {
		const th = this.theme;
		const stats = this.data[this.activeTab];
		const lines: string[] = [];

		if (this.providerOrder.length === 0) {
			lines.push(th.fg("dim", "  No usage data for this period"));
			return lines;
		}

		for (let i = 0; i < this.providerOrder.length; i++) {
			const providerName = this.providerOrder[i]!;
			const providerStats = stats.providers.get(providerName)!;
			const isSelected = i === this.selectedIndex;
			const isExpanded = this.expanded.has(providerName);
			const arrow = isExpanded ? "▾" : "▸";
			const prefix = isSelected ? th.fg("accent", `${arrow} `) : th.fg("dim", `${arrow} `);

			lines.push(
				this.renderDataRow(providerName, providerStats, layout, {
					selected: isSelected,
					prefix,
				})
			);

			if (isExpanded) {
				const models = Array.from(providerStats.models.entries()).sort((a, b) => b[1].cost - a[1].cost);

				for (const [modelName, modelStats] of models) {
					lines.push(this.renderDataRow(modelName, modelStats, layout, { indent: 4, dimAll: true }));
				}
			}
		}

		return lines;
	}

	private renderTotals(layout: TableLayout): string[] {
		const th = this.theme;
		const stats = this.data[this.activeTab];

		let totalRow = fitCell(th.bold("Total"), layout.nameWidth);
		for (const col of layout.columns) {
			const value = fitCell(col.getValue(stats.totals), col.width, "right");
			totalRow += col.dimmed ? th.fg("dim", value) : value;
		}

		return [th.fg("border", "─".repeat(layout.tableWidth)), totalRow, ""];
	}

	private renderFormulaNote(width: number): string[] {
		const line = pickFittingText(width, [
			"Tokens = Input + Output + CacheWrite  ·  ↑In = Input + CacheWrite  (as of 0.2.0)",
			"Tokens = In + Out + CacheWrite  ·  ↑In = In + CacheWrite  (v0.2.0+)",
			"Tokens & ↑In include CacheWrite (v0.2.0+)",
			"Incl. CacheWrite (v0.2.0+)",
		]);
		return [this.theme.fg("dim", line), ""];
	}

	private renderHelp(width: number): string[] {
		const noteLines = this.exportNote
			? [this.theme.fg(this.exportNote.ok ? "success" : "error", `${this.exportNote.ok ? "✓" : "✗"} ${this.exportNote.text}`), ""]
			: [];
		const variants =
			this.viewMode === "graph"
				? [
						"[Tab/←→] period  [m] metric  [g] group  [c] cumulative  [↑↓/Enter] filter  [a] all  [e] export  [v] view  [q] close",
						"[Tab] period  [m] metric  [g] group  [c] cumul  [↑↓/Enter] filter  [e] export  [v] view  [q] close",
						"[m] metric  [g] group  [c] cumul  [↑↓] filter  [q] close",
						"[m] [g] [c] [↑↓] [q]",
						"[q] close",
				  ]
				: this.viewMode === "insights"
				? [
						"[Tab/←→] period  [e] export  [v] view  [q] close",
						"[Tab] period  [e] export  [v] view  [q] close",
						"[v] view  [q] close",
						"[q] close",
				  ]
				: [
						"[Tab/←→] period  [↑↓] select  [Enter] expand  [e] export  [v] view  [q] close",
						"[Tab] period  [↑↓] select  [Enter] expand  [e] export  [v] view  [q] close",
						"[↑↓] select  [Enter] expand  [v] view  [q] close",
						"[↑↓] select  [v] view  [q] close",
						"[↑↓] select  [q] close",
						"[q] close",
				  ];
		const line = pickFittingText(width, variants);
		return [...noteLines, this.theme.fg("dim", line)];
	}

	invalidate(): void {}
	dispose(): void {}
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function (pi: ExtensionAPI) {
	pi.registerCommand("usage", {
		description: "Show usage statistics dashboard",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) {
				return;
			}

			const data = await ctx.ui.custom<UsageData | null>((tui, theme, _kb, done) => {
				const loader = new CancellableLoader(
					tui,
					(s: string) => theme.fg("accent", s),
					(s: string) => theme.fg("muted", s),
					"Loading Usage..."
				);
				let finished = false;
				const finish = (value: UsageData | null) => {
					if (finished) return;
					finished = true;
					loader.dispose();
					done(value);
				};

				loader.onAbort = () => finish(null);

				const onProgress = (p: CollectProgress): void => {
					if (finished || p.filesToParse === 0) return;
					const files = `${p.filesParsed.toLocaleString()}/${p.filesToParse.toLocaleString()} files`;
					if (p.mode === "update") {
						const since = p.sinceMs !== null ? ` since ${formatSinceDate(p.sinceMs)}` : "";
						loader.setMessage(`Updating your usage history${since}… (${files})`);
					} else if (p.mode === "rebuild") {
						loader.setMessage(`Rebuilding your usage history — the cache format changed… (${files})`);
					} else {
						loader.setMessage(`Building your usage history for the first time… (${files})`);
					}
				};

				collectUsageData({ signal: loader.signal, onProgress })
					.then(finish)
					.catch(() => finish(null));

				return loader;
			});

			if (!data) {
				return;
			}

			await ctx.ui.custom<void>((tui, theme, _kb, done) => {
				const container = new Container();

				// Top border
				container.addChild(new Spacer(1));
				container.addChild(new DynamicBorder((s: string) => theme.fg("border", s)));
				container.addChild(new Spacer(1));

				const usage = new UsageComponent(theme, data, () => tui.requestRender(), () => done());

				return {
					render: (w: number) => {
						const borderLines = clampLines(container.render(w), w);
						const usageLines = usage.render(w);
						const bottomBorder = theme.fg("border", "─".repeat(w));
						return clampLines([...borderLines, ...usageLines, "", bottomBorder], w);
					},
					invalidate: () => container.invalidate(),
					handleInput: (input: string) => usage.handleInput(input),
					dispose: () => {},
				};
			});
		},
	});
}
