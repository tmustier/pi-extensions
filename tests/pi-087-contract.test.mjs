import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sessionRecap from "../session-recap/index.ts";
import tabStatus from "../tab-status/tab-status.ts";

function capturePi() {
	const events = new Map();
	return {
		events,
		on(name, handler) {
			assert.equal(events.has(name), false, `duplicate ${name} handler in fixture`);
			events.set(name, handler);
		},
		registerCommand() {},
		registerFlag() {},
		getFlag() {},
	};
}

test("0.87 lifecycle handlers use session_start and final agent_settled boundaries", async () => {
	const filesSource = readFileSync(new URL("../files-widget/index.ts", import.meta.url), "utf8");
	assert.doesNotMatch(filesSource, /session_switch|SessionSwitchEvent/);
	assert.match(filesSource, /pi\.on\("session_start"/);

	const recapPi = capturePi();
	sessionRecap(recapPi);
	assert.equal(recapPi.events.has("agent_end"), false);
	assert.equal(recapPi.events.has("agent_settled"), true);

	const tabPi = capturePi();
	tabStatus(tabPi);
	assert.equal(tabPi.events.has("session_switch"), false);
	assert.equal(tabPi.events.has("agent_settled"), true);

	const titles = [];
	const ctx = {
		cwd: "/tmp/project",
		hasUI: true,
		ui: { setTitle: (title) => titles.push(title) },
	};
	await tabPi.events.get("session_start")({ reason: "resume" }, ctx);
	assert.match(titles.at(-1), /:✅$/);

	await tabPi.events.get("agent_start")({}, ctx);
	await tabPi.events.get("tool_call")({ toolName: "bash", input: { command: "git commit -m done" } }, ctx);
	await tabPi.events.get("agent_end")({ messages: [{ role: "assistant", stopReason: "stop" }] }, ctx);
	assert.match(titles.at(-1), /:running\.\.\.$/, "agent_end is not the final done boundary");
	await tabPi.events.get("agent_settled")({}, ctx);
	assert.match(titles.at(-1), /:✅$/, "per-run commit capture survives until settlement");

	await tabPi.events.get("agent_start")({}, ctx);
	await tabPi.events.get("agent_end")({ messages: [{ role: "assistant", stopReason: "error" }] }, ctx);
	assert.match(titles.at(-1), /:running\.\.\.$/);
	await tabPi.events.get("agent_settled")({}, ctx);
	assert.match(titles.at(-1), /:🛑$/, "per-run stop reason survives until settlement");

	await tabPi.events.get("session_shutdown")({}, ctx);
});
