import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { collectUsageData, loadUsageCache, parseSessionBuffer, saveUsageCache } from "../usage-extension/data.ts";

// 2026-07-15 is a Wednesday. Week = Mon 13th 00:00 → …, last week = Mon 6th → Sun 12th.
const NOW = new Date(2026, 6, 15, 12, 0, 0);
const TS_TODAY = new Date(2026, 6, 15, 9, 0, 0).getTime();
const TS_THIS_WEEK = new Date(2026, 6, 14, 10, 0, 0).getTime(); // Tuesday this week
const TS_LAST_WEEK = new Date(2026, 6, 10, 10, 0, 0).getTime(); // Friday last week
const TS_OLD = new Date(2026, 5, 1, 10, 0, 0).getTime(); // 1 June — outside the 30-day window
const TS_30D_EDGE_IN = new Date(2026, 5, 16, 0, 0, 0).getTime(); // midnight 29 days before 15 July — first instant inside
const TS_30D_EDGE_OUT = new Date(2026, 5, 15, 23, 59, 59).getTime(); // one second earlier — outside

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "usage-data-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const sessionsDir = join(root, "sessions");
	mkdirSync(sessionsDir, { recursive: true });
	return { root, sessionsDir, cachePath: join(root, "cache.json") };
}

function sessionLine(id, ts) {
	return JSON.stringify({ type: "session", version: 3, id, timestamp: new Date(ts).toISOString(), cwd: "/tmp" });
}

function assistantLine({ ts, provider = "anthropic", model = "claude-fable-5", cost = 1, input = 100, output = 50, cacheRead = 0, cacheWrite = 0 }) {
	return JSON.stringify({
		type: "message",
		id: "m1",
		parentId: null,
		timestamp: new Date(ts).toISOString(),
		message: {
			role: "assistant",
			content: [{ type: "text", text: "hi" }],
			provider,
			model,
			usage: { input, output, cacheRead, cacheWrite, cost: { total: cost } },
			timestamp: ts,
		},
	});
}

function userLine(ts, text = "hello") {
	return JSON.stringify({
		type: "message",
		id: "u1",
		parentId: null,
		timestamp: new Date(ts).toISOString(),
		message: { role: "user", content: [{ type: "text", text }] },
	});
}

// =============================================================================
// parseSessionBuffer
// =============================================================================

test("parseSessionBuffer extracts session id and assistant messages from compact JSONL", async () => {
	const content = [
		sessionLine("s1", TS_TODAY),
		userLine(TS_TODAY),
		assistantLine({ ts: TS_TODAY, cost: 2.5, input: 10, output: 20, cacheRead: 30, cacheWrite: 40 }),
		'{"type":"message","id":"t","message":{"role":"toolResult","content":[{"type":"text","text":"big blob"}]}}',
		"not json at all {{{",
		assistantLine({ ts: TS_TODAY + 1000, cost: 1 }),
	].join("\n");

	const parsed = await parseSessionBuffer(Buffer.from(content, "utf8"));
	assert.equal(parsed.sessionId, "s1");
	assert.equal(parsed.messages.length, 2);
	assert.deepEqual(parsed.messages[0], {
		provider: "anthropic",
		model: "claude-fable-5",
		cost: 2.5,
		input: 10,
		output: 20,
		cacheRead: 30,
		cacheWrite: 40,
		timestamp: TS_TODAY,
	});
});

test("parseSessionBuffer handles Python-style spaced JSON", async () => {
	const content = [
		`{"type": "session", "version": 3, "id": "spaced", "timestamp": "${new Date(TS_TODAY).toISOString()}"}`,
		`{"type": "message", "id": "a", "timestamp": "${new Date(TS_TODAY).toISOString()}", "message": {"role": "assistant", "provider": "openai", "model": "gpt-5.6-sol", "usage": {"input": 5, "output": 6, "cacheRead": 0, "cacheWrite": 0, "cost": {"total": 0.5}}, "timestamp": ${TS_TODAY}}}`,
	].join("\n");

	const parsed = await parseSessionBuffer(Buffer.from(content, "utf8"));
	assert.equal(parsed.sessionId, "spaced");
	assert.equal(parsed.messages.length, 1);
	assert.equal(parsed.messages[0].provider, "openai");
	assert.equal(parsed.messages[0].cost, 0.5);
});

