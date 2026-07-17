import assert from "node:assert/strict";
import test from "node:test";

import { makeHourlyKey } from "../usage-extension/data.ts";
import {
	buildGraphModel,
	renderChart,
	MAX_GROUP_SERIES,
	OTHER_SERIES_KEY,
	TOTAL_SERIES_KEY,
} from "../usage-extension/graph.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// A fixed "now": 2026-07-15 12:00 local. Today starts at midnight.
const NOW = new Date(2026, 6, 15, 12, 0, 0).getTime();
const TODAY = new Date(2026, 6, 15, 0, 0, 0).getTime();
const BOUNDS = {
	todayMs: TODAY,
	weekStartMs: new Date(2026, 6, 13, 0, 0, 0).getTime(), // Monday
	lastWeekStartMs: new Date(2026, 6, 6, 0, 0, 0).getTime(),
	last30DaysStartMs: new Date(2026, 5, 16, 0, 0, 0).getTime(),
	nowMs: NOW,
};

function cell({ messages = 1, cost = 0, input = 0, output = 0, cacheRead = 0, cacheWrite = 0, reasoning = 0 } = {}) {
	return { messages, cost, input, output, cacheRead, cacheWrite, reasoning };
}

function hourlyFrom(entries) {
	// entries: [hourMs, provider, model, level, cell]
	const hourly = new Map();
	for (const [hour, provider, model, level, c] of entries) {
		let bucket = hourly.get(hour);
		if (!bucket) hourly.set(hour, (bucket = new Map()));
		bucket.set(makeHourlyKey(provider, model, level), c);
	}
	return hourly;
}

// =============================================================================
// buildGraphModel
// =============================================================================

test("buildGraphModel groups by provider with a Total series first", () => {
	const hourly = hourlyFrom([
		[TODAY + 1 * HOUR, "anthropic", "fable", "xhigh", cell({ cost: 3 })],
		[TODAY + 2 * HOUR, "openai", "sol", "medium", cell({ cost: 5 })],
		[TODAY + 2 * HOUR, "anthropic", "opus", "high", cell({ cost: 1 })],
	]);

	const model = buildGraphModel(hourly, {
		period: "today",
		metric: "cost",
		groupBy: "provider",
		cumulative: false,
		bounds: BOUNDS,
	});

	assert.equal(model.bucketMs, HOUR);
	assert.equal(model.series[0].key, TOTAL_SERIES_KEY);
	assert.deepEqual(
		model.series.map((s) => s.label),
		["Total", "openai", "anthropic"] // ranked by period total
	);
	assert.equal(model.series[0].total, 9);
	assert.equal(model.series[1].total, 5);
	assert.equal(model.series[2].total, 4);
	assert.equal(model.groupedTotal, 9);

	// Bucket 1 (hour 1): anthropic 3; bucket 2: openai 5 + anthropic 1.
	assert.equal(model.series[0].points[1], 3);
	assert.equal(model.series[0].points[2], 9 - 3);
	assert.equal(model.yMax, 6);
});

test("buildGraphModel cumulative points are running sums ending at the period total", () => {
	const hourly = hourlyFrom([
		[TODAY + 1 * HOUR, "a", "m", "", cell({ cost: 1 })],
		[TODAY + 3 * HOUR, "a", "m", "", cell({ cost: 2 })],
		[TODAY + 5 * HOUR, "b", "m", "", cell({ cost: 4 })],
	]);

	const model = buildGraphModel(hourly, {
		period: "today",
		metric: "cost",
		groupBy: "provider",
		cumulative: true,
		bounds: BOUNDS,
	});

	const total = model.series[0];
	// Monotonic non-decreasing, final value = total.
	for (let i = 1; i < total.points.length; i++) {
		assert.ok(total.points[i] >= total.points[i - 1]);
	}
	assert.equal(total.points[total.points.length - 1], 7);
	assert.equal(total.total, 7);
});

