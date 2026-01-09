// @ts-check
"use strict";

const { tileGlyph } = require("./tiles.js");

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
 * @property {number} score
 * @property {number} coins
 * @property {number} lives
 * @property {number} time
 * @property {number} levelIndex
 */

const ENEMY_GLYPH = "GG";

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
	ENEMY_GLYPH,
	getCameraX,
	renderFrame,
	renderViewport,
	renderHud,
};
