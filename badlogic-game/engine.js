// @ts-check
"use strict";

const { getTile, setTile, isSolidAt, isHazardAt } = require("./tiles.js");
const { renderFrame, renderViewport, renderHud, getCameraX } = require("./render.js");

/**
 * @typedef {Object} Config
 * @property {number} dt
 * @property {number} gravity
 * @property {number} maxFall
 * @property {number} jumpVel
 * @property {number} walkSpeed
 * @property {number} runSpeed
 * @property {number} groundAccel
 * @property {number} groundDecel
 * @property {number} airAccel
 * @property {number} enemySpeed
 * @property {number} mushroomScore
 */

/**
 * @typedef {Object} Level
 * @property {number} width
 * @property {number} height
 * @property {string[][]} tiles
 */

/**
 * @typedef {Object} PlayerState
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {number} facing
 * @property {boolean} onGround
 * @property {boolean} dead
 * @property {"small" | "big"} size
 * @property {number} invuln
 */

/**
 * @typedef {Object} EnemyState
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {boolean} alive
 * @property {boolean} onGround
 */

/**
 * @typedef {Object} GameState
 * @property {Level} level
 * @property {() => number} rng
 * @property {Config} config
 * @property {number} tick
 * @property {PlayerState} player
 * @property {EnemyState[]} enemies
 * @property {{ x: number, y: number, vx: number, vy: number, alive: boolean, onGround: boolean }[]} items
 * @property {number} score
 * @property {number} coins
 * @property {number} lives
 * @property {number} time
 * @property {number} levelIndex
 * @property {boolean} mushroomSpawned
 */

/**
 * @typedef {Object} InputState
 * @property {boolean} [left]
 * @property {boolean} [right]
 * @property {boolean} [jump]
 * @property {boolean} [run]
 */

/**
 * @typedef {Object} GameOptions
 * @property {Level} level
 * @property {Partial<Config>} [config]
 * @property {number} [seed]
 * @property {number} [startX]
 * @property {number} [startY]
 * @property {number} [levelIndex]
 */

/** @type {Config} */
const DEFAULT_CONFIG = {
	dt: 1 / 60,
	gravity: 22,
	maxFall: 9,
	jumpVel: 12,
	walkSpeed: 3,
	runSpeed: 4.2,
	groundAccel: 35,
	groundDecel: 30,
	airAccel: 22,
	enemySpeed: 1,
	mushroomScore: 1000,
};

const SCORE_VALUES = {
	coin: 100,
	stomp: 50,
	mushroom: 1000,
};

const PLAYER_W = 1;
const PLAYER_H_SMALL = 1;
const PLAYER_H_BIG = 2;
const ENEMY_W = 1;
const ENEMY_H = 1;
const ITEM_W = 1;
const ITEM_H = 1;
const ITEM_SPEED = 1.2;
const INVULN_TIME = 1.2;
const START_LIVES = 3;
const START_TIME = 300;

/** @param {number} seed @returns {() => number} */
function createRng(seed) {
	let t = seed >>> 0;
	return function next() {
		t += 0x6D2B79F5;
		let r = t;
		r = Math.imul(r ^ (r >>> 15), r | 1);
		r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
	};
}

/** @param {string[]} lines @returns {Level} */
function makeLevel(lines) {
	if (!Array.isArray(lines) || lines.length === 0) {
		throw new Error("Level must be a non-empty array of strings.");
	}
	const width = lines[0].length;
	for (const line of lines) {
		if (line.length !== width) {
			throw new Error("All level rows must be the same width.");
		}
	}
	return {
		width,
		height: lines.length,
		tiles: lines.map((line) => line.split("")),
	};
}

