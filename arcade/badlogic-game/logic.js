// @ts-check
"use strict";

const { updateCamera } = require("./camera.js");
const { updateParticles, setCue, updateCue } = require("./effects.js");
const { updateEnemies } = require("./enemies.js");
const { updateItems } = require("./items.js");
const { stepDeath } = require("./death.js");
const {
	applyPlayerDamage,
	checkGoal,
	checkHazard,
	collectCoin,
	collectItems,
	getPlayerHeight,
	resolveEnemyCollisions,
	stepPlayerMovement,
} = require("./player.js");
const { GAME_MODES } = require("./constants.js");

/** @typedef {import("./types").GameState} GameState */
/** @typedef {import("./types").InputState} InputState */

/** @param {GameState} state @param {InputState} [input] @returns {GameState} */
function stepGame(state, input) {
	const dt = state.config.dt;
	if (state.mode === GAME_MODES.dead) {
		return stepDeath(state, dt);
	}
	if (state.mode !== GAME_MODES.playing) {
		state.tick += 1;
		return state;
	}

	const { prevY, height } = stepPlayerMovement(state, input);
	updateEnemies(state);
	updateItems(state);

	resolveEnemyCollisions(state, prevY);
	collectCoin(state);
	collectItems(state);
	checkGoal(state, height);

	if (state.mode === GAME_MODES.playing) {
		if (checkHazard(state)) {
			applyPlayerDamage(state);
		} else if (state.player.y >= state.level.height) {
			applyPlayerDamage(state, true);
		}
	}

	if (state.mode === GAME_MODES.playing) {
		updateCamera(state);
		updateParticles(state, dt);
		updateCue(state, dt);
		state.time = Math.max(0, state.time - dt);
	}

	state.tick += 1;
	return state;
}

/** @param {GameState} state @param {boolean} paused */
function setPaused(state, paused) {
	if (state.mode === GAME_MODES.dead || state.mode === GAME_MODES.gameOver || state.mode === GAME_MODES.levelClear) {
		return state;
	}
	state.mode = paused ? GAME_MODES.paused : GAME_MODES.playing;
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
