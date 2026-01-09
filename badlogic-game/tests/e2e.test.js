"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
	makeLevel,
	createGame,
	stepGame,
	renderFrame,
	renderViewport,
} = require("../engine.js");

test("e2e: one step right renders expected frame", () => {
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
	const frame = renderFrame(state);
	const expected = fs
		.readFileSync(path.join(__dirname, "fixtures", "story0-frame.txt"), "utf8")
		.trimEnd();
	assert.equal(frame, expected);
});

test("e2e: camera clamps to right edge", () => {
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
	state.player.onGround = true;
	for (let i = 0; i < 3; i += 1) {
		stepGame(state, { right: true });
	}
	const frame = renderViewport(state, 8, 4);
	const expected = fs
		.readFileSync(path.join(__dirname, "fixtures", "story1-camera.txt"), "utf8")
		.trimEnd();
	assert.equal(frame, expected);
});
