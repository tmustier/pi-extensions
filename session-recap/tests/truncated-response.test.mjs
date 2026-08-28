// pi-ai resolves rather than throws when a stream fails, is aborted, or runs
// into the token cap: `complete`/`completeSimple` hand back the partial
// assistant message built so far, carrying whatever text arrived before the
// cut. A recap must never render that fragment — it is what surfaced recaps of
// a single dangling word such as "I" or "The".
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
	const errors = [];
	const originalConsoleError = console.error;
	console.error = (...args) => errors.push(args);
	try {
		await recap("", ctx);
	} finally {
		console.error = originalConsoleError;
	}
	return { widgets: [...widgets], errors };
}

function message(stopReason, text, extra = {}) {
	return { role: "assistant", content: [{ type: "text", text }], stopReason, ...extra };
}

// A stream that died after the first delta: the message holds one dangling word.
const failed = await run(message("error", "The", { errorMessage: "socket hang up" }));
assert.deepEqual(failed.widgets, [], "a failed stream must not render its partial text as a recap");
assert.equal(failed.errors.length, 1, "a failed stream should be reported once");
assert.match(
	String(failed.errors[0][1]),
	/socket hang up/,
	"the provider's error message should reach the log",
);

// An aborted stream is an ordinary cancellation, not a fault: drop it silently.
const aborted = await run(message("aborted", "I"));
assert.deepEqual(aborted.widgets, [], "an aborted stream must not render its partial text");
assert.deepEqual(aborted.errors, [], "an aborted stream is expected and must not be logged");

// Hitting the 256-token cap leaves a sentence cut mid-word.
const capped = await run(message("length", "The next step is to rewrite the bridge adapter so that"));
assert.deepEqual(capped.widgets, [], "a response cut off at the token cap must not be rendered");
assert.deepEqual(capped.errors, [], "overrunning the cap is not an error worth logging");

// The control: a whole response still reaches the widget.
const complete = await run(message("stop", "Fixing the bridge integration. Next: rerun the suite."));
assert.deepEqual(
	complete.widgets,
	[["✦ recap", "Fixing the bridge integration. Next: rerun the suite."]],
	"a cleanly stopped response should still render",
);
assert.deepEqual(complete.errors, [], "a successful recap must not log");

console.log("truncated response test passed");
