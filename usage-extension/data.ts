/**
 * Data collection, caching, and insights for the /usage dashboard.
 *
 * Performance model (see CHANGELOG 0.4.0):
 * - Session JSONL files are scanned at the buffer level. Only lines that can
 *   possibly be a session header or an assistant message are UTF-8 decoded and
 *   JSON.parsed — the multi-megabyte tool-result lines that dominate session
 *   files are skipped with a cheap byte search.
 * - Per-file extraction results are persisted to an on-disk cache keyed by
 *   (size, mtimeMs). Session files are append-only, so a warm load only
 *   re-parses files that changed since the last run.
 */

import { readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// =============================================================================
// Types
// =============================================================================

export interface TokenStats {
	total: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

export interface BaseStats {
	messages: number;
	cost: number;
	tokens: TokenStats;
}

export interface ModelStats extends BaseStats {
	sessions: Set<string>;
}

export interface ProviderStats extends BaseStats {
	sessions: Set<string>;
	models: Map<string, ModelStats>;
}

export interface TotalStats extends BaseStats {
	sessions: number;
}

export interface Insight {
	percent: number; // 0-100
	headline: string;
	advice: string;
}

export interface PeriodInsights {
	insights: Insight[];
}

interface RawMessage {
	sessionId: string;
	timestamp: number;
	cost: number;
	input: number;
	cacheRead: number;
	cacheWrite: number;
}

interface PeriodRawData {
	messages: RawMessage[];
	sessionCosts: Map<string, number>;
}

interface GlobalSessionSpan {
	startMs: number;
	endMs: number;
}

export interface TimeFilteredStats {
	providers: Map<string, ProviderStats>;
	totals: TotalStats;
	insights: PeriodInsights;
}

/**
 * One (provider, model, thinkingLevel) cell inside an hourly bucket.
 * Powers the graph explorer; built post-dedupe so it matches table totals.
 */
export interface HourlyCell {
	messages: number;
	cost: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	reasoning: number;
}

/** Composite key: `${provider}\u0000${model}\u0000${thinkingLevel}` */
export type HourlyKey = string;

export const HOURLY_KEY_SEP = "\u0000";

export function makeHourlyKey(provider: string, model: string, thinkingLevel: string): HourlyKey {
	return provider + HOURLY_KEY_SEP + model + HOURLY_KEY_SEP + thinkingLevel;
}

export function splitHourlyKey(key: HourlyKey): { provider: string; model: string; thinkingLevel: string } {
	const [provider = "", model = "", thinkingLevel = ""] = key.split(HOURLY_KEY_SEP);
	return { provider, model, thinkingLevel };
}

export interface PeriodBounds {
	todayMs: number;
	weekStartMs: number;
	lastWeekStartMs: number;
	last30DaysStartMs: number;
	nowMs: number;
}

export interface UsageData {
	today: TimeFilteredStats;
	thisWeek: TimeFilteredStats;
	lastWeek: TimeFilteredStats;
	last30Days: TimeFilteredStats;
	allTime: TimeFilteredStats;
	/** Deduped usage bucketed by hour start (ms) → series key → metrics. */
	hourly: Map<number, Map<HourlyKey, HourlyCell>>;
	bounds: PeriodBounds;
}

export type TabName = "today" | "thisWeek" | "lastWeek" | "last30Days" | "allTime";

export const TAB_ORDER: TabName[] = ["today", "thisWeek", "lastWeek", "last30Days", "allTime"];

export interface SessionMessage {
	provider: string;
	model: string;
	/** Thinking level active when the message was produced; "" when unknown. */
	thinkingLevel: string;
	cost: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** Reasoning output tokens reported by the provider (0 when absent). */
	reasoning: number;
	timestamp: number;
}

export interface ParsedSessionFile {
	/** Empty string when the file has no session header — such files are ignored. */
	sessionId: string;
	/** Extracted assistant messages, pre-dedupe. Dedupe happens at aggregation. */
	messages: SessionMessage[];
}

// =============================================================================
// Paths
// =============================================================================

function getAgentDir(): string {
	// Replicate Pi's logic: respect PI_CODING_AGENT_DIR env var
	return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

export function getSessionsDir(): string {
	return join(getAgentDir(), "sessions");
}

export function getDefaultCachePath(): string {
	return join(getAgentDir(), "usage-extension-cache.json");
}

// =============================================================================
// Session file discovery
// =============================================================================

async function collectSessionFilesRecursively(dir: string, files: string[], signal?: AbortSignal): Promise<void> {
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (signal?.aborted) return;
			const entryPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				await collectSessionFilesRecursively(entryPath, files, signal);
			} else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
				files.push(entryPath);
			}
		}
	} catch {
		// Skip directories we can't read
	}
}

