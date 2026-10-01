import assert from "node:assert/strict";
import test from "node:test";
import tabStatus from "../tab-status/tab-status.ts";

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

// Mimics Pi's ExtensionContext after session replacement: every getter calls
// assertActive() and throws the stale-ctx error.
function staleCtx() {
	const boom = () => {
		throw new Error(
			"This extension ctx is stale after session replacement or reload.",
		);
	};
	return {
		get cwd() {
			boom();
		},
		get hasUI() {
			boom();
		},
		get ui() {
			boom();
		},
	};
}

test("stale ctx after session replacement does not throw", () => {
	const pi = capturePi();
	tabStatus(pi);

	assert.doesNotThrow(() => {
		pi.events.get("agent_settled")({}, staleCtx());
	});
});

test("fresh session can still set its title after a stale settlement", () => {
	const pi = capturePi();
	tabStatus(pi);
	const titles = [];
	const freshCtx = {
		cwd: "/tmp/fresh",
		hasUI: true,
		ui: { setTitle: (t) => titles.push(t) },
	};

	pi.events.get("agent_settled")({}, staleCtx());
	assert.doesNotThrow(() => pi.events.get("session_start")({ reason: "new" }, freshCtx));
	assert.match(titles.at(-1), /^pi - fresh:new$/);
});
