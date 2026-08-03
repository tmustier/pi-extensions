export type PendingAwayDrain = {
	pending: boolean;
	shouldSchedule: boolean;
};

export function consumePendingAway(
	pending: boolean,
	focusedOut: boolean,
	automaticEnabled: boolean,
	awayEnabled: boolean,
): PendingAwayDrain {
	return {
		pending: false,
		shouldSchedule: pending && focusedOut && automaticEnabled && awayEnabled,
	};
}

export type LiveRequest = {
	id: number;
	version: number;
	kind: "live" | "manual";
};

export type LiveStateSnapshot = {
	running: boolean;
	startedAt: number;
	activityVersion: number;
	lastRequestedVersion: number;
	lastLiveCompletedAt?: number;
	inFlight?: LiveRequest;
};

/** Pure state machine. Timers and model calls stay in the extension adapter. */
export class LiveRecapState {
	private state: LiveStateSnapshot = {
		running: false,
		startedAt: 0,
		activityVersion: 0,
		lastRequestedVersion: 0,
	};
	private nextId = 1;

	start(now: number): void {
		this.state = {
			running: true,
			startedAt: now,
			activityVersion: 0,
			lastRequestedVersion: 0,
		};
	}

	stop(): LiveRequest | undefined {
		this.state.running = false;
		return this.state.inFlight;
	}

	activity(): number {
		if (!this.state.running) return this.state.activityVersion;
		return ++this.state.activityVersion;
	}

	eligible(now: number, firstMs: number, minIntervalMs: number): boolean {
		if (!this.state.running || this.state.inFlight) return false;
		if (now - this.state.startedAt < firstMs) return false;
		if (this.state.lastLiveCompletedAt !== undefined && now - this.state.lastLiveCompletedAt < minIntervalMs) return false;
		return this.state.activityVersion > this.state.lastRequestedVersion;
	}

	beginLive(now: number, firstMs: number, minIntervalMs: number): LiveRequest | undefined {
		if (!this.eligible(now, firstMs, minIntervalMs)) return undefined;
		const request = { id: this.nextId++, version: this.state.activityVersion, kind: "live" as const };
		this.state.inFlight = request;
		this.state.lastRequestedVersion = request.version;
		return request;
	}

	beginManual(): { request: LiveRequest; replaced?: LiveRequest } {
		const replaced = this.state.inFlight;
		const request = { id: this.nextId++, version: this.state.activityVersion, kind: "manual" as const };
		this.state.inFlight = request;
		return { request, replaced };
	}

	cancel(id?: number): LiveRequest | undefined {
		const request = this.state.inFlight;
		if (!request || (id !== undefined && request.id !== id)) return undefined;
		this.state.inFlight = undefined;
		return request;
	}

	complete(id: number, completedAt?: number, displayed = false): boolean {
		const request = this.state.inFlight;
		if (request?.id !== id) return false;
		this.state.inFlight = undefined;
		if (request.kind === "live" && displayed && completedAt !== undefined) {
			this.state.lastLiveCompletedAt = completedAt;
		}
		return true;
	}

	snapshot(): Readonly<LiveStateSnapshot> {
		return structuredClone(this.state);
	}
}

export type LiveActivityOptions = {
	assistantCharsPerVersion: number;
	toolUpdateCharsPerVersion: number;
	maxEvents: number;
	maxEventChars: number;
	maxRunningTools: number;
	liveAssistantChars: number;
};

/** Invalidates superseded zero-delay work without coupling tests to real timers. */
export class DeferredTriggerState {
	private generation = 0;

	arm(): number {
		return ++this.generation;
	}

	cancel(): void {
		this.generation++;
	}

	consume(generation: number): boolean {
		if (generation !== this.generation) return false;
		this.generation++;
		return true;
	}
}

type ToolActivity = {
	name: string;
	args: string;
	result: string;
	status: "running" | "done" | "error";
	observedLength: number;
	observedTail: string;
	changedSinceDirty: number;
	hasUpdate: boolean;
};

/** Captures streaming state that may not exist in SessionManager.getBranch(). */
export class LiveActivityBuffer {
	private assistant = "";
	private assistantBucket = 0;
	private tools = new Map<string, ToolActivity>();
	private events: string[] = [];
	private readonly options: LiveActivityOptions;

	constructor(options: LiveActivityOptions) {
		this.options = options;
	}

	reset(): void {
		this.assistant = "";
		this.assistantBucket = 0;
		this.tools.clear();
		this.events = [];
	}

	assistantUpdate(text: string): boolean {
		this.assistant = boundedHeadTail(text, this.options.liveAssistantChars);
		if (!text.trim()) return false;
		const bucket = Math.floor(text.length / Math.max(1, this.options.assistantCharsPerVersion));
		if (bucket <= this.assistantBucket && this.assistantBucket !== 0) return false;
		this.assistantBucket = Math.max(1, bucket);
		return true;
	}

	messageEnd(text: string): boolean {
		if (text.trim()) this.push(`Assistant finalized: ${text}`);
		this.assistant = "";
		this.assistantBucket = 0;
		return Boolean(text.trim());
	}

