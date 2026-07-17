/**
 * Pure builders for /usage export ([e] key).
 *
 * Each view exports its current slice: the table as per-model CSV rows, the
 * graph as one CSV column per visible series, and insights as structured JSON.
 * Builders are pure string producers so they stay trivially testable; the
 * component owns file naming and disk writes.
 */

import type { Insight, ProviderStats, TotalStats } from "./data.ts";
import type { GraphModel } from "./graph.ts";

/** Quote a CSV field only when it needs it (comma, quote, or newline). */
function csvField(value: string | number): string {
	const s = String(value);
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvLine(fields: (string | number)[]): string {
	return fields.map(csvField).join(",");
}

/** Per-model rows (provider repeated), then a TOTAL row. */
export function buildTableCsv(providers: ReadonlyMap<string, ProviderStats>, totals: TotalStats): string {
	const lines = [
		csvLine([
			"provider",
			"model",
			"sessions",
			"messages",
			"cost_usd",
			"fresh_tokens",
			"input_tokens",
			"output_tokens",
			"cache_read_tokens",
			"cache_write_tokens",
		]),
	];
	const sorted = Array.from(providers.entries()).sort((a, b) => b[1].cost - a[1].cost);
	for (const [providerName, provider] of sorted) {
		const models = Array.from(provider.models.entries()).sort((a, b) => b[1].cost - a[1].cost);
		for (const [modelName, model] of models) {
			lines.push(
				csvLine([
					providerName,
					modelName,
					model.sessions.size,
					model.messages,
					model.cost,
					model.tokens.total,
					model.tokens.input,
					model.tokens.output,
					model.tokens.cacheRead,
					model.tokens.cacheWrite,
				])
			);
		}
	}
	lines.push(
		csvLine([
			"TOTAL",
			"",
			totals.sessions,
			totals.messages,
			totals.cost,
			totals.tokens.total,
			totals.tokens.input,
			totals.tokens.output,
			totals.tokens.cacheRead,
			totals.tokens.cacheWrite,
		])
	);
	return lines.join("\n") + "\n";
}

/**
 * One row per time bucket, one column per visible series, values exactly as
 * plotted (per-bucket or cumulative, current metric).
 */
export function buildGraphCsv(model: GraphModel): string {
	const visible = model.series.filter((s) => !s.hidden);
	const lines = [csvLine(["bucket_start", ...visible.map((s) => s.label)])];
	for (let i = 0; i < model.bucketStarts.length; i++) {
		lines.push(csvLine([new Date(model.bucketStarts[i]!).toISOString(), ...visible.map((s) => s.points[i] ?? 0)]));
	}
	return lines.join("\n") + "\n";
}

/** Structured JSON of the period's insights plus headline totals. */
export function buildInsightsJson(period: string, totals: TotalStats, insights: Insight[]): string {
	return (
		JSON.stringify(
			{
				period,
				generatedAt: new Date().toISOString(),
				totals: { costUsd: totals.cost, messages: totals.messages, sessions: totals.sessions },
				insights: insights.map((i) => ({ kind: i.kind, stat: i.stat, headline: i.headline, advice: i.advice })),
			},
			null,
			"\t"
		) + "\n"
	);
}

/** usage-<view>-<period>[-<slice>]-<stamp>.<ext> in the current directory. */
export function exportFileName(view: string, period: string, slice: string | null, ext: string, now: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	const stamp =
		`${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
		`-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	return ["usage", view, period, ...(slice ? [slice] : []), stamp].join("-") + `.${ext}`;
}