async function getAllSessionFiles(sessionsDir: string, signal?: AbortSignal): Promise<string[]> {
	const files: string[] = [];
	await collectSessionFilesRecursively(sessionsDir, files, signal);
	files.sort();
	return files;
}

// =============================================================================
// Session file parsing
// =============================================================================

const NEWLINE = 0x0a;

// Relevance patterns for the buffer-level pre-filter. Pi writes compact JSON
// (`"role":"assistant"`), but imported/third-party session files have been seen
// with Python-style spaced JSON (`"role": "assistant"`), so both are matched.
// False positives (e.g. a tool result quoting one of these strings verbatim)
// only cost a wasted JSON.parse — the parsed entry is still shape-checked.
const PATTERN_ASSISTANT_COMPACT = Buffer.from('"role":"assistant"');
const PATTERN_ASSISTANT_SPACED = Buffer.from('"role": "assistant"');
const PATTERN_SESSION_COMPACT = Buffer.from('"type":"session"');
const PATTERN_SESSION_SPACED = Buffer.from('"type": "session"');
const PATTERN_THINKING_COMPACT = Buffer.from('"type":"thinking_level_change"');
const PATTERN_THINKING_SPACED = Buffer.from('"type": "thinking_level_change"');

const PARSE_YIELD_EVERY_LINES = 2000;

function lineMightBeRelevant(line: Buffer): boolean {
	return (
		line.includes(PATTERN_ASSISTANT_COMPACT) ||
		line.includes(PATTERN_SESSION_COMPACT) ||
		line.includes(PATTERN_THINKING_COMPACT) ||
		line.includes(PATTERN_ASSISTANT_SPACED) ||
		line.includes(PATTERN_SESSION_SPACED) ||
		line.includes(PATTERN_THINKING_SPACED)
	);
}

/**
 * Extract the session id and assistant messages from a session JSONL buffer.
 * Returns partial results when aborted — callers must check `signal.aborted`
 * before caching or using the result.
 */
export async function parseSessionBuffer(buffer: Buffer, signal?: AbortSignal): Promise<ParsedSessionFile> {
	const messages: SessionMessage[] = [];
	let sessionId = "";
	// Assistant messages don't carry the thinking level; pi records it as separate
	// thinking_level_change entries, always written before the first assistant
	// message of a session. Replaying them in append order attributes each message
	// to the level active when it was produced.
	let thinkingLevel = "";
	let start = 0;
	let lineNumber = 0;

	while (start < buffer.length) {
		let end = buffer.indexOf(NEWLINE, start);
		if (end === -1) end = buffer.length;

		lineNumber++;
		if (lineNumber % PARSE_YIELD_EVERY_LINES === 0) {
			await new Promise<void>((resolve) => setImmediate(resolve));
			if (signal?.aborted) return { sessionId, messages };
		}

		if (end > start && lineMightBeRelevant(buffer.subarray(start, end))) {
			try {
				const entry = JSON.parse(buffer.toString("utf8", start, end));

				if (entry.type === "session") {
					sessionId = entry.id;
				} else if (entry.type === "thinking_level_change") {
					if (typeof entry.thinkingLevel === "string") thinkingLevel = entry.thinkingLevel;
				} else if (entry.type === "message" && entry.message?.role === "assistant") {
					const msg = entry.message;
					if (msg.usage && msg.provider && msg.model) {
						const fallbackTs = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
						messages.push({
							provider: msg.provider,
							model: msg.model,
							thinkingLevel,
							cost: msg.usage.cost?.total || 0,
							input: msg.usage.input || 0,
							output: msg.usage.output || 0,
							cacheRead: msg.usage.cacheRead || 0,
							cacheWrite: msg.usage.cacheWrite || 0,
							reasoning: msg.usage.reasoning || 0,
							timestamp: msg.timestamp || (Number.isNaN(fallbackTs) ? 0 : fallbackTs),
						});
					}
				}
			} catch {
				// Skip malformed lines
			}
		}

		start = end + 1;
	}

	return { sessionId, messages };
}

