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
	/** Structure insights always show; alarms fire only when material. */
	kind: "structure" | "alarm";
	/** Leading stat, already formatted (e.g. "34%", "$446", "1.4×"). */
	stat: string;
	headline: string;
	/** Dimmed follow-up line; empty string renders nothing. */
	advice: string;
}

export interface PeriodInsights {
	insights: Insight[];
}

interface CostCount {
	cost: number;
	messages: number;
}

interface PeriodRawData {
	totalCost: number;
	totalMessages: number;
	/** Messages at ≥ CTX_TAX_THRESHOLD context. */
	ctxHigh: CostCount;
	/** Messages below CTX_LOW_THRESHOLD context (comparison group). */
	ctxLow: CostCount;
	projectCosts: Map<string, number>;
	sessionCosts: Map<string, number>;
	/** Cost of each session's first-ever message falling in this period. */
	upfrontCost: number;
	/** Cache misses after >TTL_GAP_MS idle — expired-cache re-warms. */
	ttlMissCost: number;
	/** Cache misses without an idle gap (compaction excluded) — prefix changes. */
	prefixMissCost: number;
	reasoningTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	freshTokens: number;
}

/** Per-message adjacency info, computed on raw file order before dedupe. */
interface MessageMeta {
	/** Gap to the previous assistant message in the same file; -1 when unknown. */
	gapMs: number;
	/** Context size of the previous assistant message in the same file; 0 when first. */
	prevCtx: number;
	/** True for the first deduped message of a session across all its files. */
	isSessionStart: boolean;
}

export interface TrendInfo {
	/** Cost over the last 7 calendar days including today. */
	last7Cost: number;
	/** Average weekly cost over the prior 28 days. */
	priorWeeklyPace: number;
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
	/**
	 * True when a compaction entry occurred between the previous assistant
	 * message and this one. Compaction legitimately changes the request prefix,
	 * so such messages are excluded from prefix-change cache-miss accounting.
	 */
	afterCompaction: boolean;
}

export interface ParsedSessionFile {
	/** Empty string when the file has no session header — such files are ignored. */
	sessionId: string;
	/** Working directory from the session header; "" when absent. */
	cwd: string;
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
const PATTERN_COMPACTION_COMPACT = Buffer.from('"type":"compaction"');
const PATTERN_COMPACTION_SPACED = Buffer.from('"type": "compaction"');

const PARSE_YIELD_EVERY_LINES = 2000;

function lineMightBeRelevant(line: Buffer): boolean {
	return (
		line.includes(PATTERN_ASSISTANT_COMPACT) ||
		line.includes(PATTERN_SESSION_COMPACT) ||
		line.includes(PATTERN_THINKING_COMPACT) ||
		line.includes(PATTERN_COMPACTION_COMPACT) ||
		line.includes(PATTERN_ASSISTANT_SPACED) ||
		line.includes(PATTERN_SESSION_SPACED) ||
		line.includes(PATTERN_THINKING_SPACED) ||
		line.includes(PATTERN_COMPACTION_SPACED)
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
	let cwd = "";
	// Assistant messages don't carry the thinking level; pi records it as separate
	// thinking_level_change entries, always written before the first assistant
	// message of a session. Replaying them in append order attributes each message
	// to the level active when it was produced.
	let thinkingLevel = "";
	let compactionPending = false;
	let start = 0;
	let lineNumber = 0;

	while (start < buffer.length) {
		let end = buffer.indexOf(NEWLINE, start);
		if (end === -1) end = buffer.length;

		lineNumber++;
		if (lineNumber % PARSE_YIELD_EVERY_LINES === 0) {
			await new Promise<void>((resolve) => setImmediate(resolve));
			if (signal?.aborted) return { sessionId, cwd, messages };
		}

		if (end > start && lineMightBeRelevant(buffer.subarray(start, end))) {
			try {
				const entry = JSON.parse(buffer.toString("utf8", start, end));

				if (entry.type === "session") {
					sessionId = entry.id;
					if (typeof entry.cwd === "string") cwd = entry.cwd;
				} else if (entry.type === "thinking_level_change") {
					if (typeof entry.thinkingLevel === "string") thinkingLevel = entry.thinkingLevel;
				} else if (entry.type === "compaction") {
					compactionPending = true;
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
							afterCompaction: compactionPending,
						});
						compactionPending = false;
					}
				}
			} catch {
				// Skip malformed lines
			}
		}

