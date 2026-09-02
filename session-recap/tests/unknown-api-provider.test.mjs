import assert from "node:assert/strict";
import sessionRecap from "../index.ts";

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

const pi = makePi();
sessionRecap(pi);

const branch = [
	{ type: "message", message: { role: "user", content: "Please fix the bridge integration." } },
	{
		type: "message",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "I inspected the integration and prepared the next concrete change." }],
		},
	},
];

const widgets = [];
const notices = [];
const ctx = {
	hasUI: true,
	model: {
		id: "bridge-model",
		name: "Bridge model",
		api: "claude-bridge",
		provider: "bridge",
		baseUrl: "http://localhost.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100_000,
		maxTokens: 4096,
	},
	modelRegistry: {
		getAvailable() {
			return [];
		},
		getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "unused" }),
	},
	sessionManager: {
		getBranch: () => branch,
		buildContextEntries: () => branch,
	},
	ui: {
		setStatus() {},
		notify(...args) {
			notices.push(args);
		},
		setWidget(...args) {
			widgets.push(args);
		},
		theme: {
			fg(_name, text) {
				return text;
			},
			bold(text) {
				return text;
			},
		},
	},
};

const errors = [];
const originalConsoleError = console.error;
console.error = (...args) => errors.push(args);
try {
	await pi.commands.get("recap").handler("", ctx);
} finally {
	console.error = originalConsoleError;
}

assert.deepEqual(errors, [], "an extension must not write to the console, which corrupts the TUI frame");
assert.deepEqual(
	notices,
	[],
	"an unknown custom API provider should be skipped without reporting an error",
);
assert.deepEqual(widgets, [], "an unsupported provider should not render an empty recap widget");
console.log("unknown API provider test passed");
