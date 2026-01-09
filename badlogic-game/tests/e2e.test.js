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
	saveState,
	loadState,
	setPaused,
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
		config: { dt: 1, gravity: 0, viewportWidth: 8 },
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

test("e2e: hud rounds time up", () => {
	const level = makeLevel([
		"    ",
		"    ",
		"    ",
		"####",
	]);
	const state = createGame({
		level,
		startX: 1,
		startY: 2,
		config: { dt: 1, gravity: 0 },
	});
	state.time = 12.1;
	const hud = renderHud(state, 30)
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n");
	const expected = fs
		.readFileSync(path.join(__dirname, "fixtures", "story8-hud-time.txt"), "utf8")
		.trimEnd();
	assert.equal(hud, expected);
});

test("e2e: big player renders tall", () => {
	const level = makeLevel([
		"    ",
		"    ",
		"    ",
		"####",
	]);
	const state = createGame({
		level,
		startX: 1,
		startY: 2,
		config: { dt: 1, gravity: 0 },
	});
	state.player.size = "big";
	state.player.onGround = true;
	const frame = renderFrame(state)
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n");
	const expected = fs
		.readFileSync(path.join(__dirname, "fixtures", "story4-big.txt"), "utf8")
		.trimEnd();
	assert.equal(frame, expected);
});

test("e2e: save + load preserves hud", () => {
	const level = makeLevel([
		"    ",
		" ?  ",
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
	state.player.vy = -1;
	state.player.onGround = false;
	stepGame(state, {});
	const saved = saveState(state);
	const loaded = loadState(saved, { config: { dt: 1, gravity: 0 } });
	assert.ok(loaded);
	const hud = renderHud(loaded, 30)
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n");
	const expected = fs
		.readFileSync(path.join(__dirname, "fixtures", "story5-resume-hud.txt"), "utf8")
		.trimEnd();
	assert.equal(hud, expected);
});

test("e2e: paused cue renders centered", () => {
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
		config: { dt: 1, gravity: 0, viewportWidth: 8 },
	});
	setPaused(state, true);
	const frame = renderViewport(state, 8, 4);
	const expected = fs
		.readFileSync(path.join(__dirname, "fixtures", "story6-paused.txt"), "utf8")
		.trimEnd();
	assert.equal(frame, expected);
});

test("e2e: power up cue overlays", () => {
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
		config: { dt: 1, gravity: 0, viewportWidth: 8 },
	});
	state.cue = { text: "POWER UP", ttl: 1, persist: false };
	const frame = renderViewport(state, 8, 4);
	const expected = fs
		.readFileSync(path.join(__dirname, "fixtures", "story7-powerup.txt"), "utf8")
		.trimEnd();
	assert.equal(frame, expected);
});

test("e2e: particle renders", () => {
	const level = makeLevel([
		"    ",
		"    ",
		"    ",
		"####",
	]);
	const state = createGame({
		level,
		startX: 3,
		startY: 2,
		config: { dt: 1, gravity: 0 },
	});
	state.particles.push({ x: 1, y: 1, vx: 0, vy: 0, life: 1 });
	const frame = renderFrame(state)
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n");
	const expected = fs
		.readFileSync(path.join(__dirname, "fixtures", "story6-particles.txt"), "utf8")
		.trimEnd();
	assert.equal(frame, expected);
});
