import assert from "node:assert/strict";
import test from "node:test";
import { registerApiProvider } from "@earendil-works/pi-ai/compat";
import sessionRecap from "../index.ts";

test("recap validation rejects a draft when projected context changes", async () => {
	const started = Promise.withResolvers();
	const response = Promise.withResolvers();
	registerApiProvider({
		api: "recap-projection-validation",
		stream: () => {
			throw new Error("unexpected stream path");
		},
		streamSimple: () => ({
			result: async () => {
				started.resolve();
				await response.promise;
				return { role: "assistant", content: [{ type: "text", text: "Stale recap." }] };
			},
		}),
	});

	let recap;
	sessionRecap({
		on() {},
		registerCommand(name, command) {
			if (name === "recap") recap = command.handler;
		},
		registerFlag() {},
		getFlag() {},
	});

	const sourceEntry = {
		type: "message",
		message: { role: "user", content: "Original task", timestamp: 1 },
	};
	let projectedContent = "Original task";
	let widgetUpdates = 0;
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
				entries: [{ sourceEntry, messages: [{ ...sourceEntry.message, content: projectedContent }] }],
			}),
			getBranch: () => [sourceEntry],
		},
		ui: {
			setStatus() {},
			setWidget() {
				widgetUpdates += 1;
			},
			theme: { fg: (_name, text) => text, bold: (text) => text },
		},
	};

	const pending = recap("", ctx);
	await started.promise;
	projectedContent = "Replacement task";
	response.resolve();
	await pending;

	assert.equal(widgetUpdates, 0);
});
