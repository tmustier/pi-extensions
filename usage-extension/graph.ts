/**
 * Graph explorer model + braille chart rendering for /usage.
 *
 * Everything here is pure and theme-free: series building works off the hourly
 * buckets produced by data.ts, and the renderer emits plain text plus a
 * colorize callback so the UI layer owns all styling. This keeps the module
 * fully unit-testable.
 */

// Explicit .ts extension so plain `node --test` (type stripping) can resolve
// this module too; pi's extension loader accepts it as well.
import type { HourlyCell, HourlyKey, PeriodBounds, TabName } from "./data.ts";
import { splitHourlyKey } from "./data.ts";

// =============================================================================
// Options and model types
// =============================================================================

export type GraphMetric = "cost" | "tokens" | "messages" | "reasoning";
export type GraphGroupBy = "provider" | "model" | "thinking" | "total";

export const METRIC_ORDER: GraphMetric[] = ["cost", "tokens", "messages", "reasoning"];
export const GROUP_ORDER: GraphGroupBy[] = ["provider", "model", "thinking", "total"];

export const METRIC_LABELS: Record<GraphMetric, string> = {
	cost: "cost",
	tokens: "tokens",
	messages: "messages",
	reasoning: "reasoning tokens",
};

export const GROUP_LABELS: Record<GraphGroupBy, string> = {
	provider: "by provider",
	model: "by model",
	thinking: "by thinking level",
	total: "total only",
};

/** Series beyond this cap are merged into a single "other" series. */
export const MAX_GROUP_SERIES = 6;

export const TOTAL_SERIES_KEY = "\u0000total";
export const OTHER_SERIES_KEY = "\u0000other";

export interface GraphOptions {
	period: TabName;
	metric: GraphMetric;
	groupBy: GraphGroupBy;
	cumulative: boolean;
	/** Series keys hidden via the legend. */
	hidden?: ReadonlySet<string>;
	bounds: PeriodBounds;
}

export interface GraphSeries {
	key: string;
	label: string;
	/** One value per bucket. Cumulative when options.cumulative. */
	points: number[];
	/** Period total for this series (not affected by cumulative). */
	total: number;
	hidden: boolean;
	/** First bucket index with activity, or -1 when the series is empty. */
	firstIdx: number;
	/** Last bucket index with activity, or -1 when the series is empty. */
	lastIdx: number;
}

export interface GraphModel {
	series: GraphSeries[];
	/** Bucket start timestamps (ms), ascending. */
	bucketStarts: number[];
	bucketMs: number;
	domainStartMs: number;
	domainEndMs: number;
	/** Max point value across visible series (y-axis scale). */
	yMax: number;
	/** Sum of totals across grouped (non-total) series, for legend percentages. */
	groupedTotal: number;
}

// =============================================================================
// Series building
// =============================================================================

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Periods spanning at most this many hours use hourly buckets; otherwise daily. */
const MAX_HOURLY_BUCKETS = 8 * 24;

function metricOf(cell: HourlyCell, metric: GraphMetric): number {
	switch (metric) {
		case "cost":
			return cell.cost;
		case "tokens":
			// Matches the dashboard formula: fresh tokens = input + output + cacheWrite.
			return cell.input + cell.output + cell.cacheWrite;
		case "messages":
			return cell.messages;
		case "reasoning":
			return cell.reasoning;
	}
}

function groupKeyOf(key: HourlyKey, groupBy: GraphGroupBy): string {
	if (groupBy === "total") return TOTAL_SERIES_KEY;
	const { provider, model, thinkingLevel } = splitHourlyKey(key);
	if (groupBy === "provider") return provider;
	if (groupBy === "model") return model;
	return thinkingLevel === "" ? "unknown" : thinkingLevel;
}

