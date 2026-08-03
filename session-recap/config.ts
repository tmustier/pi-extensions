import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type RecapReason = "away" | "idle" | "resume" | "manual" | "live";
export type ResponseMode = "plain" | "json";

export type RecapConfig = {
	enabled: {
		automatic: boolean;
		manual: boolean;
		away: boolean;
		idle: boolean;
		resume: boolean;
		live: boolean;
		focusReporting: boolean;
	};
	timings: {
		awayMs: number;
		idleMs: number;
		postTurnDebounceMs: number;
		resumeDelayMs: number;
		liveFirstMs: number;
		liveMinIntervalMs: number;
		livePollMs: number;
	};
	focus: {
		enableSequence: string;
		disableSequence: string;
		inSequence: string;
		outSequence: string;
		inputBufferCap: number;
		allowAwayDuringAgent: boolean;
		finishDraftAfterRefocus: boolean;
	};
	activity: {
		assistantMinWords: number;
		assistantCharsPerLiveVersion: number;
		toolUpdateCharsPerLiveVersion: number;
		liveEvents: string[];
		maxLiveEvents: number;
		maxLiveEventChars: number;
		maxRunningTools: number;
	};
	transcript: {
		earlierUserPrompts: number;
		earlierPromptChars: number;
		compactionSummaryChars: number;
		userChars: number;
		assistantChars: number;
		toolArgumentsChars: number;
		toolResultChars: number;
		totalChars: number;
		currentUserReserveChars: number;
		persistedReserveChars: number;
		liveMaxChars: number;
		liveAssistantChars: number;
	};
	model: {
		candidates: string[];
		reasoning: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
		cacheRetention: "none" | "short" | "long";
		maxTokens: number;
		fallbackOnAuthError: boolean;
		fallbackOnCompletionError: boolean;
		silentUnsupportedApi: boolean;
	};
	prompts: Record<"system" | RecapReason, string>;
	response: {
		modes: Record<RecapReason, ResponseMode>;
		fields: string[];
		template: string;
		malformedFallback: string;
		emptyFieldFallback: string;
		maxChars: number;
	};
	widget: {
		key: string;
		statusKey: string;
		header: string;
		headerColor: string;
		bodyColor: string;
		wrapWidth: number;
		maxBodyLines: number;
		placement: "aboveEditor" | "belowEditor";
		draftingStatus: string;
	};
	lifecycle: {
		clearOnInput: boolean;
		clearOnAgentStart: boolean;
		clearOnTurnStart: boolean;
		liveWidgetOnAgentEnd: "keep" | "clear";
		clearOnSessionShutdown: boolean;
		persistWidgetAcrossResume: boolean;
	};
};

export type ConfigSourceOptions = {
	cwd: string;
	projectTrusted: boolean;
	agentDir?: string;
	explicitPath?: string;
	env?: NodeJS.ProcessEnv;
};

export type ConfigLoadResult = {
	config: RecapConfig;
	loadedFiles: string[];
	valid: boolean;
};

const DEFAULTS_PATH = join(dirname(fileURLToPath(import.meta.url)), "defaults.json");
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

function parseJson(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8"));
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateShape(value: unknown, shape: unknown, path = "config"): string | undefined {
	if (Array.isArray(shape)) {
		if (!Array.isArray(value)) return `${path} must be an array`;
		if (shape.length > 0 && typeof shape[0] === "string" && value.some((item) => typeof item !== "string")) {
			return `${path} must contain only strings`;
		}
		return undefined;
	}
	if (isObject(shape)) {
		if (!isObject(value)) return `${path} must be an object`;
		for (const key of Object.keys(value)) {
			if (!(key in shape)) return `${path}.${key} is unknown`;
		}
		for (const [key, child] of Object.entries(value)) {
			const error = validateShape(child, shape[key], `${path}.${key}`);
			if (error) return error;
		}
		return undefined;
	}
	if (typeof value !== typeof shape) return `${path} must be ${typeof shape}`;
	if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) {
		return `${path} must be a finite non-negative number`;
	}
	return undefined;
}

