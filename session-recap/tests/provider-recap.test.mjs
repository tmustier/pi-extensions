// A recap is drafted and shown for every kind of session, using the session's own
// provider. Which model drafts it is a cost choice, checked with real runs.
import assert from "node:assert/strict";
import test from "node:test";
import { getModels, registerApiProvider } from "@earendil-works/pi-ai/compat";
import sessionRecap from "../index.ts";

const RECAP = "Fixing the bridge integration; next, apply the prepared change.";
const PROVIDERS = ["anthropic", "openai-codex", "openrouter", "google"];

const requests = [];
const stream = (model) => {
	requests.push(model);
	return {
		result: async () => ({ role: "assistant", content: [{ type: "text", text: RECAP }], stopReason: "stop" }),
	};
};
for (const api of new Set(PROVIDERS.flatMap((provider) => getModels(provider).map((model) => model.api)))) {
	registerApiProvider({ api, stream, streamSimple: stream });
}

const branch = [
	{ type: "message", message: { role: "user", content: "Please fix the bridge integration." } },
	{
		type: "message",
		message: { role: "assistant", content: [{ type: "text", text: "I prepared the next change." }] },
	},
];

async function recap(activeModel, available) {
	const flags = new Map();
	const commands = new Map();
	sessionRecap({
		appendEntry() {},
		on() {},
		registerFlag: (name, options) => flags.set(name, options.default),
		getFlag: (name) => flags.get(name),
		registerCommand: (name, command) => commands.set(name, command),
	});

	const shown = [];
	await commands.get("recap").handler("", {
		hasUI: true,
		model: activeModel,
		modelRegistry: {
			find: () => undefined,
			getAvailable: () => available,
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "unused" }),
		},
		sessionManager: {
			getSessionFile: () => undefined,
			buildSessionProjection: () => ({
				entries: branch.map((sourceEntry) => ({ sourceEntry, messages: [sourceEntry.message] })),
			}),
			getBranch: () => branch,
		},
		ui: {
			setStatus() {},
			setWidget(_key, content) {
				if (Array.isArray(content)) shown.push(content.join("\n"));
				if (typeof content === "function") content({ mode: "regular", children: [] }, this.theme);
			},
			notify(message) {
				assert.fail(message);
			},
			theme: { fg: (_name, text) => text, bold: (text) => text },
		},
	});
	return shown;
}

for (const provider of PROVIDERS) {
	const catalog = getModels(provider);
	const activeModel = catalog.at(-1);

	for (const [label, available] of [
		["with the provider's models available", catalog],
		["with no other models available", []],
	]) {
		test(`${provider} sessions get a recap ${label}`, async () => {
			const before = requests.length;
			const shown = await recap(activeModel, available);

			assert.equal(requests.length, before + 1, "the recap must issue one request");
			assert.equal(requests.at(-1).provider, provider, "the recap must stay on the session's provider");
			assert.equal(shown.length, 1, "the recap must be shown");
			assert.match(shown[0], new RegExp(RECAP));
		});
	}
}
