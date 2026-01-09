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
	renderHud,
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

test("e2e: tile glyphs render consistently", () => {
	const level = makeLevel([
		" B?oG ",
		"      ",
		"      ",
		"######",
	]);
	const state = createGame({
		level,
		startX: 1,
		startY: 2,
		config: { dt: 1, gravity: 0 },
	});
	state.player.onGround = true;
	const frame = renderFrame(state);
	const expected = fs
		.readFileSync(path.join(__dirname, "fixtures", "story1-glyphs.txt"), "utf8")
		.trimEnd();
	assert.equal(frame, expected);
});

test("e2e: enemy renders with goomba glyph", () => {
	const level = makeLevel([
		"    ",
		"    ",
		" E  ",
		"####",
	]);
	const state = createGame({
		level,
		startX: 3,
		startY: 2,
		config: { dt: 1, gravity: 0 },
	});
	state.player.onGround = true;
	const frame = renderFrame(state);
	const expected = fs
		.readFileSync(path.join(__dirname, "fixtures", "story2-enemy.txt"), "utf8")
		.trimEnd();
	assert.equal(frame, expected);
});

test("e2e: hud shows score and coins", () => {
	const level = makeLevel([
		"    ",
		"    ",
		" o  ",
		"####",
	]);
	const state = createGame({
		level,
		startX: 1,
		startY: 2,
		config: { dt: 1, gravity: 0 },
	});
	state.player.onGround = true;
	stepGame(state, {});
	const hud = renderHud(state, 30)
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n");
	const expected = fs
		.readFileSync(path.join(__dirname, "fixtures", "story3-hud.txt"), "utf8")
		.trimEnd();
	assert.equal(hud, expected);
});