test("buildGraphModel groups by thinking level with unknown fallback and by model", () => {
	const hourly = hourlyFrom([
		[TODAY + 1 * HOUR, "a", "m1", "xhigh", cell({ input: 100, output: 20, cacheWrite: 30 })],
		[TODAY + 2 * HOUR, "a", "m2", "", cell({ input: 10, output: 5, cacheWrite: 0 })],
	]);

	const byThinking = buildGraphModel(hourly, {
		period: "today",
		metric: "tokens",
		groupBy: "thinking",
		cumulative: false,
		bounds: BOUNDS,
	});
	assert.deepEqual(
		byThinking.series.map((s) => s.label),
		["Total", "xhigh", "unknown"]
	);
	assert.equal(byThinking.series[1].total, 150); // input + output + cacheWrite
	assert.equal(byThinking.series[2].total, 15);

	const byModel = buildGraphModel(hourly, {
		period: "today",
		metric: "messages",
		groupBy: "model",
		cumulative: false,
		bounds: BOUNDS,
	});
	assert.deepEqual(
		byModel.series.map((s) => s.label).sort(),
		["Total", "m1", "m2"].sort()
	);
});

test("buildGraphModel caps series and merges the tail into other", () => {
	const entries = [];
	for (let i = 0; i < MAX_GROUP_SERIES + 3; i++) {
		entries.push([TODAY + HOUR, `prov${i}`, "m", "", cell({ cost: 100 - i })]);
	}
	const model = buildGraphModel(hourlyFrom(entries), {
		period: "today",
		metric: "cost",
		groupBy: "provider",
		cumulative: false,
		bounds: BOUNDS,
	});

	// Total + capped groups + other
	assert.equal(model.series.length, 1 + MAX_GROUP_SERIES + 1);
	const other = model.series[model.series.length - 1];
	assert.equal(other.key, OTHER_SERIES_KEY);
	assert.equal(other.label, "other (3)");
	// other = sum of the 3 smallest: (100-6)+(100-7)+(100-8)
	assert.equal(other.total, 94 + 93 + 92);
	// Sum of all group series equals the total series.
	const groupSum = model.series.slice(1).reduce((sum, s) => sum + s.total, 0);
	assert.equal(groupSum, model.series[0].total);
});

test("buildGraphModel respects hidden series for y-scale but keeps their points", () => {
	const hourly = hourlyFrom([
		[TODAY + 1 * HOUR, "big", "m", "", cell({ cost: 100 })],
		[TODAY + 2 * HOUR, "small", "m", "", cell({ cost: 5 })],
	]);
	const hidden = new Set([TOTAL_SERIES_KEY, "big"]);
	const model = buildGraphModel(hourly, {
		period: "today",
		metric: "cost",
		groupBy: "provider",
		cumulative: false,
		hidden,
		bounds: BOUNDS,
	});
	assert.equal(model.yMax, 5, "hidden series must not drive the y-axis");
	assert.equal(model.series.find((s) => s.key === "big").hidden, true);
	assert.equal(model.series.find((s) => s.key === "big").total, 100);
});

test("buildGraphModel uses daily buckets and the domain rules per period", () => {
	const hourly = hourlyFrom([
		[BOUNDS.last30DaysStartMs + 2 * HOUR, "a", "m", "", cell({ cost: 1 })],
		[TODAY + HOUR, "a", "m", "", cell({ cost: 2 })],
		// Outside last30Days:
		[BOUNDS.last30DaysStartMs - DAY, "a", "m", "", cell({ cost: 50 })],
	]);

	const m30 = buildGraphModel(hourly, {
		period: "last30Days",
		metric: "cost",
		groupBy: "total",
		cumulative: false,
		bounds: BOUNDS,
	});
	assert.equal(m30.bucketMs, DAY);
	assert.equal(m30.series.length, 1); // total only
	assert.equal(m30.series[0].total, 3, "out-of-window usage must be excluded");
	assert.equal(m30.domainStartMs, BOUNDS.last30DaysStartMs);
	assert.equal(m30.domainEndMs, NOW);

	// lastWeek has a fixed end (this Monday), not now.
	const lw = buildGraphModel(hourly, {
		period: "lastWeek",
		metric: "cost",
		groupBy: "total",
		cumulative: false,
		bounds: BOUNDS,
	});
	assert.equal(lw.domainStartMs, BOUNDS.lastWeekStartMs);
	assert.equal(lw.domainEndMs, BOUNDS.weekStartMs);

	// allTime starts at the first bucket with data.
	const at = buildGraphModel(hourly, {
		period: "allTime",
		metric: "cost",
		groupBy: "total",
		cumulative: false,
		bounds: BOUNDS,
	});
	assert.equal(at.domainStartMs, BOUNDS.last30DaysStartMs - DAY);
	assert.equal(at.series[0].total, 53);
});

