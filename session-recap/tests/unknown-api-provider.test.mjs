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

const widgets = [];
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
		getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "unused" }),
	},
	sessionManager: {
		getBranch: () => [
			{ type: "message", message: { role: "user", content: "Please fix the bridge integration." } },
			{
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "I inspected the integration and prepared the next concrete change." }],
				},
			},
		],
	},
	ui: {
		setStatus() {},
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

assert.deepEqual(errors, [], "an unknown custom API provider should be skipped without logging an error");
assert.deepEqual(widgets, [], "an unsupported provider should not render an empty recap widget");
console.log("unknown API provider test passed");
