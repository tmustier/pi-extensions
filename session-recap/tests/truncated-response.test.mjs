// pi-ai resolves rather than throws when a stream fails, is aborted, or stops
// at the token cap: `complete`/`completeSimple` hand back the partial assistant
// message built so far, holding whatever text arrived before the cut. Rendering
// that fragment yields a recap of a single dangling word, so each stop reason
// below pins down what reaches the widget.
import assert from "node:assert/strict";
import { registerApiProvider } from "@earendil-works/pi-ai/compat";
import sessionRecap from "../index.ts";

const API = "recap-truncation-test";

let nextResponse;

function stubStream(_model, _context, _options) {
	return { result: async () => nextResponse };
}

registerApiProvider({ api: API, stream: stubStream, streamSimple: stubStream });

function makePi() {
	const commands = new Map();
	const flags = new Map();
	return {
		commands,
		on() {},
		registerCommand(name, command) {
			commands.set(name, command);
		},
		registerFlag(name, options) {
			flags.set(name, options.default);
		},
		getFlag(name) {
			return flags.get(name);
		},
	};
}

const branch = [
	{ type: "message", message: { role: "user", content: "Please fix the bridge integration." } },
	{
		type: "message",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "I inspected the integration and prepared the next change." }],
		},
	},
];

const widgets = [];
const notices = [];

const ctx = {
	hasUI: true,
	model: {
		id: "recap-truncation-model",
		name: "Recap truncation model",
		api: API,
		provider: "recap-truncation",
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
		getBranch: () => branch,
		buildContextEntries: () => branch,
	},
	ui: {
		setStatus() {},
		notify(message, type) {
			notices.push([message, type]);
		},
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

const pi = makePi();
sessionRecap(pi);
const recap = pi.commands.get("recap").handler;

async function run(response) {
	nextResponse = response;
	widgets.length = 0;
	notices.length = 0;
	const consoleWrites = [];
	const originalConsoleError = console.error;
	console.error = (...args) => consoleWrites.push(args);
	try {
		await recap("", ctx);
	} finally {
		console.error = originalConsoleError;
	}
	// Holds for every stop reason, so it is asserted here rather than per case: pi installs
	// no console interception, so text written there reaches the terminal mid-frame and
	// mangles the status bar. Failures belong in a notification.
	assert.deepEqual(consoleWrites, [], "a recap must report through the UI, never the console");
	return { widgets: [...widgets], notices: [...notices] };
}

function message(stopReason, text, extra = {}) {
	return { role: "assistant", content: [{ type: "text", text }], stopReason, ...extra };
}

// A stream that died after the first delta: the message holds one dangling word.
const failed = await run(message("error", "The", { errorMessage: "socket hang up" }));
assert.deepEqual(failed.widgets, [], "a failed stream must not render its partial text as a recap");
assert.equal(failed.notices.length, 1, "a failed stream must be reported once");
assert.match(
	failed.notices[0][0],
	/socket hang up/,
	"the provider's error message should reach the notification",
);
assert.equal(failed.notices[0][1], "error", "a stream failure is an error-level notification");

// An aborted stream is an ordinary cancellation, not a fault: drop it silently.
const aborted = await run(message("aborted", "I"));
assert.deepEqual(aborted.widgets, [], "an aborted stream must not render its partial text");
assert.deepEqual(aborted.notices, [], "an aborted stream is expected and must not be reported");

// Hitting the 256-token cap leaves a sentence cut mid-word.
const capped = await run(message("length", "The next step is to rewrite the bridge adapter so that"));
assert.deepEqual(capped.widgets, [], "a response cut off at the token cap must not be rendered");
assert.deepEqual(capped.notices, [], "overrunning the cap is not an error worth reporting");

// The control: a whole response still reaches the widget.
const complete = await run(message("stop", "Fixing the bridge integration. Next: rerun the suite."));
assert.deepEqual(
	complete.widgets,
	[["✦ recap", "Fixing the bridge integration. Next: rerun the suite."]],
	"a cleanly stopped response should still render",
);
assert.deepEqual(complete.notices, [], "a successful recap must not notify");

console.log("truncated response test passed");
