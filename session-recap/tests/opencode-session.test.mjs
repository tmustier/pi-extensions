import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import sessionRecap from "../index.ts";

test("/recap drafts and saves a recap in an OpenCode Go session", async (t) => {
	// Like OpenCode, reject requests that don't name their session (#133).
	const server = createServer((req, res) => {
		if (!req.headers["x-opencode-session"]) return res.writeHead(400).end();
		const choice = { index: 0, delta: { content: "Fixing the recap on OpenCode Go." }, finish_reason: "stop" };
		res.writeHead(200, { "content-type": "text/event-stream" });
		res.end(`data: ${JSON.stringify({ choices: [choice] })}\n\ndata: [DONE]\n\n`);
	}).listen(0, "127.0.0.1");
	await once(server, "listening");
	t.after(() => server.close());

	const flags = new Map();
	const commands = new Map();
	const saved = [];
	sessionRecap({
		appendEntry: (customType, data) => saved.push({ customType, data }),
		on() {},
		registerFlag: (name, options) => flags.set(name, options.default),
		getFlag: (name) => flags.get(name),
		registerCommand: (name, command) => commands.set(name, command),
	});

	const model = {
		...getBuiltinModel("opencode-go", "deepseek-v4.1-flash"),
		baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
	};
	const branch = [{ type: "message", message: { role: "user", content: "Fix the recap on OpenCode Go." } }];
	const errors = [];
	await commands.get("recap").handler("", {
		hasUI: true,
		model,
		modelRegistry: {
			getAvailable: () => [model],
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-key" }),
		},
		sessionManager: {
			buildSessionProjection: () => ({
				entries: branch.map((sourceEntry) => ({ sourceEntry, messages: [sourceEntry.message] })),
			}),
			getBranch: () => branch,
			getSessionFile: () => undefined,
			getSessionId: () => "session-133",
		},
		ui: {
			setStatus() {},
			setWidget(_key, content) {
				if (typeof content === "function") content({ mode: "regular", children: [] }, this.theme);
			},
			notify: (message) => errors.push(message),
			theme: { fg: (_name, text) => text, bold: (text) => text },
		},
	});

	assert.deepEqual(errors, []);
	assert.deepEqual(saved, [{
		customType: "session-recap",
		data: { text: "Fixing the recap on OpenCode Go.", model: "opencode-go/deepseek-v4.1-flash" },
	}]);
});
