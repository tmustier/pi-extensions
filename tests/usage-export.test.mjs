import assert from "node:assert/strict";
import test from "node:test";

import {
	buildTableCsv,
	buildGraphCsv,
	buildInsightsJson,
	exportFileName,
	parseExportDirSetting,
	resolveExportDir,
} from "../usage-extension/export.ts";

function stats(cost, messages, tokens = {}) {
	return {
		cost,
		messages,
		tokens: { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...tokens },
	};
}

test("buildTableCsv emits per-model rows sorted by cost plus a TOTAL row", () => {
	const providers = new Map([
		[
			"anthropic",
			{
				...stats(10, 4, { total: 100, input: 60, output: 40 }),
				sessions: new Set(["s1", "s2"]),
				models: new Map([
					["claude-fable-5", { ...stats(8, 3, { total: 80 }), sessions: new Set(["s1", "s2"]) }],
					["claude-opus-4-8", { ...stats(2, 1, { total: 20 }), sessions: new Set(["s1"]) }],
				]),
			},
		],
		[
			"openai-codex",
			{
				...stats(30, 5, { total: 300 }),
				sessions: new Set(["s3"]),
				models: new Map([["gpt-5.6-sol", { ...stats(30, 5, { total: 300 }), sessions: new Set(["s3"]) }]]),
			},
		],
	]);
	const totals = { ...stats(40, 9, { total: 400, cacheRead: 7 }), sessions: 3 };

	const csv = buildTableCsv(providers, totals).trimEnd().split("\n");
	assert.equal(csv[0], "provider,model,sessions,messages,cost_usd,fresh_tokens,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens");
	assert.equal(csv[1], "openai-codex,gpt-5.6-sol,1,5,30,300,0,0,0,0", "highest-cost provider first");
	assert.equal(csv[2], "anthropic,claude-fable-5,2,3,8,80,0,0,0,0");
	assert.equal(csv[3], "anthropic,claude-opus-4-8,1,1,2,20,0,0,0,0");
	assert.equal(csv[4], "TOTAL,,3,9,40,400,0,0,7,0");
});

test("buildTableCsv quotes fields containing commas or quotes", () => {
	const providers = new Map([
		[
			'we,"ird',
			{
				...stats(1, 1),
				sessions: new Set(["s"]),
				models: new Map([["m,1", { ...stats(1, 1), sessions: new Set(["s"]) }]]),
			},
		],
	]);
	const csv = buildTableCsv(providers, { ...stats(1, 1), sessions: 1 });
	assert.match(csv, /^"we,""ird","m,1",/m);
});

test("buildGraphCsv exports visible series as plotted with ISO bucket starts", () => {
	const t0 = Date.UTC(2026, 6, 17, 10);
	const model = {
		series: [
			{ key: "a", label: "anthropic", points: [1, 2, 3], total: 6, hidden: false, firstIdx: 0, lastIdx: 2 },
			{ key: "b", label: "hidden-one", points: [9, 9, 9], total: 27, hidden: true, firstIdx: 0, lastIdx: 2 },
		],
		bucketStarts: [t0, t0 + 3_600_000, t0 + 7_200_000],
		bucketMs: 3_600_000,
		domainStartMs: t0,
		domainEndMs: t0 + 10_800_000,
		yMax: 3,
		groupedTotal: 6,
	};
	const csv = buildGraphCsv(model).trimEnd().split("\n");
	assert.equal(csv[0], "bucket_start,anthropic", "hidden series excluded");
	assert.equal(csv[1], "2026-07-17T10:00:00.000Z,1");
	assert.equal(csv[3], "2026-07-17T12:00:00.000Z,3");
});

test("buildInsightsJson carries period, totals, and insights", () => {
	const json = JSON.parse(
		buildInsightsJson("allTime", { ...stats(42.5, 10), sessions: 4 }, [
			{ kind: "alarm", stat: "$5.00", headline: "spent on x (12% of this period)", advice: "do less x" },
		])
	);
	assert.equal(json.period, "allTime");
	assert.deepEqual(json.totals, { costUsd: 42.5, messages: 10, sessions: 4 });
	assert.equal(json.insights.length, 1);
	assert.equal(json.insights[0].kind, "alarm");
	assert.ok(json.generatedAt.endsWith("Z"));
});

test("exportFileName is stable and slice-aware", () => {
	const now = new Date(2026, 6, 17, 15, 4, 9);
	assert.equal(exportFileName("table", "allTime", null, "csv", now), "usage-table-allTime-20260717-150409.csv");
	assert.equal(
		exportFileName("graph", "today", "cumulative-cost-by-provider", "csv", now),
		"usage-graph-today-cumulative-cost-by-provider-20260717-150409.csv"
	);
});

test("parseExportDirSetting reads the usage-extension key and tolerates junk", () => {
	assert.equal(parseExportDirSetting('{"usage-extension":{"exportDir":"~/Downloads"}}'), "~/Downloads");
	assert.equal(parseExportDirSetting('{"usage-extension":{"exportDir":"  /data/exports "}}'), "/data/exports");
	assert.equal(parseExportDirSetting('{"usage-extension":{"exportDir":""}}'), null);
	assert.equal(parseExportDirSetting('{"usage-extension":{"exportDir":42}}'), null);
	assert.equal(parseExportDirSetting('{"defaultProvider":"openai-codex"}'), null);
	assert.equal(parseExportDirSetting("not json at all"), null);
});

test("resolveExportDir prefers config, expands ~, defaults to /tmp", () => {
	assert.equal(resolveExportDir("/data/exports", "/Users/t", true, "/var/tmp-x"), "/data/exports");
	assert.equal(resolveExportDir("~/Downloads", "/Users/t", true, "/var/tmp-x"), "/Users/t/Downloads");
	assert.equal(resolveExportDir("~", "/Users/t", true, "/var/tmp-x"), "/Users/t");
	assert.equal(resolveExportDir(null, "/Users/t", true, "/var/tmp-x"), "/tmp");
	assert.equal(resolveExportDir(null, "/Users/t", false, "/var/tmp-x"), "/var/tmp-x");
});