function deepMerge<T>(base: T, override: unknown): T {
	if (!isObject(base) || !isObject(override)) return structuredClone(override) as T;
	const result: Record<string, unknown> = structuredClone(base) as Record<string, unknown>;
	for (const [key, value] of Object.entries(override)) {
		result[key] = isObject(value) && isObject(result[key]) ? deepMerge(result[key], value) : structuredClone(value);
	}
	return result as T;
}

function validateTemplate(template: string, allowed: string[], path: string): string | undefined {
	if (/{{{|}}}/.test(template)) return `${path} contains an invalid interpolation token`;
	const token = /{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g;
	for (const match of template.matchAll(token)) {
		if (!allowed.includes(match[1])) return `${path} references unknown value ${match[1]}`;
	}
	if (template.replace(token, "").match(/{{|}}/)) return `${path} contains an invalid interpolation token`;
	return undefined;
}

const LIVE_EVENTS = new Set([
	"message_update",
	"message_end",
	"tool_execution_start",
	"tool_execution_update",
	"tool_execution_end",
	"turn_end",
]);
const REASONING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const CACHE_RETENTIONS = new Set(["none", "short", "long"]);

const THEME_COLORS = new Set([
	"accent", "border", "borderAccent", "borderMuted", "success", "error", "warning", "muted", "dim", "text",
	"thinkingText", "userMessageText", "customMessageText", "customMessageLabel", "toolTitle", "toolOutput", "mdHeading",
	"mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock", "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet",
	"toolDiffAdded", "toolDiffRemoved", "toolDiffContext", "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable",
	"syntaxString", "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation", "thinkingOff", "thinkingMinimal",
	"thinkingLow", "thinkingMedium", "thinkingHigh", "thinkingXhigh", "bashMode",
]);

function validateConfig(config: RecapConfig): string | undefined {
	const integer = (value: number, path: string, allowZero = true): string | undefined => {
		if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) {
			return `${path} must be ${allowZero ? "a non-negative" : "a positive"} integer`;
		}
		return undefined;
	};
	for (const reason of ["away", "idle", "resume", "manual", "live"] as const) {
		if (config.response.modes[reason] !== "plain" && config.response.modes[reason] !== "json") {
			return `config.response.modes.${reason} must be plain or json`;
		}
	}
	if (!config.focus.inSequence || !config.focus.outSequence) {
		return "config focus input sequences must be non-empty";
	}
	if (
		config.focus.inSequence === config.focus.outSequence ||
		config.focus.inSequence.startsWith(config.focus.outSequence) ||
		config.focus.outSequence.startsWith(config.focus.inSequence)
	) {
		return "config focus input sequences must be distinct and not prefix-overlapping";
	}
	const focusCapError = integer(config.focus.inputBufferCap, "config.focus.inputBufferCap", false);
	if (focusCapError) return focusCapError;
	if (config.focus.inputBufferCap < Math.max(config.focus.inSequence.length, config.focus.outSequence.length)) {
		return "config.focus.inputBufferCap must fit the longest focus input sequence";
	}
	if (config.widget.placement !== "aboveEditor" && config.widget.placement !== "belowEditor") {
		return "config.widget.placement must be aboveEditor or belowEditor";
	}
	if (!THEME_COLORS.has(config.widget.headerColor) || !THEME_COLORS.has(config.widget.bodyColor)) {
		return "config widget colors must be Pi theme color names";
	}
	if (config.lifecycle.liveWidgetOnAgentEnd !== "keep" && config.lifecycle.liveWidgetOnAgentEnd !== "clear") {
		return "config.lifecycle.liveWidgetOnAgentEnd must be keep or clear";
	}
	if (config.model.candidates.length === 0) {
		return "config.model.candidates must not be empty";
	}
	if (config.model.candidates.some((candidate) => {
		if (candidate === "$active") return false;
		const separator = candidate.indexOf("/");
		if (separator <= 0 || separator === candidate.length - 1) return true;
		const provider = candidate.slice(0, separator);
		const id = candidate.slice(separator + 1);
		return !provider.trim() || provider !== provider.trim() || !id.trim() || id !== id.trim();
	})) {
		return "config.model.candidates entries must be $active or provider/model with non-empty components";
	}
	if (!REASONING_LEVELS.has(config.model.reasoning)) {
		return "config.model.reasoning must be off, minimal, low, medium, high, xhigh, or max";
	}
	if (!CACHE_RETENTIONS.has(config.model.cacheRetention)) {
		return "config.model.cacheRetention must be none, short, or long";
	}
	const maxTokensError = integer(config.model.maxTokens, "config.model.maxTokens", false);
	if (maxTokensError) return maxTokensError;
	const liveEventsError = config.activity.liveEvents.find((event) => !LIVE_EVENTS.has(event));
	if (liveEventsError) return `config.activity.liveEvents contains unknown event ${liveEventsError}`;
	if (!config.response.fields.includes("done") || !config.response.fields.includes("current") || !config.response.fields.includes("next")) {
		return "config.response.fields must include done, current, and next";
	}
	for (const reason of ["away", "idle", "resume", "manual", "live"] as const) {
		const error = validateTemplate(config.prompts[reason], ["transcript"], `config.prompts.${reason}`);
		if (error) return error;
	}
	const systemError = validateTemplate(config.prompts.system, [], "config.prompts.system");
	if (systemError) return systemError;
	const responseError = validateTemplate(config.response.template, config.response.fields, "config.response.template");
	if (responseError) return responseError;
	for (const [path, value] of [
		["config.timings.awayMs", config.timings.awayMs],
		["config.timings.idleMs", config.timings.idleMs],
		["config.timings.postTurnDebounceMs", config.timings.postTurnDebounceMs],
		["config.timings.resumeDelayMs", config.timings.resumeDelayMs],
		["config.timings.liveFirstMs", config.timings.liveFirstMs],
		["config.timings.liveMinIntervalMs", config.timings.liveMinIntervalMs],
		["config.timings.livePollMs", config.timings.livePollMs],
	] as const) {
		if (value > MAX_TIMER_DELAY_MS) return `${path} must be <= ${MAX_TIMER_DELAY_MS}`;
	}
	for (const [path, value, allowZero] of [
		["config.timings.awayMs", config.timings.awayMs, true],
		["config.timings.idleMs", config.timings.idleMs, true],
		["config.timings.postTurnDebounceMs", config.timings.postTurnDebounceMs, true],
		["config.timings.resumeDelayMs", config.timings.resumeDelayMs, true],
		["config.timings.liveFirstMs", config.timings.liveFirstMs, true],
		["config.timings.liveMinIntervalMs", config.timings.liveMinIntervalMs, true],
		["config.timings.livePollMs", config.timings.livePollMs, false],
		["config.activity.assistantMinWords", config.activity.assistantMinWords, true],
		["config.activity.assistantCharsPerLiveVersion", config.activity.assistantCharsPerLiveVersion, false],
		["config.activity.toolUpdateCharsPerLiveVersion", config.activity.toolUpdateCharsPerLiveVersion, false],
		["config.activity.maxLiveEvents", config.activity.maxLiveEvents, false],
		["config.activity.maxLiveEventChars", config.activity.maxLiveEventChars, false],
		["config.activity.maxRunningTools", config.activity.maxRunningTools, false],
		["config.transcript.earlierUserPrompts", config.transcript.earlierUserPrompts, true],
		["config.transcript.earlierPromptChars", config.transcript.earlierPromptChars, true],
		["config.transcript.compactionSummaryChars", config.transcript.compactionSummaryChars, true],
		["config.transcript.userChars", config.transcript.userChars, true],
		["config.transcript.assistantChars", config.transcript.assistantChars, true],
		["config.transcript.toolArgumentsChars", config.transcript.toolArgumentsChars, true],
		["config.transcript.toolResultChars", config.transcript.toolResultChars, true],
		["config.transcript.totalChars", config.transcript.totalChars, false],
		["config.transcript.currentUserReserveChars", config.transcript.currentUserReserveChars, false],
		["config.transcript.persistedReserveChars", config.transcript.persistedReserveChars, false],
		["config.transcript.liveMaxChars", config.transcript.liveMaxChars, false],
		["config.transcript.liveAssistantChars", config.transcript.liveAssistantChars, true],
		["config.response.maxChars", config.response.maxChars, false],
		["config.widget.wrapWidth", config.widget.wrapWidth, false],
		["config.widget.maxBodyLines", config.widget.maxBodyLines, false],
	] as const) {
		const error = integer(value, path, allowZero);
		if (error) return error;
	}
	return undefined;
}

