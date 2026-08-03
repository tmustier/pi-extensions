import { createHash } from "node:crypto";
import type { RecapConfig, RecapReason } from "./config.ts";

export type ContentBlock = {
	type?: string;
	text?: string;
	name?: string;
	arguments?: Record<string, unknown>;
};

export type Entry = {
	id?: string;
	type: string;
	summary?: string;
	message?: {
		role?: string;
		content?: unknown;
		toolName?: string;
	};
};

type Model = {
	provider: string;
	id: string;
	[key: string]: unknown;
};

type AuthResult = {
	ok: boolean;
	apiKey?: string;
	headers?: Record<string, string>;
	env?: Record<string, string>;
};

export type RecapContext = {
	model?: Model;
	modelRegistry: {
		find(provider: string, id: string): Model | undefined;
		getApiKeyAndHeaders(model: Model): Promise<AuthResult>;
	};
};

export type CompleteFunction = (
	model: Model,
	context: {
		systemPrompt: string;
		messages: Array<{ role: "user"; content: Array<{ type: "text"; text: string }>; timestamp: number }>;
	},
	options: {
		apiKey?: string;
		headers?: Record<string, string>;
		env?: Record<string, string>;
		signal?: AbortSignal;
		reasoning: string;
		cacheRetention: string;
		maxTokens: number;
	},
) => Promise<{ content: Array<{ type: string; text?: string }> }>;

export function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is ContentBlock => Boolean(part) && typeof part === "object")
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

function extractToolCalls(content: unknown, chars: number): string[] {
	if (!Array.isArray(content)) return [];
	const output: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const block = part as ContentBlock;
		if (block.type !== "toolCall" || typeof block.name !== "string") continue;
		output.push(`- ${block.name}(${JSON.stringify(block.arguments ?? {}).slice(0, chars)})`);
	}
	return output;
}

function boundedHeadTail(text: string, chars: number): string {
	if (chars <= 0) return "";
	if (text.length <= chars) return text;
	const marker = " … ";
	if (chars <= marker.length) return text.slice(-chars);
	const contentChars = chars - marker.length;
	const tailChars = Math.ceil(contentChars * 2 / 3);
	return `${text.slice(0, contentChars - tailChars)}${marker}${text.slice(-tailChars)}`;
}

function fitNewestSection(heading: string, lines: string[], budget: number): string | undefined {
	if (lines.length === 0 || budget <= 0) return undefined;
	const fullLinesLength = lines.reduce((sum, line) => sum + line.length, Math.max(0, lines.length - 1));
	const headingRemainder = budget - heading.length - 1;
	const includeHeading = headingRemainder >= fullLinesLength;
	let remaining = includeHeading ? headingRemainder : budget;
	const selected: string[] = [];
	for (let index = lines.length - 1; index >= 0 && remaining > 0; index--) {
		const separator = selected.length > 0 ? 1 : 0;
		if (remaining <= separator) break;
		const line = boundedHeadTail(lines[index], remaining - separator);
		if (!line) break;
		selected.unshift(line);
		remaining -= line.length + separator;
	}
	if (selected.length === 0) return undefined;
	return includeHeading ? `${heading}\n${selected.join("\n")}` : selected.join("\n");
}

function proportionalAllocation(desired: number[], budget: number): number[] {
	const allocation = desired.map(() => 0);
	const active = desired.map((value, index) => ({ value, index })).filter(({ value }) => value > 0);
	if (budget <= 0 || active.length === 0) return allocation;
	if (budget < active.length) {
		for (const { index } of active.slice(0, budget)) allocation[index] = 1;
		return allocation;
	}
	const total = active.reduce((sum, { value }) => sum + value, 0);
	if (total <= budget) return desired.slice();
	for (const { value, index } of active) allocation[index] = Math.max(1, Math.floor(value / total * budget));
	while (allocation.reduce((sum, value) => sum + value, 0) > budget) {
		const index = allocation.reduce((largest, value, candidate) => value > allocation[largest] ? candidate : largest, 0);
		if (allocation[index] <= 1) break;
		allocation[index]--;
	}
	while (allocation.reduce((sum, value) => sum + value, 0) < budget) {
		const next = active.find(({ value, index }) => allocation[index] < value);
		if (!next) break;
		allocation[next.index]++;
	}
	return allocation;
}

