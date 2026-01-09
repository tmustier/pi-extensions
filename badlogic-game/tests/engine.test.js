"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
	createRng,
	makeLevel,
	createGame,
	stepGame,
	getCameraX,
	snapshotState,
} = require("../engine.js");
const { LEVEL_1_LINES, LEVEL_1_WIDTH, LEVEL_1_HEIGHT } = require("../levels.js");

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

test("brick tiles block movement", () => {
	const level = makeLevel([
		"    ",
		"    ",
		"  B ",
		"####",
	]);
	const state = createGame({
		level,
		startX: 1,
		startY: 2,
		config: { dt: 1, gravity: 0, walkSpeed: 1, runSpeed: 1, groundAccel: 1 },
	});
	state.player.onGround = true;
	stepGame(state, { right: true });
	assert.equal(state.player.x, 1);
});

test("question blocks are solid", () => {
	const level = makeLevel([
		"    ",
		"    ",
		"  ? ",
		"####",
	]);
	const state = createGame({
		level,
		startX: 1,
		startY: 2,
		config: { dt: 1, gravity: 0, walkSpeed: 1, runSpeed: 1, groundAccel: 1 },
	});
	state.player.onGround = true;
	stepGame(state, { right: true });
	assert.equal(state.player.x, 1);
});

test("camera clamps within bounds", () => {
	const level = makeLevel([
		"            ",
		"            ",
		"            ",
		"############",
	]);
	const state = createGame({
		level,
		startX: 1,
		startY: 2,
		config: { dt: 1, gravity: 0 },
	});
	state.player.x = 1;
	assert.equal(getCameraX(state, 8), 0);
	state.player.x = 10;
	assert.equal(getCameraX(state, 8), 4);
});

test("level1 dimensions match spec", () => {
	assert.equal(LEVEL_1_LINES.length, LEVEL_1_HEIGHT);
	assert.equal(LEVEL_1_LINES[0].length, LEVEL_1_WIDTH);
});
