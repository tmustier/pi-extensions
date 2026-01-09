// @ts-check
"use strict";

const { createRng, makeLevel } = require("./core.js");
const { DEFAULT_CONFIG, START_LIVES, START_TIME } = require("./constants.js");
const { renderFrame, renderViewport, renderHud } = require("./render.js");
const { getCameraX, updateCamera } = require("./camera.js");
const { stepGame, setPaused } = require("./logic.js");
const { saveState, loadState, snapshotState } = require("./state.js");
const { isSolidAt } = require("./tiles.js");

/** @typedef {import("./types").GameState} GameState */
/** @typedef {import("./types").GameOptions} GameOptions */
/** @typedef {import("./types").Level} Level */

/** @param {Level} level @returns {{ level: Level, enemies: import("./types").EnemyState[] }} */
function extractEnemies(level) {
	const tiles = level.tiles.map((row) => row.slice());
	/** @type {import("./types").EnemyState[]} */
	const enemies = [];
	for (let y = 0; y < level.height; y += 1) {
		for (let x = 0; x < level.width; x += 1) {
			if (tiles[y][x] === "E") {
				enemies.push({
					x,
					y,
					vx: -1,
					vy: 0,
					alive: true,
					onGround: false,
				});
				tiles[y][x] = " ";
			}
		}
	}
	return {
		level: {
			width: level.width,
			height: level.height,
			tiles,
		},
		enemies,
	};
}

/** @param {GameOptions} options @returns {GameState} */
function createGame(options) {
	const opts = options || {};
	const level = opts.level;
	if (!level) throw new Error("createGame requires a level.");
	const config = { ...DEFAULT_CONFIG, ...(opts.config || {}) };
	const rng = createRng(opts.seed || 1);
	const startX = typeof opts.startX === "number" ? opts.startX : 1;
	const startY = typeof opts.startY === "number" ? opts.startY : 1;
	const extracted = extractEnemies(level);
	const enemies = extracted.enemies.map((enemy) => {
		const seeded = { ...enemy, vx: -config.enemySpeed };
		seeded.onGround = isSolidAt(extracted.level, seeded.x, seeded.y + 1);
		return seeded;
	});
	/** @type {GameState} */
	const state = {
		level: extracted.level,
		rng,
		config,
		tick: 0,
		score: 0,
		coins: 0,
		lives: START_LIVES,
		time: START_TIME,
		levelIndex: typeof opts.levelIndex === "number" ? opts.levelIndex : 1,
		mushroomSpawned: false,
		paused: false,
		cameraX: 0,
		particles: [],
		cue: null,
		player: {
			x: startX,
			y: startY,
			vx: 0,
			vy: 0,
			facing: 1,
			onGround: false,
			dead: false,
			size: /** @type {"small" | "big"} */ ("small"),
			invuln: 0,
		},
		enemies,
		items: [],
	};
	state.player.onGround = isSolidAt(state.level, startX, startY + 1);
	return state;
}

module.exports = {
	DEFAULT_CONFIG,
	createRng,
	makeLevel,
	createGame,
	stepGame,
	renderFrame,
	renderViewport,
	renderHud,
	getCameraX,
	updateCamera,
	setPaused,
	saveState,
	loadState,
	snapshotState,
};