// =============================================================================
// On-disk cache
// =============================================================================

const CACHE_VERSION = 2;

type CachedMessageTuple = [
	providerIdx: number,
	modelIdx: number,
	cost: number,
	input: number,
	output: number,
	cacheRead: number,
	cacheWrite: number,
	timestamp: number,
	thinkingLevelIdx: number,
	reasoning: number,
];

interface CacheFileEntry {
	size: number;
	mtimeMs: number;
	sessionId: string;
	messages: CachedMessageTuple[];
}

export interface CachedFileState {
	size: number;
	mtimeMs: number;
	parsed: ParsedSessionFile;
}

export async function loadUsageCache(cachePath: string): Promise<Map<string, CachedFileState>> {
	const result = new Map<string, CachedFileState>();
	let raw: { version?: unknown; names?: unknown; files?: unknown };
	try {
		raw = JSON.parse(await readFile(cachePath, "utf8"));
	} catch {
		return result; // Missing or corrupt cache — rebuild from scratch.
	}
	if (!raw || raw.version !== CACHE_VERSION || !Array.isArray(raw.names) || typeof raw.files !== "object" || raw.files === null) {
		return result;
	}

	const names = raw.names as unknown[];
	for (const [filePath, entry] of Object.entries(raw.files as Record<string, CacheFileEntry>)) {
		if (
			!entry ||
			typeof entry.size !== "number" ||
			typeof entry.mtimeMs !== "number" ||
			typeof entry.sessionId !== "string" ||
			!Array.isArray(entry.messages)
		) {
			continue;
		}
		const messages: SessionMessage[] = [];
		let valid = true;
		for (const tuple of entry.messages) {
			if (!Array.isArray(tuple) || tuple.length !== 10) {
				valid = false;
				break;
			}
			const provider = names[tuple[0]];
			const model = names[tuple[1]];
			const thinkingLevel = names[tuple[8]];
			if (typeof provider !== "string" || typeof model !== "string" || typeof thinkingLevel !== "string") {
				valid = false;
				break;
			}
			messages.push({
				provider,
				model,
				thinkingLevel,
				cost: Number(tuple[2]) || 0,
				input: Number(tuple[3]) || 0,
				output: Number(tuple[4]) || 0,
				cacheRead: Number(tuple[5]) || 0,
				cacheWrite: Number(tuple[6]) || 0,
				timestamp: Number(tuple[7]) || 0,
				reasoning: Number(tuple[9]) || 0,
			});
		}
		if (!valid) continue;
		result.set(filePath, {
			size: entry.size,
			mtimeMs: entry.mtimeMs,
			parsed: { sessionId: entry.sessionId, messages },
		});
	}
	return result;
}

export async function saveUsageCache(cachePath: string, states: Map<string, CachedFileState>): Promise<void> {
	const names: string[] = [];
	const nameIndex = new Map<string, number>();
	const intern = (name: string): number => {
		let idx = nameIndex.get(name);
		if (idx === undefined) {
			idx = names.length;
			names.push(name);
			nameIndex.set(name, idx);
		}
		return idx;
	};

	const files: Record<string, CacheFileEntry> = {};
	for (const [filePath, state] of states) {
		files[filePath] = {
			size: state.size,
			mtimeMs: state.mtimeMs,
			sessionId: state.parsed.sessionId,
			messages: state.parsed.messages.map((m): CachedMessageTuple => [
				intern(m.provider),
				intern(m.model),
				m.cost,
				m.input,
				m.output,
				m.cacheRead,
				m.cacheWrite,
				m.timestamp,
				intern(m.thinkingLevel),
				m.reasoning,
			]),
		};
	}

	const payload = JSON.stringify({ version: CACHE_VERSION, names, files });
	// Atomic-ish write: concurrent /usage runs race to a last-writer-wins rename
	// instead of interleaving partial writes.
	const tmpPath = join(dirname(cachePath), `.usage-cache-${process.pid}-${Date.now()}.tmp`);
	await writeFile(tmpPath, payload, "utf8");
	await rename(tmpPath, cachePath);
}