/** @param {Level} level @returns {{ level: Level, enemies: EnemyState[] }} */
function extractEnemies(level) {
	const tiles = level.tiles.map((row) => row.slice());
	/** @type {EnemyState[]} */
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

/** @param {GameState} state @param {InputState} [input] @returns {GameState} */
function stepGame(state, input) {
	const cfg = state.config;
	const dt = cfg.dt;
	const moveLeft = !!(input && input.left);
	const moveRight = !!(input && input.right);
	const jump = !!(input && input.jump);
	const run = !!(input && input.run);
	const player = state.player;
	const prevY = player.y;

	if (player.dead) {
		state.tick += 1;
		return state;
	}

	if (player.invuln > 0) {
		player.invuln = Math.max(0, player.invuln - dt);
	}

	let move = 0;
	if (moveLeft) move -= 1;
	if (moveRight) move += 1;
	if (move !== 0) player.facing = move;

	const accel = player.onGround ? cfg.groundAccel : cfg.airAccel;
	const maxSpeed = run ? cfg.runSpeed : cfg.walkSpeed;
	if (move !== 0) {
		const target = move * maxSpeed;
		const delta = accel * dt;
		if (player.vx < target) player.vx = Math.min(player.vx + delta, target);
		else if (player.vx > target) player.vx = Math.max(player.vx - delta, target);
	} else if (player.onGround) {
		const delta = cfg.groundDecel * dt;
		if (Math.abs(player.vx) <= delta) player.vx = 0;
		else player.vx -= Math.sign(player.vx) * delta;
	}

	if (jump && player.onGround) {
		player.vy = -cfg.jumpVel;
		player.onGround = false;
	}

	player.vy = Math.min(player.vy + cfg.gravity * dt, cfg.maxFall);

	const nextX = player.x + player.vx * dt;
	if (!isSolidAt(state.level, nextX, player.y)) {
		player.x = nextX;
	} else {
		player.vx = 0;
	}

	resolveVertical(state.level, player, dt, (tileX, tileY) => {
		handleHeadBump(state, tileX, tileY);
	});

	for (const enemy of state.enemies) {
		if (!enemy.alive) continue;
		updateEnemy(state.level, enemy, cfg);
	}
	updateItems(state.level, state);

	resolveEnemyCollisions(state, prevY);
	collectCoin(state);
	collectItems(state);

	if (isHazardAt(state.level, player.x, player.y)) {
		applyPlayerDamage(state);
	}
	if (player.y >= state.level.height) {
		applyPlayerDamage(state, true);
	}

	state.time = Math.max(0, state.time - dt);
	state.tick += 1;
	return state;
}

/** @param {GameState} state */
function collectCoin(state) {
	if (state.player.dead) return;
	const tileX = Math.floor(state.player.x);
	const tileY = Math.floor(state.player.y);
	if (getTile(state.level, tileX, tileY) === "o") {
		setTile(state.level, tileX, tileY, " ");
		awardCoin(state);
	}
}

/** @param {GameState} state @param {number} tileX @param {number} tileY */
function handleHeadBump(state, tileX, tileY) {
	const tile = getTile(state.level, tileX, tileY);
	if (tile === "?") {
		setTile(state.level, tileX, tileY, "U");
		if (!state.mushroomSpawned) {
			spawnMushroom(state, tileX, tileY);
			state.mushroomSpawned = true;
		} else {
			awardCoin(state);
		}
	}
}

/** @param {GameState} state */
function collectItems(state) {
	if (state.player.dead) return;
	const items = state.items;
	const player = state.player;
	const collected = [];
	for (let i = 0; i < items.length; i += 1) {
		const item = items[i];
		if (!item.alive) continue;
		if (overlaps(player.x, player.y, PLAYER_W, getPlayerHeight(player), item.x, item.y, ITEM_W, ITEM_H)) {
			collected.push(i);
			if (player.size === "small") {
				player.size = /** @type {"small" | "big"} */ ("big");
				player.invuln = INVULN_TIME;
			} else {
				awardScore(state, SCORE_VALUES.mushroom);
			}
		}
	}
	for (let i = collected.length - 1; i >= 0; i -= 1) {
		items.splice(collected[i], 1);
	}
}

/** @param {GameState} state @param {number} tileX @param {number} tileY */
function spawnMushroom(state, tileX, tileY) {
	const spawnX = tileX;
	const spawnY = tileY - 1;
	state.items.push({
		x: spawnX,
		y: spawnY,
		vx: ITEM_SPEED,
		vy: 0,
		alive: true,
		onGround: false,
	});
}

/** @param {GameState} state */
function awardCoin(state) {
	state.coins += 1;
	state.score += SCORE_VALUES.coin;
}

/** @param {GameState} state @param {number} value */
function awardScore(state, value) {
	state.score += value;
}

/** @param {Level} level @param {EnemyState} enemy @param {Config} cfg */
function updateEnemy(level, enemy, cfg) {
	const dt = cfg.dt;
	enemy.vy = Math.min(enemy.vy + cfg.gravity * dt, cfg.maxFall);
	const nextX = enemy.x + enemy.vx * dt;
	if (isSolidAt(level, nextX, enemy.y)) {
		enemy.vx = -enemy.vx;
	} else {
		enemy.x = nextX;
	}
	resolveVertical(level, enemy, dt);
}

/** @param {Level} level @param {GameState} state */
function updateItems(level, state) {
	const cfg = state.config;
	for (const item of state.items) {
		if (!item.alive) continue;
		item.vy = Math.min(item.vy + cfg.gravity * cfg.dt, cfg.maxFall);
		const nextX = item.x + item.vx * cfg.dt;
		if (isSolidAt(level, nextX, item.y)) {
			item.vx = -item.vx;
		} else {
			item.x = nextX;
		}
		resolveVertical(level, item, cfg.dt);
	}
}

/** @param {PlayerState} player @returns {number} */
function getPlayerHeight(player) {
	return player.size === "big" ? PLAYER_H_BIG : PLAYER_H_SMALL;
}

/** @param {GameState} state @param {number} prevY */
function resolveEnemyCollisions(state, prevY) {
	const player = state.player;
	const prevBottom = prevY + getPlayerHeight(player);
	const currBottom = player.y + getPlayerHeight(player);
	const falling = currBottom > prevBottom + 0.0001;
	for (const enemy of state.enemies) {
		if (!enemy.alive) continue;
		if (
			overlaps(
				player.x,
				player.y,
				PLAYER_W,
				getPlayerHeight(player),
				enemy.x,
				enemy.y,
				ENEMY_W,
				ENEMY_H
			)
		) {
			const stomp =
				falling &&
				prevBottom <= enemy.y + 0.01 &&
				currBottom >= enemy.y;
			if (stomp) {
				enemy.alive = false;
				player.vy = -state.config.jumpVel * 0.6;
				awardScore(state, SCORE_VALUES.stomp);
			} else {
				applyPlayerDamage(state);
			}
		}
	}
}

/**
 * @param {Level} level
 * @param {{ x: number, y: number, vx: number, vy: number, onGround: boolean }} entity
 * @param {number} dt
 * @param {(tileX: number, tileY: number) => void} [onHeadBump]
 */
function resolveVertical(level, entity, dt, onHeadBump) {
	const nextY = entity.y + entity.vy * dt;
	if (entity.vy >= 0) {
		if (isSolidAt(level, entity.x, nextY + 1)) {
			const footY = Math.floor(nextY + 1);
			entity.y = footY - 1;
			entity.vy = 0;
			entity.onGround = true;
		} else {
			entity.y = nextY;
			entity.onGround = false;
		}
	} else {
		if (isSolidAt(level, entity.x, nextY)) {
			const headY = Math.floor(nextY);
			entity.y = headY + 1;
			entity.vy = 0;
			if (onHeadBump) onHeadBump(Math.floor(entity.x), headY);
		} else {
			entity.y = nextY;
		}
	}
}

/** @param {number} ax @param {number} ay @param {number} aw @param {number} ah @param {number} bx @param {number} by @param {number} bw @param {number} bh @returns {boolean} */
function overlaps(ax, ay, aw, ah, bx, by, bw, bh) {
	return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/** @param {GameState} state @param {boolean} [forceDeath] */
function applyPlayerDamage(state, forceDeath) {
	const player = state.player;
	if (player.invuln > 0) return;
	if (!forceDeath && player.size === "big") {
		player.size = /** @type {"small" | "big"} */ ("small");
		player.invuln = INVULN_TIME;
		return;
	}
	player.dead = true;
}

/**
 * @param {GameState} state
 * @returns {{ tick: number, score: number, coins: number, lives: number, time: number, levelIndex: number, mushroomSpawned: boolean, player: { x: number, y: number, vx: number, vy: number, onGround: boolean, facing: number, dead: boolean, size: "small" | "big", invuln: number }, enemies: { x: number, y: number, vx: number, vy: number, alive: boolean }[], items: { x: number, y: number, vx: number, vy: number, alive: boolean, onGround: boolean }[] }}
 */
function snapshotState(state) {
	return {
		tick: state.tick,
		score: state.score,
		coins: state.coins,
		lives: state.lives,
		time: round(state.time),
		levelIndex: state.levelIndex,
		mushroomSpawned: state.mushroomSpawned,
		player: {
			x: round(state.player.x),
			y: round(state.player.y),
			vx: round(state.player.vx),
			vy: round(state.player.vy),
			onGround: state.player.onGround,
			facing: state.player.facing,
			dead: state.player.dead,
			size: state.player.size,
			invuln: round(state.player.invuln),
		},
		enemies: state.enemies.map((enemy) => ({
			x: round(enemy.x),
			y: round(enemy.y),
			vx: round(enemy.vx),
			vy: round(enemy.vy),
			alive: enemy.alive,
		})),
		items: state.items.map((item) => ({
			x: round(item.x),
			y: round(item.y),
			vx: round(item.vx),
			vy: round(item.vy),
			alive: item.alive,
			onGround: item.onGround,
		})),
	};
}

/** @param {number} value @returns {number} */
function round(value) {
	return Math.round(value * 1000) / 1000;
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
	snapshotState,
};
