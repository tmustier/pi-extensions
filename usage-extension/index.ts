/**
 * /usage - Usage statistics dashboard
 *
 * Shows an inline view with usage stats grouped by provider.
 * - Tab cycles: Today → This Week → All Time
 * - Arrow keys navigate providers
 * - Enter expands/collapses to show models
 */

import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { CancellableLoader, Container, Spacer, matchesKey, visibleWidth, truncateToWidth } from "@mariozechner/pi-tui";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

// =============================================================================
// Types
// =============================================================================

interface TokenStats {
	total: number;
	input: number;
	output: number;
	cache: number;
}

interface BaseStats {
	messages: number;
	cost: number;
	tokens: TokenStats;
}

interface ModelStats extends BaseStats {
	sessions: Set<string>;
}

interface ProviderStats extends BaseStats {
	sessions: Set<string>;
	models: Map<string, ModelStats>;
}

interface TotalStats extends BaseStats {
	sessions: number;
}

interface TimeFilteredStats {
	providers: Map<string, ProviderStats>;
	totals: TotalStats;
}

interface UsageData {
	today: TimeFilteredStats;
	thisWeek: TimeFilteredStats;
	allTime: TimeFilteredStats;
}

type TabName = "today" | "thisWeek" | "allTime";

// =============================================================================
// Column Configuration
// =============================================================================

interface DataColumn {
	label: string;
	width: number;
	dimmed?: boolean;
	getValue: (stats: BaseStats & { sessions: Set<string> | number }) => string;
}

const NAME_COL_WIDTH = 26;

const DATA_COLUMNS: DataColumn[] = [
	{
		label: "Sessions",
		width: 9,
		getValue: (s) => formatNumber(typeof s.sessions === "number" ? s.sessions : s.sessions.size),
	},
	{ label: "Msgs", width: 9, getValue: (s) => formatNumber(s.messages) },
	{ label: "Cost", width: 9, getValue: (s) => formatCost(s.cost) },
	{ label: "Tokens", width: 9, getValue: (s) => formatTokens(s.tokens.total) },
	{ label: "↑In", width: 8, dimmed: true, getValue: (s) => formatTokens(s.tokens.input) },
	{ label: "↓Out", width: 8, dimmed: true, getValue: (s) => formatTokens(s.tokens.output) },
	{ label: "Cache", width: 8, dimmed: true, getValue: (s) => formatTokens(s.tokens.cache) },
];

const TABLE_WIDTH = NAME_COL_WIDTH + DATA_COLUMNS.reduce((sum, col) => sum + col.width, 0);

// =============================================================================
// Data Collection
// =============================================================================

function getSessionsDir(): string {
	// Replicate Pi's logic: respect PI_CODING_AGENT_DIR env var
	const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	return join(agentDir, "sessions");
}

async function getAllSessionFiles(signal?: AbortSignal): Promise<string[]> {
	const sessionsDir = getSessionsDir();
	const files: string[] = [];

	try {
		const cwdDirs = await readdir(sessionsDir, { withFileTypes: true });
		for (const dir of cwdDirs) {
			if (signal?.aborted) return files;
			if (!dir.isDirectory()) continue;
			const cwdPath = join(sessionsDir, dir.name);
			try {
				const sessionFiles = await readdir(cwdPath);
				for (const file of sessionFiles) {
					if (file.endsWith(".jsonl")) {
						files.push(join(cwdPath, file));
					}
				}
			} catch {
				// Skip directories we can't read
			}
		}
	} catch {
		// Return empty if we can't read sessions dir
	}

	return files;
}

interface SessionMessage {
	provider: string;
	model: string;
	cost: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	timestamp: number;
}

async function parseSessionFile(
	filePath: string,
	seenHashes: Set<string>,
	signal?: AbortSignal
): Promise<{ sessionId: string; messages: SessionMessage[] } | null> {
	try {
		const content = await readFile(filePath, "utf8");
		if (signal?.aborted) return null;
		const lines = content.trim().split("\n");
		const messages: SessionMessage[] = [];
		let sessionId = "";

		for (let i = 0; i < lines.length; i++) {
			if (signal?.aborted) return null;
			if (i % 500 === 0) {
				await new Promise<void>((resolve) => setImmediate(resolve));
			}
			const line = lines[i]!;
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line);

				if (entry.type === "session") {
					sessionId = entry.id;
				} else if (entry.type === "message" && entry.message?.role === "assistant") {
					const msg = entry.message;
					if (msg.usage && msg.provider && msg.model) {
						const input = msg.usage.input || 0;
						const output = msg.usage.output || 0;
						const cacheRead = msg.usage.cacheRead || 0;
						const cacheWrite = msg.usage.cacheWrite || 0;
						const fallbackTs = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
						const timestamp = msg.timestamp || (Number.isNaN(fallbackTs) ? 0 : fallbackTs);

						// Deduplicate by timestamp + total tokens (same as ccusage)
						// Session files contain many duplicate entries
						const totalTokens = input + output + cacheRead + cacheWrite;
						const hash = `${timestamp}:${totalTokens}`;
						if (seenHashes.has(hash)) continue;
						seenHashes.add(hash);

						messages.push({
							provider: msg.provider,
							model: msg.model,
							cost: msg.usage.cost?.total || 0,
							input,
							output,
							cacheRead,
							cacheWrite,
							timestamp,
						});
					}
				}
			} catch {
				// Skip malformed lines
			}
		}

		return sessionId ? { sessionId, messages } : null;
	} catch {
		return null;
	}
}

