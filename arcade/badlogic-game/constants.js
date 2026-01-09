// @ts-check
"use strict";

/** @type {import("./types").Config} */
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
	viewportWidth: 40,
};

const SCORE_VALUES = {
	coin: 100,
	stomp: 50,
	mushroom: 1000,
	flagMin: 100,
	flagMax: 5000,
	timeBonus: 10,  // per second remaining
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
const DEATH_WAIT = 1.2;
const DEATH_JUMP_VEL = 8;

/** @type {{ playing: "playing", paused: "paused", dead: "dead", levelClear: "level_clear", gameOver: "game_over" }} */
const GAME_MODES = {
	playing: "playing",
	paused: "paused",
	dead: "dead",
	levelClear: "level_clear",
	gameOver: "game_over",
};

module.exports = {
	DEFAULT_CONFIG,
	SCORE_VALUES,
	PLAYER_W,
	PLAYER_H_SMALL,
	PLAYER_H_BIG,
	ENEMY_W,
	ENEMY_H,
	ITEM_W,
	ITEM_H,
	ITEM_SPEED,
	INVULN_TIME,
	START_LIVES,
	START_TIME,
	DEATH_WAIT,
	DEATH_JUMP_VEL,
	GAME_MODES,
};
