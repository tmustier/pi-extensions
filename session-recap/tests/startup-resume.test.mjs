// Pi reports a session reopened from the command line (`pi -c`, `pi -r`,
// `pi --session <file>`, terminal session restore) as session_start "startup";
// only an in-process switch such as /resume reports "resume". Reopening a
// session with history must draw a recap either way.
import assert from "node:assert/strict";
import test from "node:test";
import { registerApiProvider } from "@earendil-works/pi-ai/compat";
import sessionRecap, { findCurrentSavedRecap } from "../index.ts";

const API = "recap-startup-test";
let requests = 0;

function stubStream() {
	requests++;
	return {
		result: async () => ({
			role: "assistant",
			content: [{ type: "text", text: "Fixing the bridge integration. Next: rerun the suite." }],
			stopReason: "stop",
		}),
	};
}

registerApiProvider({ api: API, stream: stubStream, streamSimple: stubStream });

function makePi() {
	const handlers = new Map();
	const flags = new Map();
	const commands = new Map();
	const saved = [];
	return {
		commands,
		saved,
		appendEntry(customType, data) {
			saved.push({ customType, data });
		},
		emit(event, payload, ctx) {
			for (const handler of handlers.get(event) ?? []) handler(payload, ctx);
		},
		on(event, handler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		registerCommand(name, command) {
			commands.set(name, command);
		},
		registerFlag(name, options) {
			// Keep the test from touching the real terminal's focus reporting.
			flags.set(name, name === "recap-disable-focus" ? true : options.default);
		},
		getFlag(name) {
			return flags.get(name);
		},
	};
}

function makeCtx(branch) {
	const widgets = [];
	const ctx = {
		hasUI: true,
		model: {
			id: "recap-startup-model",
			name: "Recap startup model",
			api: API,
			provider: "recap-startup",
			baseUrl: "http://localhost.invalid",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 100_000,
			maxTokens: 4096,
		},
		modelRegistry: {
			find: () => undefined,
			getAvailable: () => [],
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "unused" }),
		},
		sessionManager: {
			buildSessionProjection: () => ({
				entries: branch.map((sourceEntry) => ({
					sourceEntry,
					messages: sourceEntry.type === "message" ? [sourceEntry.message] : [],
				})),
			}),
			getBranch: () => branch,
		},
		ui: {
			setStatus() {},
			notify() {},
			setWidget(_key, content) {
				if (typeof content === "function") {
					content({ mode: "regular", children: [] }, this.theme);
					return;
				}
				if (content !== undefined) widgets.push(content);
			},
			theme: { fg: (_n, t) => t, bold: (t) => t },
		},
	};
	return { ctx, widgets };
}

const history = [
	{ type: "message", message: { role: "user", content: "Please fix the bridge integration." } },
	{
		type: "message",
		message: {
			role: "assistant",
			content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "bridge.ts" } }],
		},
	},
];

const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

test("reopening a session from the command line draws a recap", async () => {
	requests = 0;
	const pi = makePi();
	sessionRecap(pi);
	const { ctx, widgets } = makeCtx(history);

	pi.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
	await settle();

	assert.equal(requests, 1);
	assert.deepEqual(widgets, [["✦ recap", "Fixing the bridge integration. Next: rerun the suite."]]);
	pi.emit("session_shutdown", { type: "session_shutdown" }, ctx);
});

test("starting a fresh session draws no recap", async () => {
	requests = 0;
	const pi = makePi();
	sessionRecap(pi);
	const { ctx, widgets } = makeCtx([]);

	pi.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
	await settle();

	assert.equal(requests, 0);
	assert.deepEqual(widgets, []);
	pi.emit("session_shutdown", { type: "session_shutdown" }, ctx);
});

