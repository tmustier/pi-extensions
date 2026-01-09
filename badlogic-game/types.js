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
 * @property {number} mushroomScore
 * @property {number} viewportWidth
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
 * @typedef {Object} ItemState
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {boolean} alive
 * @property {boolean} onGround
 */

/**
 * @typedef {Object} ParticleState
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {number} life
 */

/**
 * @typedef {Object} Cue
 * @property {string} text
 * @property {number} ttl
 * @property {boolean} persist
 */

/**
 * @typedef {Object} GameState
 * @property {Level} level
 * @property {() => number} rng
 * @property {Config} config
 * @property {number} tick
 * @property {PlayerState} player
 * @property {EnemyState[]} enemies
 * @property {ItemState[]} items
 * @property {ParticleState[]} particles
 * @property {Cue | null} cue
 * @property {number} cameraX
 * @property {number} score
 * @property {number} coins
 * @property {number} lives
 * @property {number} time
 * @property {number} levelIndex
 * @property {boolean} mushroomSpawned
 * @property {boolean} paused
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

/**
 * @typedef {Object} SaveState
 * @property {number} version
 * @property {{ lines: string[] }} level
 * @property {{ x: number, y: number, vx: number, vy: number, facing: number, size: "small" | "big", invuln: number, dead: boolean }} player
 * @property {{ x: number, y: number, vx: number, vy: number, alive: boolean }[]} enemies
 * @property {{ x: number, y: number, vx: number, vy: number, alive: boolean }[]} items
 * @property {number} score
 * @property {number} coins
 * @property {number} lives
 * @property {number} time
 * @property {number} levelIndex
 * @property {boolean} mushroomSpawned
 */

module.exports = {};
