// @ts-check
"use strict";

const { tileGlyph } = require("./tiles.js");
const { getCameraX } = require("./camera.js");

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
 * @property {number} facing
 * @property {boolean} onGround
 * @property {"small" | "big"} [size]
 * @property {number} [invuln]
 */

/**
 * @typedef {Object} EnemyState
 * @property {number} x
 * @property {number} y
 * @property {boolean} alive
 */

/**
 * @typedef {Object} GameState
 * @property {Level} level
 * @property {PlayerState} player
 * @property {EnemyState[]} enemies
 * @property {ItemState[]} items
 * @property {{ x: number, y: number, life: number }[]} particles
 * @property {{ text: string, ttl: number, persist: boolean } | null} cue
 * @property {{ viewportWidth: number }} config
 * @property {number} cameraX
 * @property {number} tick
 * @property {number} score
 * @property {number} coins
 * @property {number} lives
 * @property {number} time
 * @property {number} levelIndex
 * @property {"small" | "big"} [size]
 */

/**
 * @typedef {Object} ItemState
 * @property {number} x
 * @property {number} y
 * @property {boolean} alive
 */

// Animation frames for entities
const PLAYER_FRAMES_SMALL = ["<>", "><"];
const PLAYER_FRAMES_BIG_HEAD = ["<>", "><"];
const PLAYER_FRAMES_BIG_BODY = ["[]"];
const PLAYER_IDLE_SMALL = "<>";
const PLAYER_IDLE_BIG_HEAD = "<>";
const PLAYER_IDLE_BIG_BODY = "[]";
const PLAYER_JUMP_SMALL = "^^";
const PLAYER_JUMP_BIG_HEAD = "^^";
const PLAYER_JUMP_BIG_BODY = "[]";

const ENEMY_FRAMES = ["@@", "oo", "@@", "OO"];  // wiggling eyes
const ITEM_GLYPH = "%}";  // mushroom: stem + cap
const PARTICLE_GLYPH = "**";

/** @param {GameState} state @returns {string} */
function getPlayerGlyph(state) {
	const player = state.player;
	const tick = state.tick || 0;
	const isMoving = Math.abs(player.vx) > 0.1;
	const inAir = !player.onGround;
	
	// Blink when invulnerable
	if (player.invuln && player.invuln > 0 && Math.floor(tick / 4) % 2 === 0) {
		return "  ";  // invisible during blink
	}
	
	if (player.size === "big") {
		if (inAir) return PLAYER_JUMP_BIG_BODY;
		if (!isMoving) return PLAYER_IDLE_BIG_BODY;
		const frame = Math.floor(tick / 6) % PLAYER_FRAMES_BIG_BODY.length;
		return PLAYER_FRAMES_BIG_BODY[frame];
	} else {
		if (inAir) return PLAYER_JUMP_SMALL;
		if (!isMoving) return PLAYER_IDLE_SMALL;
		const frame = Math.floor(tick / 6) % PLAYER_FRAMES_SMALL.length;
		return PLAYER_FRAMES_SMALL[frame];
	}
}

/** @param {GameState} state @returns {string} */
function getPlayerHeadGlyph(state) {
	const player = state.player;
	const tick = state.tick || 0;
	const isMoving = Math.abs(player.vx) > 0.1;
	const inAir = !player.onGround;
	
	// Blink when invulnerable
	if (player.invuln && player.invuln > 0 && Math.floor(tick / 4) % 2 === 0) {
		return "  ";
	}
	
	if (inAir) return PLAYER_JUMP_BIG_HEAD;
	if (!isMoving) return PLAYER_IDLE_BIG_HEAD;
	const frame = Math.floor(tick / 6) % PLAYER_FRAMES_BIG_HEAD.length;
	return PLAYER_FRAMES_BIG_HEAD[frame];
}

