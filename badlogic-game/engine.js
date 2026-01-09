// @ts-check
"use strict";

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
 */

/**
 * @typedef {Object} Level
 * @property {number} width
 * @property {number} height
 * @property {string[]} tiles
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
};

const PLAYER_W = 1;
const PLAYER_H = 1;
const ENEMY_W = 1;
const ENEMY_H = 1;
const ENEMY_GLYPH = "GG";

/** @type {Set<string>} */
const SOLID_TILES = new Set(["#", "B", "?", "U", "T", "P"]);
/** @type {Set<string>} */
const HAZARD_TILES = new Set(["^", "~"]);
/** @type {Record<string, string>} */
const TILE_GLYPHS = {
	"#": "##",
	"B": "[]",
	"?": "??",
	"o": "o ",
	"T": "||",
	"P": "||",
	"G": "|>",
	"^": "/\\",
	"~": "~~",
};

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
		tiles: lines,
	};
}

/** @param {Level} level @returns {{ level: Level, enemies: EnemyState[] }} */
function extractEnemies(level) {
	const tiles = level.tiles.map((row) => row.split(""));
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
			tiles: tiles.map((row) => row.join("")),
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
		player: {
			x: startX,
			y: startY,
			vx: 0,
			vy: 0,
			facing: 1,
			onGround: false,
			dead: false,
		},
		enemies,
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

	resolveVertical(state.level, player, dt);

	for (const enemy of state.enemies) {
		if (!enemy.alive) continue;
		updateEnemy(state.level, enemy, cfg);
	}

	resolveEnemyCollisions(state, prevY);

	if (isHazardAt(state.level, player.x, player.y)) {
		player.dead = true;
	}
	if (player.y >= state.level.height) {
		player.dead = true;
	}

	state.tick += 1;
	return state;
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

/** @param {GameState} state @param {number} prevY */
function resolveEnemyCollisions(state, prevY) {
	const player = state.player;
	const prevBottom = prevY + PLAYER_H;
	const currBottom = player.y + PLAYER_H;
	const falling = currBottom > prevBottom + 0.0001;
	for (const enemy of state.enemies) {
		if (!enemy.alive) continue;
		if (
			overlaps(
				player.x,
				player.y,
				PLAYER_W,
				PLAYER_H,
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
			} else {
				player.dead = true;
			}
		}
	}
}

/**
 * @param {Level} level
 * @param {{ x: number, y: number, vx: number, vy: number, onGround: boolean }} entity
 * @param {number} dt
 */
function resolveVertical(level, entity, dt) {
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
		} else {
			entity.y = nextY;
		}
	}
}

/** @param {number} ax @param {number} ay @param {number} aw @param {number} ah @param {number} bx @param {number} by @param {number} bw @param {number} bh @returns {boolean} */
function overlaps(ax, ay, aw, ah, bx, by, bw, bh) {
	return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/** @param {string} tile @returns {string} */
function tileGlyph(tile) {
	return TILE_GLYPHS[tile] || "  ";
}

/** @param {number} value @param {number} min @param {number} max @returns {number} */
function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

/** @param {GameState} state @param {number} viewportWidth @returns {number} */
function getCameraX(state, viewportWidth) {
	const levelWidth = state.level.width;
	const maxX = Math.max(0, levelWidth - viewportWidth);
	const target = state.player.x + 0.5 - viewportWidth / 2;
	return clamp(target, 0, maxX);
}

/** @param {GameState} state @param {number} viewportWidth @param {number} viewportHeight @returns {string} */
function renderViewport(state, viewportWidth, viewportHeight) {
	const level = state.level;
	const cameraX = getCameraX(state, viewportWidth);
	const rows = [];
	for (let y = 0; y < viewportHeight; y += 1) {
		const row = [];
		for (let x = 0; x < viewportWidth; x += 1) {
			const worldX = Math.floor(cameraX + x);
			const tile =
				worldX >= 0 && worldX < level.width && y >= 0 && y < level.height
					? level.tiles[y][worldX]
					: " ";
			row.push(tileGlyph(tile));
		}
		rows.push(row);
	}
	renderEnemies(rows, state.enemies, cameraX);
	const px = Math.floor(state.player.x - cameraX);
	const py = Math.floor(state.player.y);
	if (py >= 0 && py < viewportHeight && px >= 0 && px < viewportWidth) {
		rows[py][px] = "<>";
	}
	return rows.map((row) => row.join("")).join("\n");
}

/** @param {GameState} state @returns {string} */
function renderFrame(state) {
	const level = state.level;
	const rows = [];
	for (let y = 0; y < level.height; y += 1) {
		const row = [];
		for (let x = 0; x < level.width; x += 1) {
			const tile = level.tiles[y][x];
			row.push(tileGlyph(tile));
		}
		rows.push(row);
	}
	renderEnemies(rows, state.enemies, 0);
	const px = Math.floor(state.player.x);
	const py = Math.floor(state.player.y);
	if (py >= 0 && py < level.height && px >= 0 && px < level.width) {
		rows[py][px] = "<>";
	}
	return rows.map((row) => row.join("")).join("\n");
}

/** @param {string[][]} rows @param {EnemyState[]} enemies @param {number} offsetX */
function renderEnemies(rows, enemies, offsetX) {
	const height = rows.length;
	const width = rows[0] ? rows[0].length : 0;
	for (const enemy of enemies) {
		if (!enemy.alive) continue;
		const ex = Math.floor(enemy.x - offsetX);
		const ey = Math.floor(enemy.y);
		if (ey >= 0 && ey < height && ex >= 0 && ex < width) {
			rows[ey][ex] = ENEMY_GLYPH;
		}
	}
}

/**
 * @param {GameState} state
 * @returns {{ tick: number, player: { x: number, y: number, vx: number, vy: number, onGround: boolean, facing: number, dead: boolean }, enemies: { x: number, y: number, vx: number, vy: number, alive: boolean }[] }}
 */
function snapshotState(state) {
	return {
		tick: state.tick,
		player: {
			x: round(state.player.x),
			y: round(state.player.y),
			vx: round(state.player.vx),
			vy: round(state.player.vy),
			onGround: state.player.onGround,
			facing: state.player.facing,
			dead: state.player.dead,
		},
		enemies: state.enemies.map((enemy) => ({
			x: round(enemy.x),
			y: round(enemy.y),
			vx: round(enemy.vx),
			vy: round(enemy.vy),
			alive: enemy.alive,
		})),
	};
}

/** @param {Level} level @param {number} x @param {number} y @returns {string} */
function getTile(level, x, y) {
	const tx = Math.floor(x);
	const ty = Math.floor(y);
	if (tx < 0 || tx >= level.width || ty < 0 || ty >= level.height) return " ";
	return level.tiles[ty][tx];
}

/** @param {Level} level @param {number} x @param {number} y @returns {boolean} */
function isHazardAt(level, x, y) {
	return HAZARD_TILES.has(getTile(level, x, y));
}

/** @param {Level} level @param {number} x @param {number} y @returns {boolean} */
function isSolidAt(level, x, y) {
	const tx = Math.floor(x);
	const ty = Math.floor(y);
	if (tx < 0 || tx >= level.width || ty < 0 || ty >= level.height) return true;
	return SOLID_TILES.has(level.tiles[ty][tx]);
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
	getCameraX,
	snapshotState,
};