// =============================================================================
// Aggregation
// =============================================================================

function emptyTokens(): TokenStats {
	return { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
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
		insights: { insights: [] },
	};
}

function emptyPeriodRawData(): PeriodRawData {
	return { messages: [], sessionCosts: new Map() };
}

function emptyUsageData(bounds: PeriodBounds): UsageData {
	return {
		today: emptyTimeFilteredStats(),
		thisWeek: emptyTimeFilteredStats(),
		lastWeek: emptyTimeFilteredStats(),
		last30Days: emptyTimeFilteredStats(),
		allTime: emptyTimeFilteredStats(),
		hourly: new Map(),
		bounds,
	};
}

const HOUR_MS = 3_600_000;

function addToHourlyBuckets(hourly: Map<number, Map<HourlyKey, HourlyCell>>, msg: SessionMessage): void {
	if (msg.timestamp <= 0) return; // Unknown time can't be placed on a time axis.
	const hour = Math.floor(msg.timestamp / HOUR_MS) * HOUR_MS;
	let bucket = hourly.get(hour);
	if (!bucket) {
		bucket = new Map();
		hourly.set(hour, bucket);
	}
	const key = makeHourlyKey(msg.provider, msg.model, msg.thinkingLevel);
	let cell = bucket.get(key);
	if (!cell) {
		cell = { messages: 0, cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
		bucket.set(key, cell);
	}
	cell.messages++;
	cell.cost += msg.cost;
	cell.input += msg.input;
	cell.output += msg.output;
	cell.cacheRead += msg.cacheRead;
	cell.cacheWrite += msg.cacheWrite;
	cell.reasoning += msg.reasoning;
}

// Helper to accumulate stats into a target
function accumulateStats(
	target: BaseStats,
	cost: number,
	tokens: { total: number; input: number; output: number; cacheRead: number; cacheWrite: number }
): void {
	target.messages++;
	target.cost += cost;
	target.tokens.total += tokens.total;
	target.tokens.input += tokens.input;
	target.tokens.output += tokens.output;
	target.tokens.cacheRead += tokens.cacheRead;
	target.tokens.cacheWrite += tokens.cacheWrite;
}

function getPeriodsForTimestamp(
	timestamp: number,
	todayMs: number,
	weekStartMs: number,
	lastWeekStartMs: number,
	last30DaysStartMs: number
): TabName[] {
	const periods: TabName[] = ["allTime"];
	if (timestamp >= todayMs) periods.push("today");
	if (timestamp >= weekStartMs) {
		periods.push("thisWeek");
	} else if (timestamp >= lastWeekStartMs) {
		periods.push("lastWeek");
	}
	if (timestamp >= last30DaysStartMs) periods.push("last30Days");
	return periods;
}

function addMessagesToUsageData(
	data: UsageData,
	sessionId: string,
	messages: SessionMessage[],
	todayMs: number,
	weekStartMs: number,
	lastWeekStartMs: number,
	last30DaysStartMs: number,
	rawByPeriod: Record<TabName, PeriodRawData>,
	globalSessionSpans: Map<string, GlobalSessionSpan>
): void {
	const sessionContributed = { today: false, thisWeek: false, lastWeek: false, last30Days: false, allTime: false };

	for (const msg of messages) {
		// Track real per-session lifetime across every message we see, regardless of
		// which period the message falls into. Used later for the "8h+ session" insight.
		if (msg.timestamp > 0) {
			const span = globalSessionSpans.get(sessionId);
			if (!span) {
				globalSessionSpans.set(sessionId, { startMs: msg.timestamp, endMs: msg.timestamp });
			} else {
				if (msg.timestamp < span.startMs) span.startMs = msg.timestamp;
				if (msg.timestamp > span.endMs) span.endMs = msg.timestamp;
			}
		}

		addToHourlyBuckets(data.hourly, msg);

		const periods = getPeriodsForTimestamp(msg.timestamp, todayMs, weekStartMs, lastWeekStartMs, last30DaysStartMs);
		const tokens = {
			// Count fresh tokens processed this turn.
			// Include cacheWrite because those prompt tokens were newly written and billed.
			// Exclude cacheRead because repeated cache hits would otherwise dominate totals.
			total: msg.input + msg.output + msg.cacheWrite,
			input: msg.input,
			output: msg.output,
			cacheRead: msg.cacheRead,
			cacheWrite: msg.cacheWrite,
		};

		for (const period of periods) {
			const stats = data[period];

			let providerStats = stats.providers.get(msg.provider);
			if (!providerStats) {
				providerStats = emptyProviderStats();
				stats.providers.set(msg.provider, providerStats);
			}

			let modelStats = providerStats.models.get(msg.model);
			if (!modelStats) {
				modelStats = emptyModelStats();
				providerStats.models.set(msg.model, modelStats);
			}

			modelStats.sessions.add(sessionId);
			accumulateStats(modelStats, msg.cost, tokens);

			providerStats.sessions.add(sessionId);
			accumulateStats(providerStats, msg.cost, tokens);

			accumulateStats(stats.totals, msg.cost, tokens);
			sessionContributed[period] = true;

			const raw = rawByPeriod[period];
			raw.messages.push({
				sessionId,
				timestamp: msg.timestamp,
				cost: msg.cost,
				input: msg.input,
				cacheRead: msg.cacheRead,
				cacheWrite: msg.cacheWrite,
			});
			raw.sessionCosts.set(sessionId, (raw.sessionCosts.get(sessionId) ?? 0) + msg.cost);
		}
	}

	if (sessionContributed.today) data.today.totals.sessions++;
	if (sessionContributed.thisWeek) data.thisWeek.totals.sessions++;
	if (sessionContributed.lastWeek) data.lastWeek.totals.sessions++;
	if (sessionContributed.last30Days) data.last30Days.totals.sessions++;
	if (sessionContributed.allTime) data.allTime.totals.sessions++;
}

// =============================================================================
// Collection orchestration
// =============================================================================

const STAT_CONCURRENCY = 16;
const DEFAULT_PARSE_CONCURRENCY = 4;
const AGGREGATE_YIELD_EVERY_FILES = 200;

export interface CollectUsageOptions {
	signal?: AbortSignal;
	/** Defaults to `<agentDir>/sessions`. */
	sessionsDir?: string;
	/** Defaults to `<agentDir>/usage-extension-cache.json`. Pass `null` to disable the on-disk cache. */
	cachePath?: string | null;
	/** Reference time for period bucketing. Defaults to `new Date()`. */
	now?: Date;
	parseConcurrency?: number;
}

export async function collectUsageData(options: CollectUsageOptions = {}): Promise<UsageData | null> {
	const signal = options.signal;
	const now = options.now ?? new Date();
	const sessionsDir = options.sessionsDir ?? getSessionsDir();
	const cachePath = options.cachePath === undefined ? getDefaultCachePath() : options.cachePath;
	const parseConcurrency = Math.max(1, options.parseConcurrency ?? DEFAULT_PARSE_CONCURRENCY);

	const startOfToday = new Date(now);
	startOfToday.setHours(0, 0, 0, 0);
	const todayMs = startOfToday.getTime();

	// Start of current week (Monday 00:00)
	const startOfWeek = new Date(now);
	const dayOfWeek = startOfWeek.getDay(); // 0 = Sunday, 1 = Monday, ...
	const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
	startOfWeek.setDate(startOfWeek.getDate() - daysSinceMonday);
	startOfWeek.setHours(0, 0, 0, 0);
	const weekStartMs = startOfWeek.getTime();

	// Start of last week (previous Monday 00:00)
	const startOfLastWeek = new Date(startOfWeek);
	startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);
	const lastWeekStartMs = startOfLastWeek.getTime();

	// Rolling 30-day window: the last 30 calendar days including today,
	// i.e. from midnight 29 days before today. setDate handles DST correctly.
	const startOfLast30Days = new Date(startOfToday);
	startOfLast30Days.setDate(startOfLast30Days.getDate() - 29);
	const last30DaysStartMs = startOfLast30Days.getTime();

	// 1. Discover session files.
	const filePaths = await getAllSessionFiles(sessionsDir, signal);
	if (signal?.aborted) return null;

	// 2. Stat them (batched) so cache freshness can be checked without reading contents.
	const fileStats = new Map<string, { size: number; mtimeMs: number }>();
	{
		let next = 0;
		await Promise.all(
			Array.from({ length: STAT_CONCURRENCY }, async () => {
				while (next < filePaths.length) {
					if (signal?.aborted) return;
					const filePath = filePaths[next++]!;
					try {
						const st = await stat(filePath);
						fileStats.set(filePath, { size: st.size, mtimeMs: st.mtimeMs });
					} catch {
						// File vanished between listing and stat — skip it.
					}
				}
			})
		);
	}
	if (signal?.aborted) return null;

	// 3. Load the cache and decide which files actually need parsing.
	const previous = cachePath ? await loadUsageCache(cachePath) : new Map<string, CachedFileState>();
	if (signal?.aborted) return null;
	const current = new Map<string, CachedFileState>();
	const toParse: string[] = [];
	for (const filePath of filePaths) {
		const st = fileStats.get(filePath);
		if (!st) continue;
		const cached = previous.get(filePath);
		if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) {
			current.set(filePath, cached);
		} else {
			toParse.push(filePath);
		}
	}
	let dirty = toParse.length > 0;
	if (!dirty) {
		for (const filePath of previous.keys()) {
			if (!fileStats.has(filePath)) {
				dirty = true; // A cached file was deleted — evict it by rewriting.
				break;
			}
		}
	}

	// 4. Parse new/changed files with bounded concurrency.
	{
		let next = 0;
		await Promise.all(
			Array.from({ length: parseConcurrency }, async () => {
				while (next < toParse.length) {
					if (signal?.aborted) return;
					const filePath = toParse[next++]!;
					const st = fileStats.get(filePath)!;
					let buffer: Buffer;
					try {
						buffer = await readFile(filePath);
					} catch {
						continue; // File vanished — skip it.
					}
					const parsed = await parseSessionBuffer(buffer, signal);
					if (signal?.aborted) return; // Never cache a partial parse.
					current.set(filePath, { size: st.size, mtimeMs: st.mtimeMs, parsed });
				}
			})
		);
	}

	if (signal?.aborted) {
		// Best effort: persist whatever finished so a cancelled cold build makes
		// the next attempt cheaper. Keep old entries for files not processed yet —
		// they are re-validated against size/mtime next run anyway.
		if (cachePath && dirty && current.size > 0) {
			const merged = new Map(previous);
			for (const [filePath, state] of current) merged.set(filePath, state);
			await saveUsageCache(cachePath, merged).catch(() => {});
		}
		return null;
	}

	// 5. Persist the refreshed cache (also evicts entries for deleted files).
	if (cachePath && dirty) {
		await saveUsageCache(cachePath, current).catch(() => {
			// Cache write failures must never break /usage.
		});
	}

	// 6. Aggregate in sorted path order with cross-file dedupe.
	const data = emptyUsageData({ todayMs, weekStartMs, lastWeekStartMs, last30DaysStartMs, nowMs: now.getTime() });
	const rawByPeriod: Record<TabName, PeriodRawData> = {
		today: emptyPeriodRawData(),
		thisWeek: emptyPeriodRawData(),
		lastWeek: emptyPeriodRawData(),
		last30Days: emptyPeriodRawData(),
		allTime: emptyPeriodRawData(),
	};
	const globalSessionSpans = new Map<string, GlobalSessionSpan>();
	const seenHashes = new Set<string>();
	let processedFiles = 0;

	for (const filePath of filePaths) {
		const state = current.get(filePath);
		if (!state || !state.parsed.sessionId) continue;

		if (++processedFiles % AGGREGATE_YIELD_EVERY_FILES === 0) {
			await new Promise<void>((resolve) => setImmediate(resolve));
			if (signal?.aborted) return null;
		}

		// Deduplicate copied history across branched session files.
		// Keep the existing ccusage-style hash so current totals remain comparable.
		const deduped: SessionMessage[] = [];
		for (const m of state.parsed.messages) {
			const hash = `${m.timestamp}:${m.input + m.output + m.cacheRead + m.cacheWrite}`;
			if (seenHashes.has(hash)) continue;
			seenHashes.add(hash);
			deduped.push(m);
		}
		if (deduped.length === 0) continue;

		addMessagesToUsageData(
			data,
			state.parsed.sessionId,
			deduped,
			todayMs,
			weekStartMs,
			lastWeekStartMs,
			last30DaysStartMs,
			rawByPeriod,
			globalSessionSpans
		);
	}

	// Classify sessions that are globally long-running once, then reuse across periods.
	const longSessionIds = new Set<string>();
	for (const [id, span] of globalSessionSpans) {
		if (span.endMs - span.startMs >= LONG_SESSION_MS) longSessionIds.add(id);
	}

	for (const period of TAB_ORDER) {
		data[period].insights = computeInsights(rawByPeriod[period], longSessionIds);
	}

	return data;
}