test("parseSessionBuffer ignores pre-filter false positives and messages without usage", async () => {
	const content = [
		sessionLine("s1", TS_TODAY),
		// User message quoting the assistant pattern verbatim — pre-filter hits, JSON gate rejects.
		userLine(TS_TODAY, 'observed "role":"assistant" and "type":"session" in a log'),
		// Assistant message without usage data — excluded.
		'{"type":"message","id":"n","message":{"role":"assistant","provider":"p","model":"m","content":[]}}',
	].join("\n");

	const parsed = await parseSessionBuffer(Buffer.from(content, "utf8"));
	assert.equal(parsed.sessionId, "s1");
	assert.equal(parsed.messages.length, 0);
});

test("parseSessionBuffer falls back to the entry timestamp when the message has none", async () => {
	const iso = new Date(TS_TODAY).toISOString();
	const content = [
		sessionLine("s1", TS_TODAY),
		`{"type":"message","id":"a","timestamp":"${iso}","message":{"role":"assistant","provider":"p","model":"m","usage":{"input":1,"output":1,"cacheRead":0,"cacheWrite":0,"cost":{"total":0.1}}}}`,
	].join("\n");

	const parsed = await parseSessionBuffer(Buffer.from(content, "utf8"));
	assert.equal(parsed.messages[0].timestamp, TS_TODAY);
});

test("parseSessionBuffer returns empty session id when there is no header", async () => {
	const parsed = await parseSessionBuffer(Buffer.from(assistantLine({ ts: TS_TODAY }), "utf8"));
	assert.equal(parsed.sessionId, "");
	assert.equal(parsed.messages.length, 1);
});

// =============================================================================
// collectUsageData — aggregation
// =============================================================================

test("collectUsageData aggregates periods, providers, and dedupes branched history", async (t) => {
	const { sessionsDir, cachePath } = fixture(t);
	mkdirSync(join(sessionsDir, "proj-a"), { recursive: true });

	// File A: one message today, one last week.
	writeFileSync(
		join(sessionsDir, "proj-a", "a.jsonl"),
		[
			sessionLine("s1", TS_LAST_WEEK),
			assistantLine({ ts: TS_LAST_WEEK, cost: 1, input: 100, output: 50 }),
			assistantLine({ ts: TS_TODAY, cost: 2, input: 200, output: 100, cacheWrite: 10 }),
		].join("\n") + "\n"
	);

	// File B: a branched session that copied A's last-week message (same ts + token
	// totals → deduped) plus one unique message earlier this week.
	writeFileSync(
		join(sessionsDir, "proj-a", "b.jsonl"),
		[
			sessionLine("s2", TS_LAST_WEEK),
			assistantLine({ ts: TS_LAST_WEEK, cost: 1, input: 100, output: 50 }),
			assistantLine({ ts: TS_THIS_WEEK, cost: 4, input: 50, output: 25, provider: "openai", model: "gpt-5.6-sol" }),
		].join("\n") + "\n"
	);

	const data = await collectUsageData({ sessionsDir, cachePath, now: NOW });
	assert.ok(data);

	// All time: 3 unique messages (the copy was deduped), 2 session files.
	assert.equal(data.allTime.totals.messages, 3);
	assert.equal(data.allTime.totals.sessions, 2);
	assert.equal(data.allTime.totals.cost, 7);
	// tokens.total = input + output + cacheWrite
	assert.equal(data.allTime.totals.tokens.total, 150 + 310 + 75);

	// Periods.
	assert.equal(data.today.totals.messages, 1);
	assert.equal(data.today.totals.cost, 2);
	assert.equal(data.thisWeek.totals.messages, 2); // today + Tuesday
	assert.equal(data.lastWeek.totals.messages, 1);
	assert.equal(data.lastWeek.totals.cost, 1);
	// All three unique messages fall inside the rolling 30-day window.
	assert.equal(data.last30Days.totals.messages, 3);
	assert.equal(data.last30Days.totals.cost, 7);
	assert.equal(data.last30Days.totals.sessions, 2);

	// Provider breakdown.
	const anthropic = data.allTime.providers.get("anthropic");
	const openai = data.allTime.providers.get("openai");
	assert.equal(anthropic.messages, 2);
	assert.equal(anthropic.cost, 3);
	assert.equal(anthropic.models.get("claude-fable-5").messages, 2);
	assert.equal(openai.messages, 1);
	assert.equal(openai.cost, 4);
});