		start = end + 1;
	}

	return { sessionId, cwd, messages };
}

// =============================================================================
// On-disk cache
// =============================================================================

const CACHE_VERSION = 3;

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
	afterCompaction: 0 | 1,
];

interface CacheFileEntry {
	size: number;
	mtimeMs: number;
	sessionId: string;
	cwd: string;
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
			typeof entry.cwd !== "string" ||
			!Array.isArray(entry.messages)
		) {
			continue;
		}
		const messages: SessionMessage[] = [];
		let valid = true;
		for (const tuple of entry.messages) {
			if (!Array.isArray(tuple) || tuple.length !== 11) {
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
				afterCompaction: tuple[10] === 1,
			});
		}
		if (!valid) continue;
		result.set(filePath, {
			size: entry.size,
			mtimeMs: entry.mtimeMs,
			parsed: { sessionId: entry.sessionId, cwd: entry.cwd, messages },
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
			cwd: state.parsed.cwd,
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
				m.afterCompaction ? 1 : 0,
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
	return {
		totalCost: 0,
		totalMessages: 0,
		ctxHigh: { cost: 0, messages: 0 },
		ctxLow: { cost: 0, messages: 0 },
		projectCosts: new Map(),
		sessionCosts: new Map(),
		upfrontCost: 0,
		ttlMissCost: 0,
		prefixMissCost: 0,
		reasoningTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		freshTokens: 0,
	};
}

/**
 * Collapse a session cwd to a short, stable project label: `~` for the home
 * directory, up to two path segments below home (worktrees collapse to their
 * repository), absolute paths elsewhere.
 */
export function projectLabelFromCwd(cwd: string): string {
	if (!cwd) return "(unknown)";
	// Collapse any home-directory prefix to "~", not just the current user's —
	// session stores merged from other machines can carry a different username.
	const home = homedir();
	let homePrefix: string | null = null;
	if (cwd === home || cwd.startsWith(home + "/")) {
		homePrefix = home;
	} else {
		const m = /^(\/Users\/[^/]+|\/home\/[^/]+)(?=\/|$)/.exec(cwd);
		if (m) homePrefix = m[1]!;
	}
	if (homePrefix !== null && cwd.length <= homePrefix.length) return "~";
	let rel = homePrefix !== null ? cwd.slice(homePrefix.length + 1) : cwd;
	const wt = rel.indexOf("/.worktrees/");
	if (wt !== -1) rel = rel.slice(0, wt);
	const parts = rel.split("/").filter(Boolean);
	const label = parts.slice(0, 2).join("/");
	return homePrefix !== null ? `~/${label}` : `/${label}`;
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

const DAY_MS = 24 * HOUR_MS;

function addMessagesToUsageData(
	data: UsageData,
	sessionId: string,
	project: string,
	messages: SessionMessage[],
	meta: MessageMeta[],
	todayMs: number,
	weekStartMs: number,
	lastWeekStartMs: number,
	last30DaysStartMs: number,
	rawByPeriod: Record<TabName, PeriodRawData>,
	costByDayIdx: Map<number, number>
): void {
	const sessionContributed = { today: false, thisWeek: false, lastWeek: false, last30Days: false, allTime: false };

	for (let mi = 0; mi < messages.length; mi++) {
		const msg = messages[mi]!;
		const mm = meta[mi]!;

		// Day-indexed cost totals power the burn-trend insight.
		if (msg.timestamp > 0) {
			const dayIdx = Math.floor((msg.timestamp - todayMs) / DAY_MS);
			costByDayIdx.set(dayIdx, (costByDayIdx.get(dayIdx) ?? 0) + msg.cost);
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
			raw.totalCost += msg.cost;
			raw.totalMessages++;
			const ctx = msg.input + msg.cacheRead + msg.cacheWrite;
			if (ctx >= CTX_TAX_THRESHOLD) {
				raw.ctxHigh.cost += msg.cost;
				raw.ctxHigh.messages++;
			} else if (ctx < CTX_LOW_THRESHOLD) {
				raw.ctxLow.cost += msg.cost;
				raw.ctxLow.messages++;
			}
			raw.projectCosts.set(project, (raw.projectCosts.get(project) ?? 0) + msg.cost);
			raw.sessionCosts.set(sessionId, (raw.sessionCosts.get(sessionId) ?? 0) + msg.cost);
			if (mm.isSessionStart) raw.upfrontCost += msg.cost;
			if (
				!msg.afterCompaction &&
				mm.prevCtx >= MISS_MIN_PREV_CONTEXT &&
				msg.cacheRead < Math.min(MISS_MAX_CACHE_READ, 0.3 * mm.prevCtx)
			) {
				if (mm.gapMs > TTL_GAP_MS) raw.ttlMissCost += msg.cost;
				else if (mm.gapMs >= 0) raw.prefixMissCost += msg.cost;
			}
			raw.reasoningTokens += msg.reasoning;
			raw.outputTokens += msg.output;
			raw.cacheReadTokens += msg.cacheRead;
			raw.freshTokens += msg.input + msg.cacheWrite;
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
	const costByDayIdx = new Map<number, number>();
	const seenSessions = new Set<string>();
	const seenHashes = new Set<string>();
	let processedFiles = 0;

	for (const filePath of filePaths) {
		const state = current.get(filePath);
		if (!state || !state.parsed.sessionId) continue;

		if (++processedFiles % AGGREGATE_YIELD_EVERY_FILES === 0) {
			await new Promise<void>((resolve) => setImmediate(resolve));
			if (signal?.aborted) return null;
		}

		// Deduplicate copied history across branched session files, computing
		// adjacency metadata (idle gaps, previous context) on the raw file order
		// so branch copies do not distort miss classification.
		const rawMsgs = state.parsed.messages;
		const deduped: SessionMessage[] = [];
		const meta: MessageMeta[] = [];
		for (let i = 0; i < rawMsgs.length; i++) {
			const m = rawMsgs[i]!;
			const hash = `${m.timestamp}:${m.input + m.output + m.cacheRead + m.cacheWrite}`;
			if (seenHashes.has(hash)) continue;
			seenHashes.add(hash);
			const prev = i > 0 ? rawMsgs[i - 1]! : null;
			deduped.push(m);
			meta.push({
				gapMs: prev && prev.timestamp > 0 && m.timestamp > 0 ? m.timestamp - prev.timestamp : -1,
				prevCtx: prev ? prev.input + prev.cacheRead + prev.cacheWrite : 0,
				isSessionStart: false,
			});
		}
		if (deduped.length === 0) continue;
		if (!seenSessions.has(state.parsed.sessionId)) {
			seenSessions.add(state.parsed.sessionId);
			meta[0]!.isSessionStart = true;
		}

		addMessagesToUsageData(
			data,
			state.parsed.sessionId,
			projectLabelFromCwd(state.parsed.cwd),
			deduped,
			meta,
			todayMs,
			weekStartMs,
			lastWeekStartMs,
			last30DaysStartMs,
			rawByPeriod,
			costByDayIdx
		);
	}

	// Burn trend: last 7 calendar days vs the average weekly pace of the prior 28.
	let last7 = 0;
	let prior28 = 0;
	for (const [idx, c] of costByDayIdx) {
		if (idx >= -6) last7 += c;
		else if (idx >= -34) prior28 += c;
	}
	const trend: TrendInfo | null = prior28 > 0 ? { last7Cost: last7, priorWeeklyPace: prior28 / 4 } : null;

	for (const period of TAB_ORDER) {
		data[period].insights = computeInsights(rawByPeriod[period], trend);
	}

	return data;
}

// =============================================================================
// Insights
// =============================================================================

// Context tax (structure)
const CTX_TAX_THRESHOLD = 150_000;
const CTX_LOW_THRESHOLD = 100_000;
// Project mix (structure)
const PROJECT_TOP_COUNT = 3;
const PROJECT_MAX_DOMINANCE_PERCENT = 90;
// Reasoning share (structure)
const REASONING_MIN_PERCENT = 5;
// Burn trend (structure)
const TREND_HIGH_RATIO = 1.5;
const TREND_LOW_RATIO = 0.6;
// Cache-miss alarms
const TTL_GAP_MS = 5 * 60_000;
const MISS_MIN_PREV_CONTEXT = 20_000;
const MISS_MAX_CACHE_READ = 5_000;
const CACHE_MISS_ALARM_PERCENT = 2;
const CACHE_MISS_ALARM_MIN_COST = 1;
// Concentration / upfront alarms
const TOP_SESSION_COUNT = 5;
const CONCENTRATION_ALARM_PERCENT = 35;
const UPFRONT_ALARM_PERCENT = 8;
// Cache-leverage alarm
const LEVERAGE_FLOOR = 5;
const LEVERAGE_MIN_COST = 5;
const LEVERAGE_MIN_FRESH_TOKENS = 1_000_000;

function fmtMoney(v: number): string {
	if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
	if (v >= 100) return `$${Math.round(v)}`;
	return `$${v.toFixed(2)}`;
}

function fmtPercent(p: number): string {
	return p >= 10 ? `${Math.round(p)}%` : `${p.toFixed(1)}%`;
}

/**
 * Insights come in two kinds:
 * - structure: always-on decomposition of where the period's cost went.
 * - alarm: fires only when a wasteful pattern is material for the period, so
 *   an all-clear period shows a calm panel instead of a wall of 2% factoids.
 * Periods with zero recorded cost produce an empty list — the UI renders a
 * distinct empty-state for that case.
 */
function computeInsights(raw: PeriodRawData, trend: TrendInfo | null): PeriodInsights {
	if (raw.totalMessages === 0 || raw.totalCost <= 0) {
		return { insights: [] };
	}
	const total = raw.totalCost;
	const insights: Insight[] = [];

	// --- Alarms (listed first) ---

	const ttlPct = (raw.ttlMissCost / total) * 100;
	if (ttlPct >= CACHE_MISS_ALARM_PERCENT && raw.ttlMissCost >= CACHE_MISS_ALARM_MIN_COST) {
		insights.push({
			kind: "alarm",
			stat: fmtMoney(raw.ttlMissCost),
			headline: `spent re-warming caches that expired during idle gaps (${fmtPercent(ttlPct)} of this period)`,
			advice:
				"Provider caches expire after a few minutes idle (Anthropic ~5min); the next message re-writes the whole context at premium rates. Batching replies instead of trickling them keeps caches warm.",
		});
	}

	const prefixPct = (raw.prefixMissCost / total) * 100;
	if (prefixPct >= CACHE_MISS_ALARM_PERCENT && raw.prefixMissCost >= CACHE_MISS_ALARM_MIN_COST) {
		insights.push({
			kind: "alarm",
			stat: fmtMoney(raw.prefixMissCost),
			headline: `spent on cache misses with no idle gap (${fmtPercent(prefixPct)} of this period)`,
			advice:
				"The request prefix changed mid-session (compaction excluded), so cached context was re-sent at full price. If this stays high, something in the workflow is defeating provider caching.",
		});
	}

	if (raw.sessionCosts.size > TOP_SESSION_COUNT) {
		const sortedSessions = Array.from(raw.sessionCosts.values()).sort((a, b) => b - a);
		const topWeight = sortedSessions.slice(0, TOP_SESSION_COUNT).reduce((sum, c) => sum + c, 0);
		const topPct = (topWeight / total) * 100;
		if (topPct >= CONCENTRATION_ALARM_PERCENT) {
			insights.push({
				kind: "alarm",
				stat: fmtPercent(topPct),
				headline: `of this period's cost came from just ${TOP_SESSION_COUNT} sessions (of ${raw.sessionCosts.size})`,
				advice: "Spend is unusually concentrated. The graph view's filters can pinpoint what those sessions were doing.",
			});
		}
	}

	const upfrontPct = (raw.upfrontCost / total) * 100;
	if (upfrontPct >= UPFRONT_ALARM_PERCENT) {
		insights.push({
			kind: "alarm",
			stat: fmtPercent(upfrontPct),
			headline: "of cost was the first message of a session",
			advice:
				"Session starts pay for their whole prompt uncached. Fewer, longer-lived sessions amortize that setup cost.",
		});
	}

	if (total >= LEVERAGE_MIN_COST && raw.freshTokens >= LEVERAGE_MIN_FRESH_TOKENS) {
		const leverage = raw.cacheReadTokens / raw.freshTokens;
		if (leverage < LEVERAGE_FLOOR) {
			insights.push({
				kind: "alarm",
				stat: `${leverage.toFixed(1)}×`,
				headline: "cache leverage — cached tokens served per fresh token paid",
				advice:
					"Healthy interactive use typically sees 10×+. Low leverage means context is being re-sent uncached — look for workflows that restart conversations.",
			});
		}
	}

	// --- Structure (always-on) ---

	if (raw.ctxHigh.messages > 0) {
		const pct = (raw.ctxHigh.cost / total) * 100;
		if (pct >= 1) {
			const avgHigh = raw.ctxHigh.cost / raw.ctxHigh.messages;
			const avgLow = raw.ctxLow.messages > 0 ? raw.ctxLow.cost / raw.ctxLow.messages : 0;
			const cmp =
				avgLow > 0
					? ` — averaging ${fmtMoney(avgHigh)}/msg vs ${fmtMoney(avgLow)} under ${formatThresholdTokens(CTX_LOW_THRESHOLD)}`
					: "";
			insights.push({
				kind: "structure",
				stat: fmtPercent(pct),
				headline: `of your cost was at ≥${formatThresholdTokens(CTX_TAX_THRESHOLD)} context${cmp}`,
				advice: "Context size is the main cost driver. /compact mid-task and /clear between tasks to reset it.",
			});
		}
	}

	if (raw.projectCosts.size >= 2) {
		const top = [...raw.projectCosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, PROJECT_TOP_COUNT);
		const topPct = (top[0]![1] / total) * 100;
		if (topPct < PROJECT_MAX_DOMINANCE_PERCENT) {
			const rest = top
				.slice(1)
				.map(([label, c]) => `${label} ${fmtPercent((c / total) * 100)}`)
				.join(", ");
			insights.push({
				kind: "structure",
				stat: fmtPercent(topPct),
				headline: `of your cost was ${top[0]![0]}${rest ? ` — then ${rest}` : ""}`,
				advice: "",
			});
		}
	}

	if (raw.outputTokens > 0) {
		const reasoningPct = (raw.reasoningTokens / raw.outputTokens) * 100;
		if (reasoningPct >= REASONING_MIN_PERCENT) {
			insights.push({
				kind: "structure",
				stat: fmtPercent(reasoningPct),
				headline: "of your output tokens were invisible reasoning",
				advice:
					"Reasoning is billed as output but never displayed. Recorded by pi 0.80.3+ (June 2026) only, so older periods understate it.",
			});
		}
	}

	if (trend && trend.priorWeeklyPace > 0) {
		const ratio = trend.last7Cost / trend.priorWeeklyPace;
		const advice =
			ratio >= TREND_HIGH_RATIO
				? "Spend is accelerating vs your own baseline — the graph view shows what changed."
				: ratio <= TREND_LOW_RATIO
					? "Spend is well below your recent baseline."
					: "";
		insights.push({
			kind: "structure",
			stat: `${ratio.toFixed(1)}×`,
			headline: `your last 7 days (${fmtMoney(trend.last7Cost)}) vs your prior 4-week pace (${fmtMoney(trend.priorWeeklyPace)}/wk)`,
			advice,
		});
	}

	return { insights };
}

function formatThresholdTokens(n: number): string {
	if (n >= 1_000_000) return `${n / 1_000_000}M`;
	if (n >= 1_000) return `${n / 1_000}k`;
	return String(n);
}