// =============================================================================
// Insights
// =============================================================================

const PARALLEL_WINDOW_MS = 2 * 60_000; // exact ±N milliseconds around each message
const PARALLEL_SESSION_THRESHOLD = 4;
const LARGE_CONTEXT_THRESHOLD = 150_000;
const LARGE_CACHE_MISS_THRESHOLD = 100_000;
const LONG_SESSION_MS = 8 * 60 * 60 * 1000;
const TOP_SESSION_COUNT = 5;
const MIN_MESSAGES_FOR_PARALLEL_INSIGHT = 10;
const MIN_PERCENT_TO_SHOW = 1;

/**
 * Insights are weighted by recorded API cost. Periods with zero total cost produce
 * an empty `insights` list — the UI renders a distinct empty-state for that case.
 * Long-running-session classification is passed in from a global pass so that a
 * session's real lifetime is used rather than the slice visible inside this period.
 */
function computeInsights(raw: PeriodRawData, longSessionIds: Set<string>): PeriodInsights {
	if (raw.messages.length === 0) {
		return { insights: [] };
	}

	const total = raw.messages.reduce((sum, m) => sum + m.cost, 0);
	if (total <= 0) {
		return { insights: [] };
	}

	const candidates: Insight[] = [];

	// 1. Parallel sessions — ≥ N unique sessions active within an exact ±W ms window.
	const parallelWeight = computeParallelCostWeight(raw.messages);
	if (parallelWeight !== null) {
		candidates.push({
			percent: (parallelWeight / total) * 100,
			headline: `of your cost was while ${PARALLEL_SESSION_THRESHOLD}+ sessions ran in parallel`,
			advice:
				"All sessions share one rate limit. If you don't need them all at once, queueing uses capacity more evenly.",
		});
	}

	// 2. Large context — input + cacheRead + cacheWrite > threshold.
	const largeContextWeight = raw.messages
		.filter((m) => m.input + m.cacheRead + m.cacheWrite > LARGE_CONTEXT_THRESHOLD)
		.reduce((sum, m) => sum + m.cost, 0);
	candidates.push({
		percent: (largeContextWeight / total) * 100,
		headline: `of your cost was at >${formatThresholdTokens(LARGE_CONTEXT_THRESHOLD)} context`,
		advice:
			"Longer sessions are more expensive even when cached. /compact mid-task, /clear when switching to new tasks.",
	});

	// 3. Large uncached prompt — fresh (non-cached) input > threshold, per the v0.2.0 formula.
	const uncachedWeight = raw.messages
		.filter((m) => m.input + m.cacheWrite > LARGE_CACHE_MISS_THRESHOLD)
		.reduce((sum, m) => sum + m.cost, 0);
	candidates.push({
		percent: (uncachedWeight / total) * 100,
		headline: `of your cost came from >${formatThresholdTokens(LARGE_CACHE_MISS_THRESHOLD)}-token uncached prompts`,
		advice:
			"Uncached input is expensive, and often happens when sending a message to a session that has gone idle. /compact before stepping away keeps the cold-start small.",
	});

	// 4. Long-running sessions — classification comes from the global pass so we use
	//    true session lifetime, not just the span visible inside this period slice.
	const longWeight = raw.messages
		.filter((m) => longSessionIds.has(m.sessionId))
		.reduce((sum, m) => sum + m.cost, 0);
	if (longWeight > 0) {
		candidates.push({
			percent: (longWeight / total) * 100,
			headline: `of your cost came from sessions active for ${LONG_SESSION_MS / 3_600_000}+ hours`,
			advice:
				"These are often background/loop sessions. Continuous usage can add up quickly so make sure it is intentional.",
		});
	}

	// 5. Top-N session concentration.
	if (raw.sessionCosts.size > TOP_SESSION_COUNT) {
		const sortedSessions = Array.from(raw.sessionCosts.values()).sort((a, b) => b - a);
		const topN = Math.min(TOP_SESSION_COUNT, sortedSessions.length);
		const topWeight = sortedSessions.slice(0, topN).reduce((sum, c) => sum + c, 0);
		candidates.push({
			percent: (topWeight / total) * 100,
			headline: `of your cost came from your top ${topN} session${topN === 1 ? "" : "s"}`,
			advice:
				"A small number of sessions drives most of your spend. The table view can help pinpoint which ones.",
		});
	}

	const insights = candidates.filter((i) => i.percent >= MIN_PERCENT_TO_SHOW).sort((a, b) => b.percent - a.percent);
	return { insights };
}

