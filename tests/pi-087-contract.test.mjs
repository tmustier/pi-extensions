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
	for (const directory of [".", "pi-ralph-wiggum"]) {
		const pkg = packageJson(directory);
		assert.equal(pkg.peerDependencies.typebox, "*", `${directory}/typebox peer`);
		assert.equal(pkg.devDependencies.typebox, "1.3.27", `${directory}/typebox development contract`);
		assert.equal(pkg.dependencies?.typebox, undefined, `${directory}/typebox runtime dependency`);
	}
});

test("0.87 lifecycle handlers wait for final agent settlement", () => {
	const recapPi = capturePi();
	sessionRecap(recapPi);
	assert.equal(recapPi.events.has("agent_end"), false);
	assert.equal(recapPi.events.has("agent_settled"), true);

	const tabPi = capturePi();
	tabStatus(tabPi);
	assert.equal(tabPi.events.has("agent_settled"), true);

	const titles = [];
	const ctx = {
		cwd: "/tmp/project",
		hasUI: true,
		ui: { setTitle: (title) => titles.push(title) },
	};
	tabPi.events.get("session_start")({ reason: "resume" }, ctx);
	assert.match(titles.at(-1), /:✅$/);

	tabPi.events.get("agent_start")({}, ctx);
	tabPi.events.get("tool_call")({ toolName: "bash", input: { command: "git commit -m retry" } }, ctx);
	tabPi.events.get("agent_end")({ messages: [{ role: "assistant", stopReason: "error" }] }, ctx);
	assert.match(titles.at(-1), /:running\.\.\.$/);
	tabPi.events.get("agent_start")({}, ctx);
	tabPi.events.get("agent_end")({ messages: [{ role: "assistant", stopReason: "stop" }] }, ctx);
	tabPi.events.get("agent_settled")({}, ctx);
	assert.match(titles.at(-1), /:✅$/, "commit capture survives an automatic retry before settlement");

	tabPi.events.get("agent_start")({}, ctx);
	tabPi.events.get("agent_end")({ messages: [{ role: "assistant", stopReason: "stop" }] }, ctx);
	tabPi.events.get("agent_settled")({}, ctx);
	assert.match(titles.at(-1), /:🚧$/, "a new user run resets commit capture after settlement");

	tabPi.events.get("agent_start")({}, ctx);
	tabPi.events.get("agent_end")({ messages: [{ role: "assistant", stopReason: "error" }] }, ctx);
	tabPi.events.get("agent_settled")({}, ctx);
	assert.match(titles.at(-1), /:🛑$/);
});
