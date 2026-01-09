// @ts-check
"use strict";

const LEVEL_1_WIDTH = 160;
const LEVEL_1_HEIGHT = 15;

/** @param {number} width @param {number} height @param {string} fill @returns {string[][]} */
function makeGrid(width, height, fill) {
	return Array.from({ length: height }, () => Array(width).fill(fill));
}

/** @param {string[][]} grid @param {number} x @param {number} y @param {string} tile */
function setTile(grid, x, y, tile) {
	if (y < 0 || y >= grid.length) return;
	if (x < 0 || x >= grid[0].length) return;
	grid[y][x] = tile;
}

/** @param {string[][]} grid @param {number} y @param {number} x0 @param {number} x1 @param {string} tile */
function fillRow(grid, y, x0, x1, tile) {
	for (let x = x0; x <= x1; x += 1) {
		setTile(grid, x, y, tile);
	}
}

/** @returns {string[]} */
function buildLevel1() {
	const grid = makeGrid(LEVEL_1_WIDTH, LEVEL_1_HEIGHT, " ");

	// Ground baseline.
	fillRow(grid, 14, 0, LEVEL_1_WIDTH - 1, "#");

	// Segment 1: flat ground, 3-coin line, low brick step.
	setTile(grid, 6, 10, "o");
	setTile(grid, 7, 10, "o");
	setTile(grid, 8, 10, "o");
	setTile(grid, 20, 13, "B");
	setTile(grid, 21, 13, "B");
	setTile(grid, 22, 12, "B");

	// Segment 2: 1-tile gap, single goomba, question block.
	setTile(grid, 50, 14, " ");
	setTile(grid, 60, 13, "E");
	setTile(grid, 70, 11, "?");

	// Segment 3: pipe, two goombas, brick stack.
	setTile(grid, 90, 13, "T");
	setTile(grid, 91, 13, "T");
	setTile(grid, 90, 14, "P");
	setTile(grid, 91, 14, "P");
	setTile(grid, 100, 13, "E");
	setTile(grid, 106, 13, "E");
	setTile(grid, 110, 13, "B");
	setTile(grid, 110, 12, "B");
	setTile(grid, 112, 13, "B");

	// Segment 4: 2-tile gap, staircase, goal.
	setTile(grid, 130, 14, " ");
	setTile(grid, 131, 14, " ");
	setTile(grid, 140, 13, "B");
	setTile(grid, 141, 13, "B");
	setTile(grid, 141, 12, "B");
	setTile(grid, 142, 13, "B");
	setTile(grid, 142, 12, "B");
	setTile(grid, 142, 11, "B");
	setTile(grid, 143, 13, "B");
	setTile(grid, 143, 12, "B");
	setTile(grid, 143, 11, "B");
	setTile(grid, 143, 10, "B");
	setTile(grid, 158, 13, "G");

	return grid.map((row) => row.join(""));
}

const LEVEL_1_LINES = buildLevel1();

module.exports = {
	LEVEL_1_LINES,
	LEVEL_1_WIDTH,
	LEVEL_1_HEIGHT,
};