/**
 * Two-pointer sweep of messages sorted by timestamp. For each message, count the
 * number of distinct session IDs whose messages fall within an exact ± window.
 * Returns the total cost attributable to moments when ≥ threshold sessions were
 * active, or null if the period has too few sessions/messages to call it.
 *
 * Messages with missing/invalid timestamps (parsed as 0) are filtered out first —
 * otherwise they would collapse into a single synthetic instant and inflate the
 * parallel count on older or incomplete logs.
 */
function computeParallelCostWeight(messages: RawMessage[]): number | null {
	const timed = messages.filter((m) => m.timestamp > 0);
	if (timed.length < MIN_MESSAGES_FOR_PARALLEL_INSIGHT) return null;
	const distinctSessions = new Set(timed.map((m) => m.sessionId));
	if (distinctSessions.size < PARALLEL_SESSION_THRESHOLD) return null;

	const sorted = timed.slice().sort((a, b) => a.timestamp - b.timestamp);
	const sidCount = new Map<string, number>();
	let uniqueCount = 0;
	let left = 0;
	let right = 0;
	let parallelCost = 0;

	for (let i = 0; i < sorted.length; i++) {
		const current = sorted[i]!;
		const high = current.timestamp + PARALLEL_WINDOW_MS;
		const low = current.timestamp - PARALLEL_WINDOW_MS;

		while (right < sorted.length && sorted[right]!.timestamp <= high) {
			const sid = sorted[right]!.sessionId;
			const next = (sidCount.get(sid) ?? 0) + 1;
			sidCount.set(sid, next);
			if (next === 1) uniqueCount++;
			right++;
		}
		while (left < right && sorted[left]!.timestamp < low) {
			const sid = sorted[left]!.sessionId;
			const next = (sidCount.get(sid) ?? 0) - 1;
			if (next === 0) {
				sidCount.delete(sid);
				uniqueCount--;
			} else {
				sidCount.set(sid, next);
			}
			left++;
		}

		if (uniqueCount >= PARALLEL_SESSION_THRESHOLD) parallelCost += current.cost;
	}

	return parallelCost;
}

function formatThresholdTokens(n: number): string {
	if (n >= 1_000_000) return `${n / 1_000_000}M`;
	if (n >= 1_000) return `${n / 1_000}k`;
	return String(n);
}
