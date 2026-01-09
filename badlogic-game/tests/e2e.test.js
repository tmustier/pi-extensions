"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeLevel, createGame, stepGame, renderFrame } = require("../engine.js");

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
