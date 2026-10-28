import assert from "node:assert/strict";
import test from "node:test";
import { registerApiProvider } from "@earendil-works/pi-ai/compat";
import sessionRecap from "../index.ts";

const calls = [];
for (const api of ["openai-responses", "openai-codex-responses"]) {
	const stream = (model) => {
		calls.push(model);
		return {
			result: async () => ({
				role: "assistant",
				content: [{ type: "text", text: "Recap text." }],
				stopReason: "stop",
			}),
		};
	};
	registerApiProvider({ api, stream, streamSimple: stream });
}

for (const api of ["openai-responses", "openai-codex-responses"]) {
	for (const baseUrl of ["https://api.enterprise.githubcopilot.com", undefined]) {
		test(`${api} recap ${baseUrl ? "uses the auth endpoint" : "preserves the model endpoint without an override"}`, async () => {
			const flags = new Map();
			const commands = new Map();
			sessionRecap({
				on() {},
				registerFlag: (name, options) => flags.set(name, options.default),
				getFlag: (name) => flags.get(name),
				registerCommand: (name, command) => commands.set(name, command),
			});

			const model = Object.freeze({
				id: "gpt-recap-test",
				name: "Recap test",
				api,
				provider: "github-copilot",
				baseUrl: "https://api.individual.githubcopilot.com",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100_000,
				maxTokens: 4096,
			});
			const branch = [{ type: "message", message: { role: "user", content: "Recap this task." } }];
			const callCount = calls.length;
			await commands.get("recap").handler("", {
				hasUI: true,
				model,
				modelRegistry: {
					getAvailable: () => [],
					getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "unused", baseUrl }),
				},
				sessionManager: {
					buildSessionProjection: () => ({
						entries: branch.map((sourceEntry) => ({ sourceEntry, messages: [sourceEntry.message] })),
					}),
					getBranch: () => branch,
				},
				ui: {
					setStatus() {},
					setWidget(_key, content) {
						if (typeof content === "function") content({ mode: "regular", children: [] }, this.theme);
					},
					notify(message) { assert.fail(message); },
					theme: { fg: (_name, text) => text, bold: (text) => text },
				},
			});

			assert.equal(calls.length, callCount + 1, "the recap must issue one completion");
			const requestModel = calls.at(-1);
			assert.deepEqual(requestModel, {
				...model,
				baseUrl: baseUrl ?? "https://api.individual.githubcopilot.com",
			});
			assert.equal(model.baseUrl, "https://api.individual.githubcopilot.com", "the registry model must not change");
		});
	}
}