test("collectUsageData buckets the rolling 30-day window from midnight 29 days back", async (t) => {
	const { sessionsDir, cachePath } = fixture(t);
	writeFileSync(
		join(sessionsDir, "a.jsonl"),
		[
			sessionLine("s1", TS_OLD),
			assistantLine({ ts: TS_30D_EDGE_OUT, cost: 1 }), // outside — allTime only
			assistantLine({ ts: TS_30D_EDGE_IN, cost: 2 }), // first instant inside the window
			assistantLine({ ts: TS_LAST_WEEK, cost: 4 }), // last week is also within 30 days
			assistantLine({ ts: TS_TODAY, cost: 8 }),
		].join("\n") + "\n"
	);

	const data = await collectUsageData({ sessionsDir, cachePath, now: NOW });
	assert.equal(data.allTime.totals.messages, 4);
	assert.equal(data.last30Days.totals.messages, 3);
	assert.equal(data.last30Days.totals.cost, 14);
	assert.equal(data.last30Days.totals.sessions, 1);
	// The 30-day window overlaps but does not replace the week buckets.
	assert.equal(data.lastWeek.totals.cost, 4);
	assert.equal(data.today.totals.cost, 8);
});

test("collectUsageData ignores files without a session header", async (t) => {
	const { sessionsDir, cachePath } = fixture(t);
	writeFileSync(join(sessionsDir, "headerless.jsonl"), assistantLine({ ts: TS_TODAY, cost: 5 }) + "\n");
	writeFileSync(
		join(sessionsDir, "normal.jsonl"),
		[sessionLine("s1", TS_TODAY), assistantLine({ ts: TS_TODAY + 5000, cost: 1 })].join("\n") + "\n"
	);

	const data = await collectUsageData({ sessionsDir, cachePath, now: NOW });
	assert.equal(data.allTime.totals.messages, 1);
	assert.equal(data.allTime.totals.cost, 1);
});

test("collectUsageData returns null when aborted", async (t) => {
	const { sessionsDir, cachePath } = fixture(t);
	writeFileSync(
		join(sessionsDir, "a.jsonl"),
		[sessionLine("s1", TS_TODAY), assistantLine({ ts: TS_TODAY })].join("\n") + "\n"
	);
	const controller = new AbortController();
	controller.abort();
	const data = await collectUsageData({ sessionsDir, cachePath, now: NOW, signal: controller.signal });
	assert.equal(data, null);
});

// =============================================================================
// collectUsageData — caching
// =============================================================================

test("collectUsageData reuses the cache for unchanged files and invalidates on change", async (t) => {
	const { sessionsDir, cachePath } = fixture(t);
	const filePath = join(sessionsDir, "a.jsonl");
	writeFileSync(
		filePath,
		[sessionLine("s1", TS_TODAY), assistantLine({ ts: TS_TODAY, cost: 1 })].join("\n") + "\n"
	);

	const first = await collectUsageData({ sessionsDir, cachePath, now: NOW });
	assert.equal(first.allTime.totals.cost, 1);
	assert.ok(existsSync(cachePath));

	// Poison the cached cost. If the next run serves from cache (no reparse),
	// the poisoned value shows up in the totals.
	const cacheJson = JSON.parse(readFileSync(cachePath, "utf8"));
	cacheJson.files[filePath].messages[0][2] = 999;
	writeFileSync(cachePath, JSON.stringify(cacheJson));

	const second = await collectUsageData({ sessionsDir, cachePath, now: NOW });
	assert.equal(second.allTime.totals.cost, 999, "unchanged file should be served from cache");

	// Appending to the file changes its size → cache entry invalidated → reparse.
	appendFileSync(filePath, assistantLine({ ts: TS_TODAY + 60_000, cost: 2 }) + "\n");
	const third = await collectUsageData({ sessionsDir, cachePath, now: NOW });
	assert.equal(third.allTime.totals.cost, 3, "changed file should be reparsed from disk");
	assert.equal(third.allTime.totals.messages, 2);

	// And the reparse refreshed the cache: poison is gone.
	const refreshed = JSON.parse(readFileSync(cachePath, "utf8"));
	assert.equal(refreshed.files[filePath].messages[0][2], 1);
});

test("collectUsageData evicts cache entries for deleted files", async (t) => {
	const { sessionsDir, cachePath } = fixture(t);
	const keepPath = join(sessionsDir, "keep.jsonl");
	const dropPath = join(sessionsDir, "drop.jsonl");
	writeFileSync(keepPath, [sessionLine("s1", TS_TODAY), assistantLine({ ts: TS_TODAY, cost: 1 })].join("\n") + "\n");
	writeFileSync(
		dropPath,
		[sessionLine("s2", TS_TODAY), assistantLine({ ts: TS_TODAY + 1000, cost: 10 })].join("\n") + "\n"
	);

	const first = await collectUsageData({ sessionsDir, cachePath, now: NOW });
	assert.equal(first.allTime.totals.cost, 11);

	rmSync(dropPath);
	const second = await collectUsageData({ sessionsDir, cachePath, now: NOW });
	assert.equal(second.allTime.totals.cost, 1);

	const cacheJson = JSON.parse(readFileSync(cachePath, "utf8"));
	assert.ok(cacheJson.files[keepPath]);
	assert.equal(cacheJson.files[dropPath], undefined);
});

