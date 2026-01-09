"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
	createRng,
	makeLevel,
	createGame,
	stepGame,
	snapshotState,
} = require("../engine.js");

test("rng deterministic", () => {
	const rngA = createRng(123);
	const rngB = createRng(123);
	for (let i = 0; i < 5; i += 1) {
		assert.equal(rngA(), rngB());
	}
});

test("stepGame moves right", () => {
	const level = makeLevel([
		"        ",
		"        ",
		"        ",
		"########",
	]);
	const state = createGame({
		level,
		startX: 1,
		startY: 2,
		config: { dt: 1, gravity: 0 },
	});
	state.player.onGround = true;
	stepGame(state, { right: true });
	assert.ok(state.player.x > 1);
	const snap = snapshotState(state);
	assert.equal(snap.player.onGround, true);
});