// Helper to accumulate stats into a target
function accumulateStats(
	target: BaseStats,
	cost: number,
	tokens: { total: number; input: number; output: number; cache: number }
): void {
	target.messages++;
	target.cost += cost;
	target.tokens.total += tokens.total;
	target.tokens.input += tokens.input;
	target.tokens.output += tokens.output;
	target.tokens.cache += tokens.cache;
}

function emptyTokens(): TokenStats {
	return { total: 0, input: 0, output: 0, cache: 0 };
}

function emptyModelStats(): ModelStats {
	return { sessions: new Set(), messages: 0, cost: 0, tokens: emptyTokens() };
}

function emptyProviderStats(): ProviderStats {
	return { sessions: new Set(), messages: 0, cost: 0, tokens: emptyTokens(), models: new Map() };
}

function emptyTimeFilteredStats(): TimeFilteredStats {
	return {
		providers: new Map(),
		totals: { sessions: 0, messages: 0, cost: 0, tokens: emptyTokens() },
	};
}

async function collectUsageData(signal?: AbortSignal): Promise<UsageData | null> {
	const startOfToday = new Date();
	startOfToday.setHours(0, 0, 0, 0);
	const todayMs = startOfToday.getTime();

	// Start of current week (Monday 00:00)
	const startOfWeek = new Date();
	const dayOfWeek = startOfWeek.getDay(); // 0 = Sunday, 1 = Monday, ...
	const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
	startOfWeek.setDate(startOfWeek.getDate() - daysSinceMonday);
	startOfWeek.setHours(0, 0, 0, 0);
	const weekStartMs = startOfWeek.getTime();

	const data: UsageData = {
		today: emptyTimeFilteredStats(),
		thisWeek: emptyTimeFilteredStats(),
		allTime: emptyTimeFilteredStats(),
	};

	const sessionFiles = await getAllSessionFiles(signal);
	if (signal?.aborted) return null;
	const seenHashes = new Set<string>(); // Deduplicate across all files

	for (const filePath of sessionFiles) {
		if (signal?.aborted) return null;
		const parsed = await parseSessionFile(filePath, seenHashes, signal);
		if (signal?.aborted) return null;
		if (!parsed) continue;

		const { sessionId, messages } = parsed;
		const sessionContributed = { today: false, thisWeek: false, allTime: false };

		for (const msg of messages) {
			if (signal?.aborted) return null;
			const periods: TabName[] = ["allTime"];
			if (msg.timestamp >= todayMs) periods.push("today");
			if (msg.timestamp >= weekStartMs) periods.push("thisWeek");

			const tokens = {
				// Total = input + output only. cacheRead/cacheWrite are tracked separately.
				// cacheRead tokens were already counted when first sent, so including them
				// would double-count and massively inflate totals (cache hits repeat every message).
				total: msg.input + msg.output,
				input: msg.input,
				output: msg.output,
				cache: msg.cacheRead + msg.cacheWrite,
			};

			for (const period of periods) {
				const stats = data[period];

				// Get or create provider stats
				let providerStats = stats.providers.get(msg.provider);
				if (!providerStats) {
					providerStats = emptyProviderStats();
					stats.providers.set(msg.provider, providerStats);
				}

				// Get or create model stats
				let modelStats = providerStats.models.get(msg.model);
				if (!modelStats) {
					modelStats = emptyModelStats();
					providerStats.models.set(msg.model, modelStats);
				}

				// Accumulate stats at all levels
				modelStats.sessions.add(sessionId);
				accumulateStats(modelStats, msg.cost, tokens);

				providerStats.sessions.add(sessionId);
				accumulateStats(providerStats, msg.cost, tokens);

				accumulateStats(stats.totals, msg.cost, tokens);

				sessionContributed[period] = true;
			}
		}

		// Count unique sessions per period
		if (sessionContributed.today) data.today.totals.sessions++;
		if (sessionContributed.thisWeek) data.thisWeek.totals.sessions++;
		if (sessionContributed.allTime) data.allTime.totals.sessions++;

		await new Promise<void>((resolve) => setImmediate(resolve));
	}

	return data;
}

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

// =============================================================================
// Component
// =============================================================================

const TAB_LABELS: Record<TabName, string> = {
	today: "Today",
	thisWeek: "This Week",
	allTime: "All Time",
};

const TAB_ORDER: TabName[] = ["today", "thisWeek", "allTime"];

class UsageComponent {
	private activeTab: TabName = "allTime";
	private data: UsageData;
	private selectedIndex = 0;
	private expanded = new Set<string>();
	private providerOrder: string[] = [];
	private theme: Theme;
	private requestRender: () => void;
	private done: () => void;

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