test("collectUsageData survives a corrupt cache file", async (t) => {
	const { sessionsDir, cachePath } = fixture(t);
	writeFileSync(
		join(sessionsDir, "a.jsonl"),
		[sessionLine("s1", TS_TODAY), assistantLine({ ts: TS_TODAY, cost: 1 })].join("\n") + "\n"
	);
	writeFileSync(cachePath, "definitely not json {");

	const data = await collectUsageData({ sessionsDir, cachePath, now: NOW });
	assert.equal(data.allTime.totals.cost, 1);

	// Cache was rebuilt.
	const cacheJson = JSON.parse(readFileSync(cachePath, "utf8"));
	assert.equal(cacheJson.version, 1);
});

test("collectUsageData works with the cache disabled", async (t) => {
	const { sessionsDir, cachePath } = fixture(t);
	writeFileSync(
		join(sessionsDir, "a.jsonl"),
		[sessionLine("s1", TS_TODAY), assistantLine({ ts: TS_TODAY, cost: 1 })].join("\n") + "\n"
	);
	const data = await collectUsageData({ sessionsDir, cachePath: null, now: NOW });
	assert.equal(data.allTime.totals.cost, 1);
	assert.equal(existsSync(cachePath), false);
});

// =============================================================================
// Cache round-trip
// =============================================================================

test("saveUsageCache/loadUsageCache round-trips file states", async (t) => {
	const { root } = fixture(t);
	const cachePath = join(root, "roundtrip.json");
	const states = new Map([
		[
			"/tmp/a.jsonl",
			{
				size: 123,
				mtimeMs: 456.789,
				parsed: {
					sessionId: "s1",
					messages: [
						{ provider: "anthropic", model: "claude-fable-5", cost: 1.5, input: 10, output: 20, cacheRead: 30, cacheWrite: 40, timestamp: TS_TODAY },
						{ provider: "openai", model: "gpt-5.6-sol", cost: 0.25, input: 1, output: 2, cacheRead: 3, cacheWrite: 4, timestamp: TS_OLD },
					],
				},
			},
		],
		["/tmp/empty.jsonl", { size: 1, mtimeMs: 2, parsed: { sessionId: "", messages: [] } }],
	]);

	await saveUsageCache(cachePath, states);
	const loaded = await loadUsageCache(cachePath);

	assert.equal(loaded.size, 2);
	const a = loaded.get("/tmp/a.jsonl");
	assert.equal(a.size, 123);
	assert.equal(a.mtimeMs, 456.789);
	assert.equal(a.parsed.sessionId, "s1");
	assert.deepEqual(a.parsed.messages, states.get("/tmp/a.jsonl").parsed.messages);
	assert.equal(loaded.get("/tmp/empty.jsonl").parsed.sessionId, "");
});

test("loadUsageCache rejects wrong versions and malformed entries", async (t) => {
	const { root } = fixture(t);
	const cachePath = join(root, "bad.json");

	writeFileSync(cachePath, JSON.stringify({ version: 999, names: [], files: {} }));
	assert.equal((await loadUsageCache(cachePath)).size, 0);

	writeFileSync(
		cachePath,
		JSON.stringify({
			version: 1,
			names: ["p", "m"],
			files: {
				"/ok.jsonl": { size: 1, mtimeMs: 2, sessionId: "s", messages: [[0, 1, 1, 1, 1, 0, 0, TS_TODAY]] },
				"/bad-tuple.jsonl": { size: 1, mtimeMs: 2, sessionId: "s", messages: [[0, 1, 1]] },
				"/bad-name-idx.jsonl": { size: 1, mtimeMs: 2, sessionId: "s", messages: [[7, 1, 1, 1, 1, 0, 0, TS_TODAY]] },
				"/bad-shape.jsonl": { size: "x", mtimeMs: 2, sessionId: "s", messages: [] },
			},
		})
	);
	const loaded = await loadUsageCache(cachePath);
	assert.deepEqual([...loaded.keys()], ["/ok.jsonl"]);
});

test("loadUsageCache returns empty for a missing cache file", async (t) => {
	const { root } = fixture(t);
	assert.equal((await loadUsageCache(join(root, "nope.json"))).size, 0);
});