	toolStart(id: string, name: string, args: unknown): boolean {
		const serialized = boundedHeadTail(safeStringify(args), this.options.maxEventChars);
		this.setTool(id, {
			name,
			args: serialized,
			result: "",
			status: "running",
			observedLength: 0,
			observedTail: "",
			changedSinceDirty: 0,
			hasUpdate: false,
		});
		this.push(`Tool started: ${name}(${serialized})`);
		return true;
	}

	toolUpdate(id: string, name: string, partialResult: unknown): boolean {
		const fullText = activityText(partialResult);
		const tail = fullText.slice(-this.options.maxEventChars);
		const existing = this.tools.get(id) ?? emptyToolActivity(name);
		existing.result = boundedHeadTail(fullText, this.options.maxEventChars);
		this.setTool(id, existing);
		if (!existing.hasUpdate) {
			existing.hasUpdate = true;
			existing.observedLength = fullText.length;
			existing.observedTail = tail;
			return true;
		}
		if (existing.observedLength === fullText.length && existing.observedTail === tail) return false;
		existing.changedSinceDirty += changedContentSize(
			existing.observedLength,
			existing.observedTail,
			fullText.length,
			tail,
		);
		existing.observedLength = fullText.length;
		existing.observedTail = tail;
		if (existing.changedSinceDirty < this.options.toolUpdateCharsPerVersion) return false;
		existing.changedSinceDirty %= this.options.toolUpdateCharsPerVersion;
		return true;
	}

	toolEnd(id: string, name: string, result: unknown, isError: boolean): boolean {
		const existing = this.tools.get(id) ?? emptyToolActivity(name);
		existing.result = boundedHeadTail(activityText(result), this.options.maxEventChars);
		existing.status = isError ? "error" : "done";
		const prefix = `Tool ${existing.status}: ${name}${existing.result ? ": " : ""}`;
		this.push(formatPrefixedEvidence(prefix, existing.result, this.options.maxEventChars));
		this.tools.delete(id);
		return true;
	}

	turnEnd(): boolean {
		this.push("Turn finalized.");
		return true;
	}

	runningToolCount(): number {
		return this.tools.size;
	}

	lines(): string[] {
		const lines = [...this.events];
		if (this.assistant.trim()) {
			lines.push(formatPrefixedEvidence("Assistant streaming: ", this.assistant, this.options.maxEventChars));
		}
		for (const tool of this.tools.values()) {
			if (tool.status === "running") lines.push(formatRunningTool(tool, this.options.maxEventChars));
		}
		return lines.slice(-this.options.maxEvents).map((line) => boundedHeadTail(line, this.options.maxEventChars));
	}

	private setTool(id: string, tool: ToolActivity): void {
		const maxRunningTools = this.options.maxRunningTools ?? Number.MAX_SAFE_INTEGER;
		if (!this.tools.has(id) && this.tools.size >= maxRunningTools) {
			const oldestId = this.tools.keys().next().value;
			if (oldestId !== undefined) this.tools.delete(oldestId);
		}
		this.tools.set(id, tool);
	}

	private push(line: string): void {
		this.events.push(boundedHeadTail(line, this.options.maxEventChars));
		if (this.events.length > this.options.maxEvents) this.events.splice(0, this.events.length - this.options.maxEvents);
	}
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

function formatPrefixedEvidence(prefix: string, evidence: string, chars: number): string {
	if (!evidence) return boundedHeadTail(prefix, chars);
	if (prefix.length >= chars) return boundedHeadTail(`${prefix}${evidence}`, chars);
	return `${prefix}${boundedHeadTail(evidence, chars - prefix.length)}`;
}

function formatRunningTool(tool: ToolActivity, chars: number): string {
	const prefix = `Tool running: ${tool.name}`;
	if (!tool.result) return formatPrefixedEvidence(`${prefix}(`, `${tool.args})`, chars);
	const latestPrefix = "; latest: ";
	if (prefix.length + latestPrefix.length >= chars) {
		return boundedHeadTail(`${prefix}${latestPrefix}${tool.result}`, chars);
	}
	const available = chars - prefix.length - latestPrefix.length;
	const argsBudget = tool.args ? Math.floor(available / 3) : 0;
	const args = argsBudget >= 3 ? `(${boundedHeadTail(tool.args, argsBudget - 2)})` : "";
	const resultBudget = available - args.length;
	return `${prefix}${args}${latestPrefix}${boundedHeadTail(tool.result, resultBudget)}`;
}

function emptyToolActivity(name: string): ToolActivity {
	return {
		name,
		args: "",
		result: "",
		status: "running",
		observedLength: 0,
		observedTail: "",
		changedSinceDirty: 0,
		hasUpdate: false,
	};
}

function changedContentSize(previousLength: number, previousTail: string, nextLength: number, nextTail: string): number {
	if (previousLength !== nextLength) return Math.max(1, Math.abs(nextLength - previousLength));
	let changed = 0;
	const length = Math.max(previousTail.length, nextTail.length);
	for (let index = 0; index < length; index++) {
		if (previousTail[index] !== nextTail[index]) changed++;
	}
	return Math.max(1, changed);
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return "[unserializable]";
	}
}

function activityText(value: unknown): string {
	if (typeof value === "string") return value;
	if (value && typeof value === "object") {
		const content = (value as { content?: unknown }).content;
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			return content
				.map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : ""))
				.filter(Boolean)
				.join("\n");
		}
	}
	return safeStringify(value);
}