export function buildTranscript(entries: Entry[], config: RecapConfig, liveLines: string[] = []): string {
	const limits = config.transcript;
	const userIndexes: number[] = [];
	for (let index = 0; index < entries.length; index++) {
		if (entries[index].type === "message" && entries[index].message?.role === "user") userIndexes.push(index);
	}
	const lastUserIndex = userIndexes.at(-1) ?? -1;
	const currentUser = lastUserIndex >= 0
		? boundedHeadTail(extractText(entries[lastUserIndex].message?.content).trim(), limits.userChars)
		: "";
	const framing: string[] = [];

	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if ((entry.type === "compaction" || entry.type === "branch_summary") && entry.summary?.trim()) {
			framing.push(`Session summary so far: ${boundedHeadTail(entry.summary.trim(), limits.compactionSummaryChars)}`);
			break;
		}
	}

	const earlier = userIndexes.slice(0, -1).slice(-limits.earlierUserPrompts);
	const earlierLines = earlier
		.map((index) => boundedHeadTail(extractText(entries[index].message?.content).trim(), limits.earlierPromptChars))
		.filter(Boolean)
		.map((text) => `- ${text}`);
	if (earlierLines.length) framing.push("Earlier user prompts:", ...earlierLines);

	const recent = lastUserIndex >= 0 ? entries.slice(lastUserIndex + 1) : entries;
	const detail: string[] = [];
	for (const entry of recent) {
		if (entry.type !== "message" || !entry.message?.role) continue;
		const text = extractText(entry.message.content).trim();
		if (entry.message.role === "assistant") {
			if (text) detail.push(`Assistant: ${boundedHeadTail(text, limits.assistantChars)}`);
			detail.push(...extractToolCalls(entry.message.content, limits.toolArgumentsChars));
		}
		if (entry.message.role === "toolResult" && text) {
			detail.push(`Result(${entry.message.toolName ?? "tool"}): ${boundedHeadTail(text, limits.toolResultChars)}`);
		}
	}

	const sections = [
		{ order: 1, heading: "Current user request:", lines: currentUser ? [currentUser] : [], reserve: limits.currentUserReserveChars },
		{ order: 2, heading: "Recent activity (since the user's last message):", lines: detail, reserve: limits.persistedReserveChars },
		{ order: 3, heading: "Live in-memory activity (may not be persisted yet):", lines: liveLines, reserve: 0 },
	];
	const present = sections.filter(({ lines }) => lines.length > 0);
	const full = present.map(({ heading, lines }) => fitNewestSection(heading, lines, limits.totalChars)?.length ?? 0);
	const separatorChars = Math.max(0, present.length - 1);
	const contentBudget = Math.max(0, limits.totalChars - separatorChars);

	// Protect the current request and newest persisted evidence before live state can
	// consume scarce space. Live state then outranks older framing, but remains capped.
	const desiredReserves = present.map(({ order, reserve }, index) =>
		order === 3 ? 0 : Math.min(reserve, full[index]));
	const allocation = proportionalAllocation(desiredReserves, contentBudget);
	let remaining = contentBudget - allocation.reduce((sum, value) => sum + value, 0);
	const liveIndex = present.findIndex((section) => section.order === 3);
	if (liveIndex >= 0 && remaining > 0) {
		const liveAllocation = Math.min(full[liveIndex], limits.liveMaxChars, remaining);
		allocation[liveIndex] = liveAllocation;
		remaining -= liveAllocation;
	}

	for (const order of [2, 1]) {
		const index = present.findIndex((section) => section.order === order);
		if (index < 0 || remaining <= 0) continue;
		const extra = Math.min(full[index] - allocation[index], remaining);
		allocation[index] += extra;
		remaining -= extra;
	}

	const selected = present
		.map((section, index) => ({
			order: section.order,
			text: fitNewestSection(section.heading, section.lines, allocation[index]),
		}))
		.filter((section): section is { order: number; text: string } => Boolean(section.text));
	const used = selected.reduce((sum, { text }) => sum + text.length, 0) + Math.max(0, selected.length - 1);
	const framingSeparator = selected.length > 0 ? 1 : 0;
	const framingText = fitNewestSection("Task framing:", framing, limits.totalChars - used - framingSeparator);
	if (framingText) selected.push({ order: 0, text: framingText });
	return selected.sort((left, right) => left.order - right.order).map(({ text }) => text).join("\n");
}

export function hasMeaningfulActivity(entries: Entry[], config: RecapConfig): boolean {
	let lastUserIndex = -1;
	for (let index = entries.length - 1; index >= 0; index--) {
		if (entries[index].type === "message" && entries[index].message?.role === "user") {
			lastUserIndex = index;
			break;
		}
	}
	let words = 0;
	let tools = 0;
	for (const entry of entries.slice(lastUserIndex + 1)) {
		if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
		words += extractText(entry.message.content).split(/\s+/).filter(Boolean).length;
		tools += extractToolCalls(entry.message.content, config.transcript.toolArgumentsChars).length;
	}
	return tools > 0 || words >= config.activity.assistantMinWords;
}

export function recapStateKey(transcript: string): string {
	return createHash("sha256").update(transcript).digest("hex");
}