		if (matchesKey(data, "tab") || matchesKey(data, "right")) {
			const idx = TAB_ORDER.indexOf(this.activeTab);
			this.activeTab = TAB_ORDER[(idx + 1) % TAB_ORDER.length]!;
			this.updateProviderOrder();
			this.requestRender();
		} else if (matchesKey(data, "shift+tab") || matchesKey(data, "left")) {
			const idx = TAB_ORDER.indexOf(this.activeTab);
			this.activeTab = TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length]!;
			this.updateProviderOrder();
			this.requestRender();
		} else if (matchesKey(data, "up")) {
			if (this.selectedIndex > 0) {
				this.selectedIndex--;
				this.requestRender();
			}
		} else if (matchesKey(data, "down")) {
			if (this.selectedIndex < this.providerOrder.length - 1) {
				this.selectedIndex++;
				this.requestRender();
			}
		} else if (matchesKey(data, "enter") || matchesKey(data, "space")) {
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

	render(_width: number): string[] {
		return [
			...this.renderTitle(),
			...this.renderTabs(),
			...this.renderHeader(),
			...this.renderRows(),
			...this.renderTotals(),
			...this.renderHelp(),
		];
	}

	private renderTitle(): string[] {
		const th = this.theme;
		return [th.fg("accent", th.bold("Usage Statistics")), ""];
	}

	private renderTabs(): string[] {
		const th = this.theme;
		const tabs = TAB_ORDER.map((tab) => {
			const label = TAB_LABELS[tab];
			return tab === this.activeTab ? th.fg("accent", `[${label}]`) : th.fg("dim", ` ${label} `);
		}).join("  ");
		return [tabs, ""];
	}

	private renderHeader(): string[] {
		const th = this.theme;

		let headerLine = padRight("Provider / Model", NAME_COL_WIDTH);
		for (const col of DATA_COLUMNS) {
			const label = padLeft(col.label, col.width);
			headerLine += col.dimmed ? th.fg("dim", label) : label;
		}

		return [th.fg("muted", headerLine), th.fg("border", "─".repeat(TABLE_WIDTH))];
	}

	private renderDataRow(
		name: string,
		stats: BaseStats & { sessions: Set<string> | number },
		options: { indent?: number; selected?: boolean; dimAll?: boolean } = {}
	): string {
		const th = this.theme;
		const { indent = 0, selected = false, dimAll = false } = options;

		const indentStr = " ".repeat(indent);
		const nameWidth = NAME_COL_WIDTH - indent;
		const truncName = truncateToWidth(name, nameWidth - 1);
		const styledName = selected ? th.fg("accent", truncName) : dimAll ? th.fg("dim", truncName) : truncName;

		let row = indentStr + padRight(styledName, nameWidth);

		for (const col of DATA_COLUMNS) {
			const value = col.getValue(stats);
			const shouldDim = col.dimmed || dimAll;
			row += shouldDim ? th.fg("dim", padLeft(value, col.width)) : padLeft(value, col.width);
		}

		return row;
	}

	private renderRows(): string[] {
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

			// Provider row with expand/collapse arrow
			const arrow = isExpanded ? "▾" : "▸";
			const prefix = isSelected ? th.fg("accent", arrow + " ") : th.fg("dim", arrow + " ");
			const dataRow = this.renderDataRow(providerName, providerStats, {
				indent: 2,
				selected: isSelected,
			});
			lines.push(prefix + dataRow.slice(2)); // Replace indent with arrow prefix

			// Model rows (if expanded)
			if (isExpanded) {
				const models = Array.from(providerStats.models.entries()).sort((a, b) => b[1].cost - a[1].cost);

				for (const [modelName, modelStats] of models) {
					lines.push(this.renderDataRow(modelName, modelStats, { indent: 4, dimAll: true }));
				}
			}
		}

		return lines;
	}

	private renderTotals(): string[] {
		const th = this.theme;
		const stats = this.data[this.activeTab];

		let totalRow = padRight(th.bold("Total"), NAME_COL_WIDTH);
		for (const col of DATA_COLUMNS) {
			const value = col.getValue(stats.totals);
			totalRow += col.dimmed ? th.fg("dim", padLeft(value, col.width)) : padLeft(value, col.width);
		}

		return [th.fg("border", "─".repeat(TABLE_WIDTH)), totalRow, ""];
	}

	private renderHelp(): string[] {
		return [this.theme.fg("dim", "[Tab/←→] period  [↑↓] select  [Enter] expand  [q] close")];
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

				collectUsageData(loader.signal)
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
						const borderLines = container.render(w);
						const usageLines = usage.render(w);
						const bottomBorder = theme.fg("border", "─".repeat(w));
						return [...borderLines, ...usageLines, "", bottomBorder];
					},
					invalidate: () => container.invalidate(),
					handleInput: (input: string) => usage.handleInput(input),
					dispose: () => {},
				};
			});
		},
	});
}
