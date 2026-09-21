import assert from "node:assert/strict";
import test from "node:test";
import { registerApiProvider } from "@earendil-works/pi-ai/compat";
import sessionRecap from "../index.ts";

test("recap validation rejects a draft when projected context changes", async () => {
	let releaseResponse;
	let markStarted;
	const started = new Promise((resolve) => {
		markStarted = resolve;
	});
	registerApiProvider({
		api: "recap-projection-validation",
		stream: () => {
			throw new Error("unexpected stream path");
		},
		streamSimple: () => ({
			result: async () => {
				markStarted();
				await new Promise((resolve) => {
					releaseResponse = resolve;
				});
				return { role: "assistant", content: [{ type: "text", text: "Stale recap." }] };
			},
		}),
	});

	const commands = new Map();
	const flags = new Map();
	const pi = {
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
	sessionRecap(pi);

	const sourceEntry = {
		type: "message",
		message: { role: "user", content: "Original task", timestamp: 1 },
	};
	let projectedContent = "Original task";
	const widgets = [];
	const ctx = {
		hasUI: true,
		model: {
			id: "validation-model",
			name: "Validation model",
			api: "recap-projection-validation",
			provider: "validation",
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
				entries: [
					{
						sourceEntry,
						messages: [{ ...sourceEntry.message, content: projectedContent }],
					},
				],
			}),
		},
		ui: {
			setStatus() {},
			setWidget(...args) {
				widgets.push(args);
			},
			theme: { fg: (_name, text) => text, bold: (text) => text },
		},
	};

	const pending = commands.get("recap").handler("", ctx);
	await started;
	projectedContent = "Replacement task";
	releaseResponse();
	await pending;

	assert.deepEqual(widgets, [], "a recap generated from the pre-edit projection must not render");
});