export function shippedDefaults(): RecapConfig {
	const parsed = parseJson(DEFAULTS_PATH);
	if (!isObject(parsed)) throw new Error(`${DEFAULTS_PATH}: defaults must be an object`);
	const config = parsed as RecapConfig;
	const error = validateConfig(config);
	if (error) throw new Error(`${DEFAULTS_PATH}: ${error}`);
	return config;
}

function expandPath(path: string, cwd: string): string {
	const expanded = path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
	return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

type ConfigSource = { path: string; required: boolean };

function configSources(options: ConfigSourceOptions): ConfigSource[] {
	const env = options.env ?? process.env;
	const agentDir = options.agentDir ?? env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	const layers: ConfigSource[] = [
		{ path: join(agentDir, "session-recap.json"), required: false },
	];
	if (options.projectTrusted) {
		layers.push({ path: join(options.cwd, ".pi", "session-recap.json"), required: false });
	}
	if (env.PI_SESSION_RECAP_CONFIG) {
		layers.push({ path: expandPath(env.PI_SESSION_RECAP_CONFIG, options.cwd), required: true });
	}
	if (options.explicitPath) {
		layers.push({ path: expandPath(options.explicitPath, options.cwd), required: true });
	}
	const deduplicated: ConfigSource[] = [];
	for (const layer of layers) {
		const existingIndex = deduplicated.findIndex((source) => source.path === layer.path);
		const required = layer.required || (existingIndex >= 0 && deduplicated[existingIndex].required);
		if (existingIndex >= 0) deduplicated.splice(existingIndex, 1);
		deduplicated.push({ ...layer, required });
	}
	return deduplicated;
}

export function configPaths(options: ConfigSourceOptions): string[] {
	return configSources(options).map((source) => source.path);
}

export function loadConfig(
	options: ConfigSourceOptions,
	previous: RecapConfig | undefined,
	report: (message: string) => void = console.error,
): ConfigLoadResult {
	let config: RecapConfig;
	try {
		config = shippedDefaults();
	} catch (error) {
		if (previous) return { config: previous, loadedFiles: [], valid: false };
		throw error;
	}
	const defaults = config;
	const loadedFiles: string[] = [];
	for (const source of configSources(options)) {
		const path = source.path;
		if (!existsSync(path)) {
			if (source.required) {
				report(`[session-recap] invalid config ${path}: file does not exist; keeping last valid configuration`);
				return { config: previous ?? defaults, loadedFiles: [], valid: false };
			}
			continue;
		}
		try {
			const override = parseJson(path);
			const shapeError = validateShape(override, defaults);
			if (shapeError) throw new Error(shapeError);
			config = deepMerge(config, override);
			const configError = validateConfig(config);
			if (configError) throw new Error(configError);
			loadedFiles.push(path);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			report(`[session-recap] invalid config ${path}: ${detail}; keeping last valid configuration`);
			return { config: previous ?? defaults, loadedFiles: [], valid: false };
		}
	}
	return { config, loadedFiles, valid: true };
}

export function applyDeprecatedFlagOverrides(
	config: RecapConfig,
	flags: {
		awaySeconds?: string;
		idleSeconds?: string;
		disableFocus?: boolean;
		duringActive?: boolean;
		disable?: boolean;
		model?: string;
	},
): RecapConfig {
	const result = structuredClone(config);
	const applySeconds = (value: string | undefined, current: number): number => {
		const seconds = Number(value);
		const milliseconds = Math.max(5, seconds) * 1000;
		return value && Number.isFinite(seconds) && Number.isInteger(milliseconds) && milliseconds <= MAX_TIMER_DELAY_MS
			? milliseconds
			: current;
	};
	result.timings.awayMs = applySeconds(flags.awaySeconds, result.timings.awayMs);
	result.timings.idleMs = applySeconds(flags.idleSeconds, result.timings.idleMs);
	if (flags.disableFocus) result.enabled.focusReporting = false;
	if (flags.duringActive) result.focus.allowAwayDuringAgent = true;
	if (flags.disable) result.enabled.automatic = false;
	if (flags.model) result.model.candidates = [flags.model, ...result.model.candidates.filter((candidate) => candidate !== flags.model)];
	return result;
}
