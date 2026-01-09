// @ts-check
"use strict";

/**
 * @typedef {Object} Level
 * @property {number} width
 * @property {number} height
 * @property {string[][]} tiles
 */

/** @type {Set<string>} */
const SOLID_TILES = new Set(["#", "B", "?", "U", "T", "P"]);
/** @type {Set<string>} */
const HAZARD_TILES = new Set(["^", "~"]);
/** @type {Record<string, string>} */
const TILE_GLYPHS = {
	"#": "##",
	"B": "[]",
	"?": "??",
	"U": "..",
	"o": "o ",
	"T": "||",
	"P": "||",
	"G": "|>",
	"F": "||",  // flagpole
	"^": "/\\",
	"~": "~~",
};

/** @param {string} tile @returns {string} */
function tileGlyph(tile) {
	return TILE_GLYPHS[tile] || "  ";
}

/** @param {Level} level @param {number} x @param {number} y @returns {string} */
function getTile(level, x, y) {
	const tx = Math.floor(x);
	const ty = Math.floor(y);
	if (tx < 0 || tx >= level.width || ty < 0 || ty >= level.height) return " ";
	return level.tiles[ty][tx];
}

/** @param {Level} level @param {number} x @param {number} y @param {string} tile */
function setTile(level, x, y, tile) {
	const tx = Math.floor(x);
	const ty = Math.floor(y);
	if (tx < 0 || tx >= level.width || ty < 0 || ty >= level.height) return;
	level.tiles[ty][tx] = tile;
}

/** @param {Level} level @param {number} x @param {number} y @returns {boolean} */
function isSolidAt(level, x, y) {
	const tx = Math.floor(x);
	const ty = Math.floor(y);
	if (tx < 0 || tx >= level.width || ty < 0 || ty >= level.height) return true;
	return SOLID_TILES.has(level.tiles[ty][tx]);
}

/** @param {Level} level @param {number} x @param {number} y @returns {boolean} */
function isHazardAt(level, x, y) {
	return HAZARD_TILES.has(getTile(level, x, y));
}

module.exports = {
	SOLID_TILES,
	HAZARD_TILES,
	TILE_GLYPHS,
	tileGlyph,
	getTile,
	setTile,
	isSolidAt,
	isHazardAt,
};
