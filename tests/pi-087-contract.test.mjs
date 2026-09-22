import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sessionRecap from "../session-recap/index.ts";
import tabStatus from "../tab-status/tab-status.ts";

const PACKAGE_DIRS = [
	".",
	"agent-guidance",
	"arcade",
	"code-actions",
	"files-widget",
	"pi-ralph-wiggum",
	"raw-paste",
	"session-recap",
	"tab-status",
	"usage-extension",
	"weather",
];

function packageJson(directory) {
	return JSON.parse(readFileSync(new URL(`../${directory}/package.json`, import.meta.url), "utf8"));
}

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

test("development contracts pin and typecheck every shipped Pi 0.87 extension", () => {
	const shippedExtensions = new Set();
	for (const directory of PACKAGE_DIRS) {
		const pkg = packageJson(directory);
		for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
			if (name.startsWith("@earendil-works/pi-")) {
				assert.equal(version, "0.87.0", `${directory}/${name}`);
			}
		}
		for (const extension of pkg.pi?.extensions ?? []) {
			if (!extension.endsWith(".ts")) continue;
			const relativePath = extension.replace(/^\.\//, "");
			shippedExtensions.add(directory === "." ? relativePath : `${directory}/${relativePath}`);
		}
	}

	const tsconfig = JSON.parse(readFileSync(new URL("../tsconfig.json", import.meta.url), "utf8"));
	assert.deepEqual(new Set(tsconfig.files), shippedExtensions);
	assert.equal(packageJson(".").dependencies.typebox, "^1.3.27");
	assert.equal(packageJson("pi-ralph-wiggum").dependencies.typebox, "^1.3.27");
	const ralphSource = readFileSync(new URL("../pi-ralph-wiggum/index.ts", import.meta.url), "utf8");
	assert.match(ralphSource, /from "typebox"/);
	assert.doesNotMatch(ralphSource, /@sinclair\/typebox/);
});

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
	await tabPi.events.get("tool_call")({ toolName: "bash", input: { command: "git commit -m retry" } }, ctx);
	await tabPi.events.get("agent_end")({ messages: [{ role: "assistant", stopReason: "error" }] }, ctx);
	assert.match(titles.at(-1), /:running\.\.\.$/, "agent_end is not the final done boundary");
	await tabPi.events.get("agent_start")({}, ctx);
	await tabPi.events.get("agent_end")({ messages: [{ role: "assistant", stopReason: "stop" }] }, ctx);
	await tabPi.events.get("agent_settled")({}, ctx);
	assert.match(titles.at(-1), /:✅$/, "commit capture survives an automatic retry before settlement");

	await tabPi.events.get("agent_start")({}, ctx);
	await tabPi.events.get("tool_call")({ toolName: "bash", input: { command: "git commit -m continuation" } }, ctx);
	await tabPi.events.get("agent_end")({ messages: [{ role: "assistant", stopReason: "stop" }] }, ctx);
	await tabPi.events.get("agent_start")({}, ctx);
	await tabPi.events.get("agent_end")({ messages: [{ role: "assistant", stopReason: "stop" }] }, ctx);
	await tabPi.events.get("agent_settled")({}, ctx);
	assert.match(titles.at(-1), /:✅$/, "commit capture survives a queued continuation before settlement");

	await tabPi.events.get("agent_start")({}, ctx);
	await tabPi.events.get("agent_end")({ messages: [{ role: "assistant", stopReason: "stop" }] }, ctx);
	await tabPi.events.get("agent_settled")({}, ctx);
	assert.match(titles.at(-1), /:🚧$/, "a new user run resets commit capture after settlement");

	await tabPi.events.get("agent_start")({}, ctx);
	await tabPi.events.get("agent_end")({ messages: [{ role: "assistant", stopReason: "error" }] }, ctx);
	await tabPi.events.get("agent_settled")({}, ctx);
	assert.match(titles.at(-1), /:🛑$/, "the final stop reason survives until settlement");

	await tabPi.events.get("session_shutdown")({}, ctx);
});
