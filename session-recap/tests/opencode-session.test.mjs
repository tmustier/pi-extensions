import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { getModel } from "@earendil-works/pi-ai/compat";
import sessionRecap from "../index.ts";

// OpenCode routes each request by conversation and rejects any request that does not say
// which one it belongs to (https://github.com/tmustier/pi-extensions/issues/133).
function startOpenCodeServer() {
	const server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			if (!req.headers["x-opencode-session"]) {
				res.writeHead(400, { "content-type": "application/json" });
				res.end(JSON.stringify({
					type: "MissingSessionID",
					message: "Request is missing x-opencode-session and cannot be routed efficiently.",
				}));
				return;
			}
			res.writeHead(200, { "content-type": "text/event-stream" });
			const chunk = (delta, finish_reason = null) =>
				`data: ${JSON.stringify({
					id: "chatcmpl-test",
					object: "chat.completion.chunk",
					created: 0,
					model: "deepseek-v4.1-flash",
					choices: [{ index: 0, delta, finish_reason }],
				})}\n\n`;
			res.write(chunk({ role: "assistant", content: "Fixing the recap on OpenCode Go." }));
			res.write(chunk({}, "stop"));
			res.end("data: [DONE]\n\n");
		});
	});
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve(server));
	});
}

test("/recap drafts and saves a recap in an OpenCode Go session", async (t) => {
	const server = await startOpenCodeServer();
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
		...getModel("opencode-go", "deepseek-v4.1-flash"),
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