test("buildGraphModel reasoning metric sums usage.reasoning", () => {
	const hourly = hourlyFrom([
		[TODAY + HOUR, "a", "m", "high", cell({ reasoning: 42 })],
		[TODAY + 2 * HOUR, "a", "m", "high", cell({ reasoning: 8 })],
	]);
	const model = buildGraphModel(hourly, {
		period: "today",
		metric: "reasoning",
		groupBy: "provider",
		cumulative: true,
		bounds: BOUNDS,
	});
	assert.equal(model.series[0].total, 50);
	assert.equal(model.series[0].points[model.series[0].points.length - 1], 50);
});

// =============================================================================
// renderChart
// =============================================================================

const CHART_OPTS = {
	width: 60,
	height: 8,
	formatValue: (v) => `$${Math.round(v)}`,
	formatTime: (ms) => new Date(ms).toISOString().slice(0, 10),
};

test("renderChart emits height+1 lines within width and draws braille dots", () => {
	const hourly = hourlyFrom([
		[TODAY + 1 * HOUR, "a", "m", "", cell({ cost: 1 })],
		[TODAY + 5 * HOUR, "a", "m", "", cell({ cost: 5 })],
		[TODAY + 9 * HOUR, "b", "m", "", cell({ cost: 3 })],
	]);
	const model = buildGraphModel(hourly, {
		period: "today",
		metric: "cost",
		groupBy: "provider",
		cumulative: true,
		bounds: BOUNDS,
	});

	const lines = renderChart(model, CHART_OPTS);
	assert.equal(lines.length, CHART_OPTS.height + 1);
	for (const line of lines) {
		assert.ok(line.length <= CHART_OPTS.width, `line too long: ${line.length}`);
	}
	const braille = lines.join("").match(/[\u2800-\u28ff]/g) ?? [];
	assert.ok(braille.length > 10, "expected braille line dots");
	// Axis labels present: max at top, $0 at bottom, dates on the axis line.
	assert.ok(lines[0].includes(`$${Math.round(model.yMax)}`));
	assert.ok(lines[CHART_OPTS.height - 1].includes("$0"));
	assert.ok(lines[CHART_OPTS.height].includes("2026-07-15"));
});

test("renderChart routes series text through the colorize callback with the series index", () => {
	const hourly = hourlyFrom([[TODAY + HOUR, "a", "m", "", cell({ cost: 5 })]]);
	const model = buildGraphModel(hourly, {
		period: "today",
		metric: "cost",
		groupBy: "provider",
		cumulative: true,
		bounds: BOUNDS,
	});
	const seen = new Set();
	renderChart(model, {
		...CHART_OPTS,
		colorize: (idx, text) => {
			seen.add(idx);
			return text;
		},
	});
	assert.ok(seen.has(-1), "axis furniture colorized with -1");
	assert.ok(seen.has(0) || seen.has(1), "series cells colorized with their index");
});

test("renderChart hides hidden series from the plot", () => {
	const hourly = hourlyFrom([[TODAY + HOUR, "a", "m", "", cell({ cost: 5 })]]);
	const model = buildGraphModel(hourly, {
		period: "today",
		metric: "cost",
		groupBy: "provider",
		cumulative: true,
		hidden: new Set([TOTAL_SERIES_KEY, "a"]),
		bounds: BOUNDS,
	});
	const lines = renderChart(model, CHART_OPTS);
	const braille = lines.join("").match(/[\u2800-\u28ff]/g) ?? [];
	assert.equal(braille.length, 0, "hidden series must not be drawn");
});

test("buildGraphModel exposes each series' active bucket range", () => {
	const hourly = hourlyFrom([
		[TODAY + 2 * HOUR, "early", "m", "", cell({ cost: 5 })],
		[TODAY + 4 * HOUR, "early", "m", "", cell({ cost: 1 })],
		[TODAY + 8 * HOUR, "late", "m", "", cell({ cost: 3 })],
	]);
	const model = buildGraphModel(hourly, {
		period: "today",
		metric: "cost",
		groupBy: "provider",
		cumulative: true, // ranges must come from raw values, not cumulative ones
		bounds: BOUNDS,
	});
	const byKey = Object.fromEntries(model.series.map((s) => [s.key === TOTAL_SERIES_KEY ? "total" : s.key, s]));
	assert.deepEqual([byKey.total.firstIdx, byKey.total.lastIdx], [2, 8]);
	assert.deepEqual([byKey.early.firstIdx, byKey.early.lastIdx], [2, 4]);
	assert.deepEqual([byKey.late.firstIdx, byKey.late.lastIdx], [8, 8]);
});

