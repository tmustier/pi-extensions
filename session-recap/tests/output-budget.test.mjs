// pi-ai caps max_tokens to what fits in the recap model's context window, and
// estimates the request from the usage of the last assistant message in it. The
// recap copies its assistant messages from the session, so in a session larger
// than the recap model's window the main conversation's usage capped the recap
// at a single token: the model stopped at once and the empty draft was dropped.
import assert from "node:assert/strict";
import test from "node:test";
import sessionRecap from "../index.ts";

const branch = [
	{ type: "message", message: { role: "user", content: "Please fix the bridge integration.", timestamp: 1 } },
	{
		type: "message",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "I inspected the integration and prepared the next change." }],
			stopReason: "stop",
			// The main session's context: larger than the recap model's 200k window.
			usage: { input: 0, output: 500, cacheRead: 350_000, cacheWrite: 0, totalTokens: 350_500 },
			timestamp: 2,
		},
	},
];

test("a recap keeps its full output budget in a session larger than the recap model's window", async (t) => {
	let body;
	t.mock.method(globalThis, "fetch", async (_url, init) => {
		body = JSON.parse(String(init.body));
		return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "stop" } }), {
			status: 400,
			headers: { "content-type": "application/json" },
		});
	});

	const flags = new Map();
	const commands = new Map();
	sessionRecap({
		on() {},
		registerFlag: (name, options) => flags.set(name, options.default),
		getFlag: (name) => flags.get(name),
		registerCommand: (name, command) => commands.set(name, command),
	});

	await commands.get("recap").handler("", {
		hasUI: true,
		model: {
			id: "claude-haiku-4-5",
			name: "Claude Haiku 4.5",
			api: "anthropic-messages",
			provider: "anthropic",
			baseUrl: "https://api.anthropic.com",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 200_000,
			maxTokens: 64_000,
		},
		modelRegistry: {
			find: () => undefined,
			getAvailable: () => [],
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "unused" }),
		},
		sessionManager: {
			buildSessionProjection: () => ({
				entries: branch.map((sourceEntry) => ({ sourceEntry, messages: [sourceEntry.message] })),
			}),
			getBranch: () => branch,
		},
		ui: {
			setStatus() {},
			setWidget() {},
			notify() {},
			theme: { fg: (_name, text) => text, bold: (text) => text },
		},
	});

	assert.ok(body, "the recap should have sent a request");
	assert.equal(body.max_tokens, 256);
});
