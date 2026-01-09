// @ts-check
"use strict";

const { getTile, setTile, isSolidAt, isHazardAt } = require("./tiles.js");
const { updateCamera } = require("./camera.js");
const { spawnParticles, updateParticles, setCue, updateCue } = require("./effects.js");
const {
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
} = require("./constants.js");

/** @typedef {import("./types").GameState} GameState */
/** @typedef {import("./types").InputState} InputState */
/** @typedef {import("./types").PlayerState} PlayerState */
/** @typedef {import("./types").EnemyState} EnemyState */
/** @typedef {import("./types").Level} Level */

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

	if (state.paused) {
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

	updateCamera(state);
	updateParticles(state, dt);
	updateCue(state, dt);

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
				setCue(state, "POWER UP", 0.6, false);
				spawnParticles(state, player.x, player.y - 0.2, 4);
			} else {
				awardScore(state, SCORE_VALUES.mushroom);
				spawnParticles(state, player.x, player.y - 0.2, 4);
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
	spawnParticles(state, state.player.x, state.player.y - 0.2, 4);
}

/** @param {GameState} state @param {number} value */
function awardScore(state, value) {
	state.score += value;
}

/** @param {Level} level @param {EnemyState} enemy @param {import("./types").Config} cfg */
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
				spawnParticles(state, enemy.x, enemy.y - 0.2, 4);
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

/** @param {GameState} state @param {boolean} paused */
function setPaused(state, paused) {
	state.paused = paused;
	if (paused) {
		setCue(state, "PAUSED", 0, true);
	} else if (state.cue && state.cue.persist) {
		state.cue = null;
	}
	return state;
}

module.exports = {
	stepGame,
	setPaused,
};