test("renderChart clips lines to each series' active range", () => {
	// One series active only in the middle of the day: buckets 5..7 of 12.
	const hourly = hourlyFrom([
		[TODAY + 5 * HOUR, "a", "m", "", cell({ cost: 2 })],
		[TODAY + 7 * HOUR, "a", "m", "", cell({ cost: 4 })],
	]);

	for (const cumulative of [false, true]) {
		const model = buildGraphModel(hourly, {
			period: "today",
			metric: "cost",
			groupBy: "total",
			cumulative,
			bounds: BOUNDS,
		});
		const lines = renderChart(model, CHART_OPTS);
		const plotLines = lines.slice(0, CHART_OPTS.height);
		const axisOffset = plotLines[0].indexOf("\u2524") + 1;
		const plotWidth = Math.max(...plotLines.map((l) => l.length)) - axisOffset;

		// Columns containing any braille dot, relative to the plot area.
		const cols = new Set();
		for (const line of plotLines) {
			for (let i = axisOffset; i < line.length; i++) {
				if (line[i] >= "\u2800" && line[i] <= "\u28ff") cols.add(i - axisOffset);
			}
		}
		assert.ok(cols.size > 0);
		const min = Math.min(...cols);
		const max = Math.max(...cols);
		// Active span is buckets 5..7 of 12 → roughly 45%..64% across the plot.
		// Nothing may be drawn near the left or right edges (cumulative used to
		// drag a flat tail all the way to the right edge).
		assert.ok(min > plotWidth * 0.3, `cumulative=${cumulative}: line starts too early (col ${min}/${plotWidth})`);
		assert.ok(max < plotWidth * 0.8, `cumulative=${cumulative}: line ends too late (col ${max}/${plotWidth})`);
	}
});

test("renderChart draws a single dot for a series active in exactly one bucket", () => {
	const hourly = hourlyFrom([[TODAY + 6 * HOUR, "a", "m", "", cell({ cost: 3 })]]);
	const model = buildGraphModel(hourly, {
		period: "today",
		metric: "cost",
		groupBy: "total",
		cumulative: false,
		bounds: BOUNDS,
	});
	assert.deepEqual([model.series[0].firstIdx, model.series[0].lastIdx], [6, 6]);
	const lines = renderChart(model, CHART_OPTS);
	const braille = lines.join("").match(/[\u2800-\u28ff]/g) ?? [];
	assert.equal(braille.length, 1, "exactly one braille cell for a single active bucket");
});

test("renderChart keeps the y-axis aligned when the mid label is the widest", () => {
	// yMax 113 → labels "$113", "$61.6...", "$0" — the mid label used to overflow
	// the axis column and shift its row by one character.
	const hourly = hourlyFrom([[TODAY + HOUR, "a", "m", "", cell({ cost: 113 })]]);
	const model = buildGraphModel(hourly, {
		period: "today",
		metric: "cost",
		groupBy: "total",
		cumulative: true,
		bounds: BOUNDS,
	});
	const lines = renderChart(model, {
		...CHART_OPTS,
		height: 12,
		formatValue: (v) => (v === 0 ? "$0" : v < 100 ? `$${v.toFixed(1)}` : `$${Math.round(v)}`),
	});
	const axisCols = new Set(lines.slice(0, 12).map((l) => Math.max(l.indexOf("\u2524"), l.indexOf("\u2502"))));
	assert.equal(axisCols.size, 1, `axis column must align: ${[...axisCols]}`);
});

test("renderChart handles an empty model without throwing", () => {
	const model = buildGraphModel(new Map(), {
		period: "today",
		metric: "cost",
		groupBy: "provider",
		cumulative: true,
		bounds: BOUNDS,
	});
	const lines = renderChart(model, CHART_OPTS);
	assert.equal(lines.length, CHART_OPTS.height + 1);
});