function domainFor(period: TabName, bounds: PeriodBounds, hourly: Map<number, Map<HourlyKey, HourlyCell>>): { startMs: number; endMs: number } {
	switch (period) {
		case "today":
			return { startMs: bounds.todayMs, endMs: bounds.nowMs };
		case "thisWeek":
			return { startMs: bounds.weekStartMs, endMs: bounds.nowMs };
		case "lastWeek":
			return { startMs: bounds.lastWeekStartMs, endMs: bounds.weekStartMs };
		case "last30Days":
			return { startMs: bounds.last30DaysStartMs, endMs: bounds.nowMs };
		case "allTime": {
			let first = Number.POSITIVE_INFINITY;
			for (const hour of hourly.keys()) if (hour < first) first = hour;
			if (!Number.isFinite(first)) first = bounds.todayMs;
			return { startMs: Math.min(first, bounds.nowMs), endMs: bounds.nowMs };
		}
	}
}

/**
 * Build the graph model for one (period, metric, groupBy) view.
 *
 * Buckets are hourly for short periods and daily for long ones. Group series
 * are capped at MAX_GROUP_SERIES by period total; the rest merge into "other".
 * A Total series is always present (first). Hidden series keep their points
 * but are excluded from the y-axis scale.
 */
export function buildGraphModel(
	hourly: Map<number, Map<HourlyKey, HourlyCell>>,
	options: GraphOptions
): GraphModel {
	const { startMs, endMs } = domainFor(options.period, options.bounds, hourly);
	const spanMs = Math.max(endMs - startMs, 1);
	const bucketMs = spanMs / HOUR_MS <= MAX_HOURLY_BUCKETS ? HOUR_MS : DAY_MS;

	// Bucket starts aligned to the domain start so "day" buckets follow the
	// local-midnight period boundaries computed by data.ts (DST shifts move a
	// boundary by an hour, which is invisible at graph resolution).
	const bucketCount = Math.max(1, Math.ceil(spanMs / bucketMs));
	const bucketStarts: number[] = [];
	for (let i = 0; i < bucketCount; i++) bucketStarts.push(startMs + i * bucketMs);

	// Accumulate per-group bucket values.
	const groupValues = new Map<string, number[]>();
	const groupTotals = new Map<string, number>();
	const totalPoints = new Array<number>(bucketCount).fill(0);
	let totalSum = 0;

	for (const [hour, bucket] of hourly) {
		if (hour < startMs || hour >= endMs) continue;
		const idx = Math.min(bucketCount - 1, Math.floor((hour - startMs) / bucketMs));
		for (const [key, cell] of bucket) {
			const value = metricOf(cell, options.metric);
			if (value === 0) continue;
			totalPoints[idx] += value;
			totalSum += value;
			if (options.groupBy !== "total") {
				const groupKey = groupKeyOf(key, options.groupBy);
				let points = groupValues.get(groupKey);
				if (!points) {
					points = new Array<number>(bucketCount).fill(0);
					groupValues.set(groupKey, points);
				}
				points[idx] += value;
				groupTotals.set(groupKey, (groupTotals.get(groupKey) ?? 0) + value);
			}
		}
	}

	// Rank groups and cap at MAX_GROUP_SERIES; merge the tail into "other".
	const ranked = Array.from(groupTotals.entries()).sort((a, b) => b[1] - a[1]);
	const kept = ranked.slice(0, MAX_GROUP_SERIES);
	const merged = ranked.slice(MAX_GROUP_SERIES);

	const hidden = options.hidden ?? new Set<string>();
	const series: GraphSeries[] = [];

	// Active range per series (computed on raw per-bucket values, before any
	// cumulative transform): lines are later drawn only between the first and
	// last bucket with usage, so late-starting or retired series do not drag a
	// flat zero/flat tail across the whole period.
	const activeRange = (points: number[]): { firstIdx: number; lastIdx: number } => {
		let firstIdx = -1;
		let lastIdx = -1;
		for (let i = 0; i < points.length; i++) {
			if (points[i] !== 0) {
				if (firstIdx === -1) firstIdx = i;
				lastIdx = i;
			}
		}
		return { firstIdx, lastIdx };
	};

	series.push({
		key: TOTAL_SERIES_KEY,
		label: "Total",
		points: totalPoints.slice(),
		total: totalSum,
		hidden: hidden.has(TOTAL_SERIES_KEY),
		...activeRange(totalPoints),
	});

	for (const [groupKey, total] of kept) {
		const points = groupValues.get(groupKey)!;
		series.push({
			key: groupKey,
			label: groupKey,
			points,
			total,
			hidden: hidden.has(groupKey),
			...activeRange(points),
		});
	}

	if (merged.length > 0) {
		const points = new Array<number>(bucketCount).fill(0);
		let total = 0;
		for (const [groupKey, groupTotal] of merged) {
			const groupPoints = groupValues.get(groupKey)!;
			for (let i = 0; i < bucketCount; i++) points[i] += groupPoints[i]!;
			total += groupTotal;
		}
		series.push({
			key: OTHER_SERIES_KEY,
			label: `other (${merged.length})`,
			points,
			total,
			hidden: hidden.has(OTHER_SERIES_KEY),
			...activeRange(points),
		});
	}

	if (options.cumulative) {
		for (const s of series) {
			let running = 0;
			s.points = s.points.map((v) => (running += v));
		}
	}

	let yMax = 0;
	for (const s of series) {
		if (s.hidden) continue;
		for (const v of s.points) if (v > yMax) yMax = v;
	}

	return {
		series,
		bucketStarts,
		bucketMs,
		domainStartMs: startMs,
		domainEndMs: endMs,
		yMax,
		groupedTotal: totalSum,
	};
}