const TEMPLATE_TOKEN = /{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g;

export function renderTextTemplate(template: string, values: Record<string, string>): string {
	if (/{{{|}}}/.test(template)) throw new Error("template contains an invalid interpolation token");
	const invalid = template.replace(TEMPLATE_TOKEN, "").match(/{{|}}/);
	if (invalid) throw new Error("template contains an invalid interpolation token");
	return template.replace(TEMPLATE_TOKEN, (_token, key: string) => {
		if (!Object.hasOwn(values, key)) throw new Error(`template references unknown value: ${key}`);
		return values[key];
	});
}

function extractJsonObject(text: string): string | undefined {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
	const source = fenced ?? text.trim();
	let start = source.indexOf("{");
	if (start < 0) return undefined;
	let depth = 0;
	let quoted = false;
	let escaped = false;
	for (let index = start; index < source.length; index++) {
		const char = source[index];
		if (quoted) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') quoted = false;
			continue;
		}
		if (char === '"') quoted = true;
		else if (char === "{") depth++;
		else if (char === "}" && --depth === 0) return source.slice(start, index + 1);
	}
	return undefined;
}

export function parseRecapResponse(text: string, reason: RecapReason, config: RecapConfig): string | undefined {
	const compactPlain = (value: string) => value.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
	if (config.response.modes[reason] === "plain") {
		const plain = compactPlain(text);
		return plain ? plain.slice(0, config.response.maxChars) : undefined;
	}
	try {
		const json = extractJsonObject(text);
		if (!json) throw new Error("missing JSON object");
		const parsed = JSON.parse(json) as Record<string, unknown>;
		const values: Record<string, string> = {};
		for (const field of config.response.fields) {
			const value = parsed[field];
			if (value !== undefined && typeof value !== "string") throw new Error(`${field} must be a string`);
			values[field] = compactPlain(value ?? "") || config.response.emptyFieldFallback;
		}
		return renderTextTemplate(config.response.template, values).slice(0, config.response.maxChars);
	} catch {
		return config.response.malformedFallback.slice(0, config.response.maxChars);
	}
}

function splitModel(spec: string): { provider: string; id: string } | undefined {
	const separator = spec.indexOf("/");
	if (separator <= 0 || separator === spec.length - 1) return undefined;
	return { provider: spec.slice(0, separator), id: spec.slice(separator + 1) };
}

export function recapModelCandidates(ctx: RecapContext, config: RecapConfig): Model[] {
	const candidates: Model[] = [];
	for (const spec of config.model.candidates) {
		const candidate = spec === "$active" ? ctx.model : (() => {
			const parsed = splitModel(spec);
			return parsed ? ctx.modelRegistry.find(parsed.provider, parsed.id) : undefined;
		})();
		if (candidate && !candidates.some((item) => item.provider === candidate.provider && item.id === candidate.id)) {
			candidates.push(candidate);
		}
	}
	return candidates;
}

export async function generateRecap(
	transcript: string,
	reason: RecapReason,
	ctx: RecapContext,
	config: RecapConfig,
	signal: AbortSignal | undefined,
	complete: CompleteFunction,
): Promise<string | undefined> {
	let prompt: string;
	try {
		prompt = renderTextTemplate(config.prompts[reason], { transcript });
	} catch (error) {
		console.error(`[session-recap] invalid ${reason} prompt template:`, error);
		return undefined;
	}
	const candidates = recapModelCandidates(ctx, config);
	for (let index = 0; index < candidates.length; index++) {
		const model = candidates[index];
		const hasFallback = index < candidates.length - 1;
		let auth: AuthResult;
		try {
			auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		} catch (error) {
			if (hasFallback && config.model.fallbackOnAuthError) continue;
			return undefined;
		}
		if (!auth.ok) {
			if (hasFallback && config.model.fallbackOnAuthError) continue;
			return undefined;
		}
		try {
			const response = await complete(
				model,
				{
					systemPrompt: config.prompts.system,
					messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
				},
				{
					apiKey: auth.apiKey,
					headers: auth.headers,
					env: auth.env,
					signal,
					reasoning: config.model.reasoning,
					cacheRetention: config.model.cacheRetention,
					maxTokens: config.model.maxTokens,
				},
			);
			const text = response.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join(" ");
			const recap = parseRecapResponse(text, reason, config);
			if (recap) return recap;
		} catch (error) {
			if (signal?.aborted) return undefined;
			if (hasFallback && config.model.fallbackOnCompletionError) continue;
			if (
				config.model.silentUnsupportedApi &&
				error instanceof Error &&
				error.message.startsWith("No API provider registered for api:")
			) return undefined;
			throw error;
		}
	}
	return undefined;
}