test("reopening with an initial prompt draws no recap", async () => {
	requests = 0;
	const pi = makePi();
	sessionRecap(pi);
	const { ctx, widgets } = makeCtx(history);

	// `pi -c "<prompt>"`: the agent starts before the recap timer fires.
	pi.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
	pi.emit("agent_start", { type: "agent_start" }, ctx);
	await settle();

	assert.equal(requests, 0);
	assert.deepEqual(widgets, []);
	pi.emit("session_shutdown", { type: "session_shutdown" }, ctx);
});

const savedRecap = (text) => ({
	type: "custom",
	customType: "session-recap",
	data: { text, model: "recap-startup/recap-startup-model" },
});

test("each drafted recap is saved to the session", async () => {
	requests = 0;
	const pi = makePi();
	sessionRecap(pi);
	const { ctx } = makeCtx(history);

	await pi.commands.get("recap").handler("", ctx);

	assert.deepEqual(pi.saved, [
		{
			customType: "session-recap",
			data: {
				text: "Fixing the bridge integration. Next: rerun the suite.",
				model: "recap-startup/recap-startup-model",
			},
		},
	]);
});

test("a recap drawn while the agent runs is shown but not saved", async () => {
	const pi = makePi();
	sessionRecap(pi);
	const { ctx, widgets } = makeCtx(history);

	pi.emit("agent_start", { type: "agent_start" }, ctx);
	await pi.commands.get("recap").handler("", ctx);

	assert.equal(widgets.length, 1);
	assert.deepEqual(pi.saved, []);
	pi.emit("session_shutdown", { type: "session_shutdown" }, ctx);
});

test("reopening shows the saved recap without a model call when it is current", async () => {
	requests = 0;
	const pi = makePi();
	sessionRecap(pi);
	// Metadata after the recap (a model change, a label) leaves it current.
	const { ctx, widgets } = makeCtx([
		...history,
		savedRecap("Saved recap."),
		{ type: "model_change", provider: "recap-startup", modelId: "recap-startup-model" },
	]);

	pi.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
	await settle();

	assert.equal(requests, 0);
	assert.deepEqual(widgets, [["✦ recap", "Saved recap."]]);
	assert.deepEqual(pi.saved, [], "a reused recap must not be saved again");
	pi.emit("session_shutdown", { type: "session_shutdown" }, ctx);
});

test("reopening drafts a new recap when the conversation moved on", async () => {
	requests = 0;
	const pi = makePi();
	sessionRecap(pi);
	const { ctx, widgets } = makeCtx([
		...history,
		savedRecap("Stale recap."),
		{ type: "message", message: { role: "user", content: "Now update the docs." } },
		{
			type: "message",
			message: {
				role: "assistant",
				content: [{ type: "toolCall", id: "call-2", name: "read", arguments: { path: "README.md" } }],
			},
		},
	]);

	pi.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
	await settle();

	assert.equal(requests, 1);
	assert.deepEqual(widgets, [["✦ recap", "Fixing the bridge integration. Next: rerun the suite."]]);
	assert.equal(pi.saved.length, 1);
	pi.emit("session_shutdown", { type: "session_shutdown" }, ctx);
});

test("a saved recap is current only until the conversation changes", () => {
	const recap = savedRecap("Saved recap.");
	assert.deepEqual(findCurrentSavedRecap([...history, recap]), recap.data);
	assert.deepEqual(
		findCurrentSavedRecap([...history, savedRecap("Older."), recap, { type: "label", targetId: "x" }]),
		recap.data,
		"the latest saved recap wins and metadata does not stale it",
	);
	assert.equal(findCurrentSavedRecap(history), undefined);
	for (const after of [
		{ type: "message", message: { role: "user", content: "More." } },
		{ type: "custom_message", customType: "note", content: "Note." },
		{ type: "compaction", summary: "Summary." },
		{ type: "branch_summary", summary: "Summary." },
		{ type: "context_edit", targetId: "x", replacement: null },
	]) {
		assert.equal(findCurrentSavedRecap([...history, recap, after]), undefined, `${after.type} stales the recap`);
	}
});