// =============================================================================
// Braille chart rendering
// =============================================================================

/**
 * Style callback: seriesIndex is the index into model.series, or -1 for
 * chart furniture (axes). Return the text styled for the terminal.
 */
export type ChartColorize = (seriesIndex: number, text: string) => string;

export interface ChartRenderOptions {
	width: number;
	/** Text rows for the plot area (each row is 4 braille dots tall). */
	height: number;
	formatValue: (value: number) => string;
	formatTime: (ms: number) => string;
	colorize?: ChartColorize;
}

const BRAILLE_BASE = 0x2800;
// Dot bit masks by (x: 0=left, 1=right) and (y: 0=top .. 3=bottom).
const DOT_BITS = [
	[0x01, 0x02, 0x04, 0x40],
	[0x08, 0x10, 0x20, 0x80],
] as const;

/**
 * Render the model as a braille line chart with a y-axis and an x-axis line.
 * Returns exactly height + 1 lines (plot rows + x-axis labels).
 */
export function renderChart(model: GraphModel, options: ChartRenderOptions): string[] {
	const colorize: ChartColorize = options.colorize ?? ((_i, text) => text);
	const plotHeightForLabels = Math.max(options.height, 4);
	const midRowForLabels = Math.floor((plotHeightForLabels - 1) / 2);
	const midValue = (model.yMax * (plotHeightForLabels - 1 - midRowForLabels)) / (plotHeightForLabels - 1);
	const yLabelWidth = Math.max(
		options.formatValue(model.yMax).length,
		options.formatValue(midValue).length,
		options.formatValue(0).length
	);
	const axisWidth = yLabelWidth + 2; // label + " ┤" / " │"
	const plotWidth = Math.max(options.width - axisWidth, 10);
	const plotHeight = Math.max(options.height, 4);
	const dotW = plotWidth * 2;
	const dotH = plotHeight * 4;

	// masks[row][col] per series index — draw order decides which color wins a cell.
	const cellMasks: number[][] = Array.from({ length: plotHeight }, () => new Array<number>(plotWidth).fill(0));
	const cellOwner: number[][] = Array.from({ length: plotHeight }, () => new Array<number>(plotWidth).fill(-1));

	const yMax = model.yMax > 0 ? model.yMax : 1;
	const bucketCount = model.bucketStarts.length;

	const plot = (seriesIndex: number, points: number[], firstIdx: number, lastIdx: number) => {
		if (firstIdx < 0) return;
		let prevX = -1;
		let prevY = -1;
		for (let i = firstIdx; i <= lastIdx; i++) {
			const x = bucketCount === 1 ? dotW - 1 : Math.round((i / (bucketCount - 1)) * (dotW - 1));
			const y = Math.round((1 - (points[i]! / yMax)) * (dotH - 1));
			if (prevX >= 0) {
				// Connect with a vertical-stepped segment for continuity.
				const steps = Math.max(Math.abs(x - prevX), Math.abs(y - prevY), 1);
				for (let s = 1; s <= steps; s++) {
					const ix = Math.round(prevX + ((x - prevX) * s) / steps);
					const iy = Math.round(prevY + ((y - prevY) * s) / steps);
					setDot(ix, iy, seriesIndex);
				}
			} else {
				setDot(x, y, seriesIndex);
			}
			prevX = x;
			prevY = y;
		}
	};

	const setDot = (x: number, y: number, seriesIndex: number) => {
		if (x < 0 || y < 0 || x >= dotW || y >= dotH) return;
		const col = Math.floor(x / 2);
		const row = Math.floor(y / 4);
		cellMasks[row]![col]! |= DOT_BITS[x % 2]![y % 4]!;
		cellOwner[row]![col] = seriesIndex;
	};

	// Draw least-important first so important series own contested cells:
	// other → smallest groups → largest group → total.
	const drawOrder = model.series
		.map((s, i) => ({ s, i }))
		.filter(({ s }) => !s.hidden)
		.sort((a, b) => {
			const rank = (entry: { s: GraphSeries; i: number }) =>
				entry.s.key === TOTAL_SERIES_KEY ? Number.POSITIVE_INFINITY : entry.s.key === OTHER_SERIES_KEY ? -1 : entry.s.total;
			return rank(a) - rank(b);
		});
	for (const { s, i } of drawOrder) plot(i, s.points, s.firstIdx, s.lastIdx);

	// Compose text rows.
	const lines: string[] = [];
	const midRow = Math.floor((plotHeight - 1) / 2);
	for (let row = 0; row < plotHeight; row++) {
		let label = "";
		if (row === 0) label = options.formatValue(model.yMax);
		else if (row === midRow && plotHeight > 2) label = options.formatValue(midValue);
		else if (row === plotHeight - 1) label = options.formatValue(0);
		const axisChar = label ? "┤" : "│";
		let line = colorize(-1, label.padStart(yLabelWidth) + " " + axisChar);
		// Batch consecutive cells with the same owning series into one colorize
		// call to keep ANSI overhead proportional to color changes, not cells.
		let runOwner = -2;
		let runText = "";
		const flush = () => {
			if (!runText) return;
			line += runOwner === -2 ? runText : colorize(runOwner, runText);
			runText = "";
		};
		for (let col = 0; col < plotWidth; col++) {
			const mask = cellMasks[row]![col]!;
			const owner = mask === 0 ? -2 : cellOwner[row]![col]!;
			if (owner !== runOwner) {
				flush();
				runOwner = owner;
			}
			runText += mask === 0 ? " " : String.fromCharCode(BRAILLE_BASE + mask);
		}
		flush();
		lines.push(line);
	}

	// X-axis labels: start, optional middle, end.
	const startLabel = options.formatTime(model.domainStartMs);
	const endLabel = options.formatTime(model.domainEndMs);
	const midLabel = plotWidth >= startLabel.length + endLabel.length + 14 ? options.formatTime(model.domainStartMs + (model.domainEndMs - model.domainStartMs) / 2) : "";
	let axis = " ".repeat(yLabelWidth + 2) + startLabel;
	if (midLabel) {
		const midPos = yLabelWidth + 2 + Math.floor(plotWidth / 2 - midLabel.length / 2);
		axis = axis.padEnd(midPos) + midLabel;
	}
	const endPos = yLabelWidth + 2 + plotWidth - endLabel.length;
	axis = axis.padEnd(Math.max(endPos, axis.length + 1)) + endLabel;
	lines.push(colorize(-1, axis));

	return lines;
}