/** @param {EnemyState} enemy @param {number} tick @returns {string} */
function getEnemyGlyph(enemy, tick) {
	// Animate based on position + tick for variety
	const phase = Math.floor(enemy.x * 3 + tick / 8) % ENEMY_FRAMES.length;
	return ENEMY_FRAMES[phase];
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
	renderEnemies(rows, state.enemies, cameraX, state.tick);
	renderItems(rows, state.items, cameraX);
	renderParticles(rows, state.particles, cameraX);
	const px = Math.floor(state.player.x - cameraX);
	const py = Math.floor(state.player.y);
	const playerGlyph = getPlayerGlyph(state);
	if (py >= 0 && py < viewportHeight && px >= 0 && px < viewportWidth) {
		rows[py][px] = playerGlyph;
		if (state.player.size === "big" && py - 1 >= 0) {
			rows[py - 1][px] = getPlayerHeadGlyph(state);
		}
	}
	const rowStrings = rows.map((row) => row.join(""));
	return applyCue(rowStrings, state.cue).join("\n");
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
	renderEnemies(rows, state.enemies, 0, state.tick);
	renderItems(rows, state.items, 0);
	renderParticles(rows, state.particles, 0);
	const px = Math.floor(state.player.x);
	const py = Math.floor(state.player.y);
	const playerGlyph = getPlayerGlyph(state);
	if (py >= 0 && py < level.height && px >= 0 && px < level.width) {
		rows[py][px] = playerGlyph;
		if (state.player.size === "big" && py - 1 >= 0) {
			rows[py - 1][px] = getPlayerHeadGlyph(state);
		}
	}
	const rowStrings = rows.map((row) => row.join(""));
	return applyCue(rowStrings, state.cue).join("\n");
}

/** @param {GameState} state @param {number} width @returns {string} */
function renderHud(state, width) {
	const time = Math.max(0, Math.ceil(state.time));
	const levelIndex = state.levelIndex || 1;
	const line1 = fitLine(`BADLOGIC L${levelIndex} TIME ${time}`, width);
	const line2 = fitLine(
		`SCORE ${padNum(state.score, 6)} COIN ${padNum(state.coins, 2)} LIVES ${state.lives}`,
		width
	);
	return `${line1}\n${line2}`;
}

/** @param {string[][]} rows @param {EnemyState[]} enemies @param {number} offsetX @param {number} [tick] */
function renderEnemies(rows, enemies, offsetX, tick) {
	const height = rows.length;
	const width = rows[0] ? rows[0].length : 0;
	const t = tick || 0;
	for (const enemy of enemies) {
		if (!enemy.alive) continue;
		const ex = Math.floor(enemy.x - offsetX);
		const ey = Math.floor(enemy.y);
		if (ey >= 0 && ey < height && ex >= 0 && ex < width) {
			rows[ey][ex] = getEnemyGlyph(enemy, t);
		}
	}
}

/** @param {string[][]} rows @param {ItemState[]} items @param {number} offsetX */
function renderItems(rows, items, offsetX) {
	const height = rows.length;
	const width = rows[0] ? rows[0].length : 0;
	for (const item of items) {
		if (!item.alive) continue;
		const ix = Math.floor(item.x - offsetX);
		const iy = Math.floor(item.y);
		if (iy >= 0 && iy < height && ix >= 0 && ix < width) {
			rows[iy][ix] = ITEM_GLYPH;
		}
	}
}

/** @param {string[][]} rows @param {{ x: number, y: number, life: number }[]} particles @param {number} offsetX */
function renderParticles(rows, particles, offsetX) {
	const height = rows.length;
	const width = rows[0] ? rows[0].length : 0;
	for (const p of particles) {
		if (p.life <= 0) continue;
		const px = Math.floor(p.x - offsetX);
		const py = Math.floor(p.y);
		if (py >= 0 && py < height && px >= 0 && px < width) {
			rows[py][px] = PARTICLE_GLYPH;
		}
	}
}

/** @param {string[]} rows @param {{ text: string } | null} cue */
function applyCue(rows, cue) {
	if (!cue || !cue.text) return rows;
	const rowIndex = Math.floor(rows.length / 2);
	const row = rows[rowIndex] || "";
	const start = Math.max(0, Math.floor((row.length - cue.text.length) / 2));
	rows[rowIndex] = row.slice(0, start) + cue.text + row.slice(start + cue.text.length);
	return rows;
}

/** @param {string} line @param {number} width @returns {string} */
function fitLine(line, width) {
	if (typeof width !== "number") return line;
	if (line.length >= width) return line.slice(0, width);
	return line.padEnd(width, " ");
}

/** @param {number} value @param {number} length @returns {string} */
function padNum(value, length) {
	return String(value).padStart(length, "0");
}

module.exports = {
	ENEMY_FRAMES,
	ITEM_GLYPH,
	PARTICLE_GLYPH,
	getEnemyGlyph,
	getPlayerGlyph,
	getPlayerHeadGlyph,
	getCameraX,
	renderFrame,
	renderViewport,
	renderHud,
};
