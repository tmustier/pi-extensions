/**
 * Badlogic Platformer - a side-scrolling platformer with half-block pixel graphics
 * Play with /badlogic-game
 * 
 * Uses half-block characters (▀▄█) with fg/bg colors for 2x vertical resolution
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

// Display - internal pixel grid is 2x taller than character grid
const VIEW_COLS = 60;  // Characters wide
const VIEW_ROWS = 24;  // Character rows (= 48 pixel rows)
const PIXEL_H = VIEW_ROWS * 2;  // Pixel height
const TICK_MS = 40;

// Physics (in pixels)
const GRAVITY = 0.32;
const JUMP_VEL = -4.5;
const MOVE_SPEED = 0.35;
const MAX_SPEED = 1.2;
const FRICTION = 0.82;
const MAX_FALL = 2.0;

const PLAYER_W = 6;  // pixels
const PLAYER_H = 8;  // pixels

const INITIAL_LIVES = 3;
const SAVE_TYPE = "badlogic-save-v2";

// Palette indices
const COL_SKY = 0;
const COL_GROUND = 1;
const COL_GRASS = 2;
const COL_BRICK = 3;
const COL_COIN = 4;
const COL_PLAYER1 = 5;
const COL_PLAYER2 = 6;
const COL_ENEMY = 7;
const COL_SPIKE = 8;
const COL_CLOUD = 9;
const COL_GOAL = 10;
const COL_BLACK = 11;
const COL_WATER1 = 12;
const COL_WATER2 = 13;
const COL_SKY2 = 14;

// ANSI 256-color palette
const PALETTE: string[] = [
	"117",  // 0: sky blue
	"94",   // 1: ground brown
	"34",   // 2: grass green
	"130",  // 3: brick orange-brown
	"220",  // 4: coin gold
	"196",  // 5: player red
	"223",  // 6: player skin
	"90",   // 7: enemy purple
	"160",  // 8: spike red
	"255",  // 9: cloud white
	"46",   // 10: goal green
	"16",   // 11: black
	"27",   // 12: water blue
	"33",   // 13: water light blue
	"75",   // 14: sky gradient
];

// Tile types in level data
const T_EMPTY = " ";
const T_GROUND = "#";
const T_BRICK = "B";
const T_COIN = "o";
const T_SPIKE = "^";
const T_GOAL = "G";
const T_PLAYER = "P";
const T_ENEMY = "E";
const T_WATER = "~";

// Pixel sprite data: arrays of [relX, relY, colorIndex]
// Player standing (6x8 pixels)
const SPR_PLAYER_STAND: number[][] = [
	// Head (skin color)
	[1, 0, COL_PLAYER2], [2, 0, COL_PLAYER2], [3, 0, COL_PLAYER2], [4, 0, COL_PLAYER2],
	[1, 1, COL_PLAYER2], [2, 1, COL_PLAYER2], [3, 1, COL_PLAYER2], [4, 1, COL_PLAYER2],
	// Body (red)
	[0, 2, COL_PLAYER1], [1, 2, COL_PLAYER1], [2, 2, COL_PLAYER1], [3, 2, COL_PLAYER1], [4, 2, COL_PLAYER1], [5, 2, COL_PLAYER1],
	[0, 3, COL_PLAYER1], [1, 3, COL_PLAYER1], [2, 3, COL_PLAYER1], [3, 3, COL_PLAYER1], [4, 3, COL_PLAYER1], [5, 3, COL_PLAYER1],
	[1, 4, COL_PLAYER1], [2, 4, COL_PLAYER1], [3, 4, COL_PLAYER1], [4, 4, COL_PLAYER1],
	[1, 5, COL_PLAYER1], [2, 5, COL_PLAYER1], [3, 5, COL_PLAYER1], [4, 5, COL_PLAYER1],
	// Legs (red)
	[1, 6, COL_PLAYER1], [2, 6, COL_PLAYER1], [3, 6, COL_PLAYER1], [4, 6, COL_PLAYER1],
	[0, 7, COL_PLAYER1], [1, 7, COL_PLAYER1], [4, 7, COL_PLAYER1], [5, 7, COL_PLAYER1],
];

const SPR_PLAYER_RUN1: number[][] = [
	[1, 0, COL_PLAYER2], [2, 0, COL_PLAYER2], [3, 0, COL_PLAYER2], [4, 0, COL_PLAYER2],
	[1, 1, COL_PLAYER2], [2, 1, COL_PLAYER2], [3, 1, COL_PLAYER2], [4, 1, COL_PLAYER2],
	[0, 2, COL_PLAYER1], [1, 2, COL_PLAYER1], [2, 2, COL_PLAYER1], [3, 2, COL_PLAYER1], [4, 2, COL_PLAYER1], [5, 2, COL_PLAYER1],
	[0, 3, COL_PLAYER1], [1, 3, COL_PLAYER1], [2, 3, COL_PLAYER1], [3, 3, COL_PLAYER1], [4, 3, COL_PLAYER1], [5, 3, COL_PLAYER1],
	[1, 4, COL_PLAYER1], [2, 4, COL_PLAYER1], [3, 4, COL_PLAYER1], [4, 4, COL_PLAYER1],
	[1, 5, COL_PLAYER1], [2, 5, COL_PLAYER1], [3, 5, COL_PLAYER1], [4, 5, COL_PLAYER1],
	// Running legs - spread
	[0, 6, COL_PLAYER1], [1, 6, COL_PLAYER1], [4, 6, COL_PLAYER1], [5, 6, COL_PLAYER1],
	[-1, 7, COL_PLAYER1], [0, 7, COL_PLAYER1], [5, 7, COL_PLAYER1], [6, 7, COL_PLAYER1],
];

const SPR_PLAYER_RUN2: number[][] = [
	[1, 0, COL_PLAYER2], [2, 0, COL_PLAYER2], [3, 0, COL_PLAYER2], [4, 0, COL_PLAYER2],
	[1, 1, COL_PLAYER2], [2, 1, COL_PLAYER2], [3, 1, COL_PLAYER2], [4, 1, COL_PLAYER2],
	[0, 2, COL_PLAYER1], [1, 2, COL_PLAYER1], [2, 2, COL_PLAYER1], [3, 2, COL_PLAYER1], [4, 2, COL_PLAYER1], [5, 2, COL_PLAYER1],
	[0, 3, COL_PLAYER1], [1, 3, COL_PLAYER1], [2, 3, COL_PLAYER1], [3, 3, COL_PLAYER1], [4, 3, COL_PLAYER1], [5, 3, COL_PLAYER1],
	[1, 4, COL_PLAYER1], [2, 4, COL_PLAYER1], [3, 4, COL_PLAYER1], [4, 4, COL_PLAYER1],
	[1, 5, COL_PLAYER1], [2, 5, COL_PLAYER1], [3, 5, COL_PLAYER1], [4, 5, COL_PLAYER1],
	// Running legs - together
	[1, 6, COL_PLAYER1], [2, 6, COL_PLAYER1], [3, 6, COL_PLAYER1], [4, 6, COL_PLAYER1],
	[1, 7, COL_PLAYER1], [2, 7, COL_PLAYER1], [3, 7, COL_PLAYER1], [4, 7, COL_PLAYER1],
];

const SPR_PLAYER_JUMP: number[][] = [
	[1, 0, COL_PLAYER2], [2, 0, COL_PLAYER2], [3, 0, COL_PLAYER2], [4, 0, COL_PLAYER2],
	[1, 1, COL_PLAYER2], [2, 1, COL_PLAYER2], [3, 1, COL_PLAYER2], [4, 1, COL_PLAYER2],
	// Arms up
	[-1, 2, COL_PLAYER1], [0, 2, COL_PLAYER1], [1, 2, COL_PLAYER1], [2, 2, COL_PLAYER1], [3, 2, COL_PLAYER1], [4, 2, COL_PLAYER1], [5, 2, COL_PLAYER1], [6, 2, COL_PLAYER1],
	[0, 3, COL_PLAYER1], [1, 3, COL_PLAYER1], [2, 3, COL_PLAYER1], [3, 3, COL_PLAYER1], [4, 3, COL_PLAYER1], [5, 3, COL_PLAYER1],
	[1, 4, COL_PLAYER1], [2, 4, COL_PLAYER1], [3, 4, COL_PLAYER1], [4, 4, COL_PLAYER1],
	[1, 5, COL_PLAYER1], [2, 5, COL_PLAYER1], [3, 5, COL_PLAYER1], [4, 5, COL_PLAYER1],
	// Legs tucked
	[0, 6, COL_PLAYER1], [1, 6, COL_PLAYER1], [4, 6, COL_PLAYER1], [5, 6, COL_PLAYER1],
	[0, 7, COL_PLAYER1], [1, 7, COL_PLAYER1], [4, 7, COL_PLAYER1], [5, 7, COL_PLAYER1],
];

// Enemy sprite (6x6 pixels)
const SPR_ENEMY1: number[][] = [
	[1, 0, COL_ENEMY], [2, 0, COL_ENEMY], [3, 0, COL_ENEMY], [4, 0, COL_ENEMY],
	[0, 1, COL_ENEMY], [1, 1, COL_ENEMY], [2, 1, COL_ENEMY], [3, 1, COL_ENEMY], [4, 1, COL_ENEMY], [5, 1, COL_ENEMY],
	[0, 2, COL_ENEMY], [1, 2, COL_BLACK], [2, 2, COL_ENEMY], [3, 2, COL_ENEMY], [4, 2, COL_BLACK], [5, 2, COL_ENEMY],
	[0, 3, COL_ENEMY], [1, 3, COL_ENEMY], [2, 3, COL_ENEMY], [3, 3, COL_ENEMY], [4, 3, COL_ENEMY], [5, 3, COL_ENEMY],
	[1, 4, COL_ENEMY], [2, 4, COL_ENEMY], [3, 4, COL_ENEMY], [4, 4, COL_ENEMY],
	[0, 5, COL_ENEMY], [2, 5, COL_ENEMY], [3, 5, COL_ENEMY], [5, 5, COL_ENEMY],
];

const SPR_ENEMY2: number[][] = [
	[1, 0, COL_ENEMY], [2, 0, COL_ENEMY], [3, 0, COL_ENEMY], [4, 0, COL_ENEMY],
	[0, 1, COL_ENEMY], [1, 1, COL_ENEMY], [2, 1, COL_ENEMY], [3, 1, COL_ENEMY], [4, 1, COL_ENEMY], [5, 1, COL_ENEMY],
	[0, 2, COL_BLACK], [1, 2, COL_ENEMY], [2, 2, COL_ENEMY], [3, 2, COL_ENEMY], [4, 2, COL_ENEMY], [5, 2, COL_BLACK],
	[0, 3, COL_ENEMY], [1, 3, COL_ENEMY], [2, 3, COL_ENEMY], [3, 3, COL_ENEMY], [4, 3, COL_ENEMY], [5, 3, COL_ENEMY],
	[1, 4, COL_ENEMY], [2, 4, COL_ENEMY], [3, 4, COL_ENEMY], [4, 4, COL_ENEMY],
	[1, 5, COL_ENEMY], [2, 5, COL_ENEMY], [3, 5, COL_ENEMY], [4, 5, COL_ENEMY],
];

// Coin sprite (4x4 pixels, animated)
const SPR_COIN1: number[][] = [
	[1, 0, COL_COIN], [2, 0, COL_COIN],
	[0, 1, COL_COIN], [1, 1, COL_COIN], [2, 1, COL_COIN], [3, 1, COL_COIN],
	[0, 2, COL_COIN], [1, 2, COL_COIN], [2, 2, COL_COIN], [3, 2, COL_COIN],
	[1, 3, COL_COIN], [2, 3, COL_COIN],
];

const SPR_COIN2: number[][] = [
	[1, 0, COL_COIN], [2, 0, COL_COIN],
	[1, 1, COL_COIN], [2, 1, COL_COIN],
	[1, 2, COL_COIN], [2, 2, COL_COIN],
	[1, 3, COL_COIN], [2, 3, COL_COIN],
];

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	color: number;
	life: number;
}

interface Entity {
	x: number;
	y: number;
	vx: number;
	vy: number;
	alive: boolean;
	frame: number;
}

interface Cloud {
	x: number;
	y: number;
	w: number;
	h: number;
	speed: number;
}

interface GameState {
	px: number;
	py: number;
	vx: number;
	vy: number;
	onGround: boolean;
	facingRight: boolean;
	jumpHeld: boolean;
	dead: boolean;
	deadTimer: number;
	won: boolean;
	wonTimer: number;
	invincible: number;
	runFrame: number;

	level: number;
	tiles: string[][];
	levelWidth: number;
	enemies: Entity[];
	clouds: Cloud[];
	particles: Particle[];
	cameraX: number;

	score: number;
	coins: number;
	lives: number;
	time: number;

	paused: boolean;
	gameOver: boolean;
	frame: number;
}

// Level definitions (1 tile = 4x4 pixels)
const TILE_SIZE = 4;

const LEVELS: string[][] = [
	[
		"                                                                                                                                                ",
		"                                                                                                                                                ",
		"                                                                                                                                                ",
		"                                                                                                                                                ",
		"                                                                                                                      G                         ",
		"                                                                                                                  #####                         ",
		"                               o   o   o                                              o       o                  ##   ##                        ",
		"                              BBBBBBBBBBB                           BBB              BB       BB       o        ##     ##                       ",
		"                o                                                                   ##         ##     BBB      ##       ##                      ",
		"               BBB       E                     E            E                      ##           ##           ###         ###                    ",
		"P                                                                                 ##             ##    E                                     G  ",
		"################      ###############      ###########    ############    ########                ########################################### ##",
		"################      ###############      ###########    ############    #######################################################################",
		"################~~~~~~###############~~~~~~###########~~~~############~~~~#######################################################################",
	],
	[
		"                                                                                                                                                ",
		"                                                                                                                                                ",
		"                                                                                                                      G                         ",
		"                                                                                                                  #####                         ",
		"                                                                        o   o   o                                ##                             ",
		"                                                                       BBBBBBBBB                         E      ##                              ",
		"                          o       o                                                        o            ###    ##                               ",
		"                         BB       BB              E                 E            E        BB                   ##                               ",
		"           o                                     ###      ^^       ###          ###                           ##                                ",
		"          BBB      E                 ^^                   ####                                    ^^         ##                                 ",
		"P                                   ####    E                           E                        ####       ##                               G  ",
		"###########      ##########        ######  ###    ####         ###     ###     ###      ###     ######    ########################################",
		"###########      ##########        ######  ###    ####         ###     ###     ###      ###     ######    ########################################",
		"###########~~~~~~##########~~~~~~~~######~~###~~~~####~~~~~~~~~###~~~~~###~~~~~###~~~~~~###~~~~~######~~~~########################################",
	],
	[
		"                                                                                                                                                ",
		"                                                                                                                                                ",
		"                                                                                                                                                ",
		"                                                                                                                G                               ",
		"                                                                                          o                  ####                               ",
		"                                                       o   o   o                         BB        E                                            ",
		"                                                      BBBBBBBBB                   E               ###                                           ",
		"                           o                                              E      ###                                                            ",
		"                          BB       E         ^^                 ^^       ###                                                                    ",
		"              o                   ###       ####       E       ####                   E         ^^                                              ",
		"P            BB      E                              ####                            ###        ####                                          G  ",
		"#######     ####    ###       ###      ####       ######    ####      ###      ####      ###  ######    #############################################",
		"#######     ####    ###       ###      ####       ######    ####      ###      ####      ###  ######    #############################################",
		"#######~~~~~####~~~~###~~~~~~~###~~~~~~####~~~~~~~######~~~~####~~~~~~###~~~~~~####~~~~~~###~~######~~~~#############################################",
	],
];

const parseLevel = (n: number): { tiles: string[][], width: number, enemies: Entity[], startX: number, startY: number } => {
	const template = LEVELS[Math.min(n - 1, LEVELS.length - 1)];
	const tiles = template.map(r => r.padEnd(150, " ").split(""));
	const width = tiles[0].length;
	const enemies: Entity[] = [];
	let startX = 1, startY = 10;

	for (let y = 0; y < tiles.length; y++) {
		for (let x = 0; x < tiles[y].length; x++) {
			const c = tiles[y][x];
			if (c === T_PLAYER) {
				startX = x * TILE_SIZE;
				startY = (y + 1) * TILE_SIZE - PLAYER_H;  // feet on ground below
				tiles[y][x] = T_EMPTY;
			} else if (c === T_ENEMY) {
				enemies.push({ x: x * TILE_SIZE, y: y * TILE_SIZE - 2, vx: -0.5, vy: 0, alive: true, frame: 0 });
				tiles[y][x] = T_EMPTY;
			}
		}
	}
	return { tiles, width, enemies, startX, startY };
};

const createClouds = (w: number): Cloud[] => {
	const clouds: Cloud[] = [];
	for (let i = 0; i < 12; i++) {
		clouds.push({
			x: Math.random() * w * TILE_SIZE,
			y: 2 + Math.random() * 10,
			w: 8 + Math.floor(Math.random() * 12),
			h: 3 + Math.floor(Math.random() * 3),
			speed: 0.05 + Math.random() * 0.1,
		});
	}
	return clouds;
};

const createInitialState = (): GameState => {
	const { tiles, width, enemies, startX, startY } = parseLevel(1);
	return {
		px: startX, py: startY,
		vx: 0, vy: 0,
		onGround: false, facingRight: true, jumpHeld: false,
		dead: false, deadTimer: 0, won: false, wonTimer: 0, invincible: 0, runFrame: 0,
		level: 1, tiles, levelWidth: width,
		enemies, clouds: createClouds(width), particles: [],
		cameraX: 0,
		score: 0, coins: 0, lives: INITIAL_LIVES, time: 300,
		paused: false, gameOver: false, frame: 0,
	};
};

const loadLevel = (s: GameState, n: number): void => {
	const { tiles, width, enemies, startX, startY } = parseLevel(n);
	Object.assign(s, {
		level: n, tiles, levelWidth: width, enemies,
		clouds: createClouds(width), particles: [],
		px: startX, py: startY, vx: 0, vy: 0,
		onGround: false, dead: false, deadTimer: 0, won: false, wonTimer: 0,
		cameraX: 0, time: 300,
	});
};

const getTile = (s: GameState, px: number, py: number): string => {
	const tx = Math.floor(px / TILE_SIZE);
	const ty = Math.floor(py / TILE_SIZE);
	if (ty < 0 || ty >= s.tiles.length || tx < 0 || tx >= s.levelWidth) return T_EMPTY;
	return s.tiles[ty]?.[tx] ?? T_EMPTY;
};

const setTile = (s: GameState, px: number, py: number, v: string): void => {
	const tx = Math.floor(px / TILE_SIZE);
	const ty = Math.floor(py / TILE_SIZE);
	if (ty >= 0 && ty < s.tiles.length && tx >= 0 && tx < s.levelWidth) {
		s.tiles[ty][tx] = v;
	}
};

const isSolid = (t: string): boolean => t === T_GROUND || t === T_BRICK;

const spawnParticles = (s: GameState, x: number, y: number, count: number, color: number, spread: number): void => {
	for (let i = 0; i < count; i++) {
		s.particles.push({
			x, y,
			vx: (Math.random() - 0.5) * spread,
			vy: -Math.random() * spread,
			color,
			life: 15 + Math.floor(Math.random() * 10),
		});
	}
};

const killPlayer = (s: GameState): void => {
	if (s.invincible > 0 || s.dead) return;
	s.dead = true;
	s.deadTimer = 50;
	s.vy = -3;
	s.lives--;
	spawnParticles(s, s.px + PLAYER_W / 2, s.py + PLAYER_H / 2, 12, COL_PLAYER1, 3);
};

const updatePlayer = (s: GameState, left: boolean, right: boolean, jump: boolean): void => {
	if (s.dead || s.won) return;

	// Horizontal
	if (left) { s.vx -= MOVE_SPEED; s.facingRight = false; }
	if (right) { s.vx += MOVE_SPEED; s.facingRight = true; }
	s.vx *= FRICTION;
	if (Math.abs(s.vx) < 0.05) s.vx = 0;
	s.vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, s.vx));

	// Animation
	if (Math.abs(s.vx) > 0.2 && s.onGround) {
		s.runFrame = (s.runFrame + 1) % 12;
	} else {
		s.runFrame = 0;
	}

	// Jump
	if (jump && s.onGround && !s.jumpHeld) {
		s.vy = JUMP_VEL;
		s.onGround = false;
		s.jumpHeld = true;
	}
	if (!jump) {
		s.jumpHeld = false;
		if (s.vy < -0.5) s.vy *= 0.7;
	}

	// Gravity
	s.vy += GRAVITY;
	s.vy = Math.min(s.vy, MAX_FALL);

	// Horizontal collision
	const nx = s.px + s.vx;
	let hitX = false;
	const probeX = s.vx > 0 ? nx + PLAYER_W - 1 : nx;
	for (let py = s.py; py < s.py + PLAYER_H; py += TILE_SIZE / 2) {
		if (isSolid(getTile(s, probeX, py))) { hitX = true; break; }
	}
	if (!hitX && nx >= 0) s.px = nx; else s.vx = 0;

	// Vertical collision
	const ny = s.py + s.vy;
	s.onGround = false;
	if (s.vy >= 0) {
		const probeY = ny + PLAYER_H;
		for (let px = s.px; px < s.px + PLAYER_W; px += TILE_SIZE / 2) {
			if (isSolid(getTile(s, px, probeY))) {
				s.py = Math.floor(probeY / TILE_SIZE) * TILE_SIZE - PLAYER_H;
				s.vy = 0;
				s.onGround = true;
				break;
			}
		}
		if (!s.onGround) s.py = ny;
	} else {
		const probeY = ny;
		let headHit = false;
		for (let px = s.px; px < s.px + PLAYER_W; px += TILE_SIZE / 2) {
			const t = getTile(s, px, probeY);
			if (isSolid(t)) {
				headHit = true;
				if (t === T_BRICK) {
					setTile(s, px, probeY, T_EMPTY);
					s.score += 10;
					spawnParticles(s, px, probeY, 6, COL_BRICK, 2);
				}
			}
		}
		if (headHit) s.vy = 0; else s.py = ny;
	}

	// Collect coins
	const cx = s.px + PLAYER_W / 2;
	const cy = s.py + PLAYER_H / 2;
	if (getTile(s, cx, cy) === T_COIN) {
		setTile(s, cx, cy, T_EMPTY);
		s.coins++;
		s.score += 100;
		spawnParticles(s, cx, cy, 8, COL_COIN, 2);
	}

	// Spikes
	const footY = s.py + PLAYER_H;
	if (getTile(s, s.px, footY) === T_SPIKE || getTile(s, s.px + PLAYER_W - 1, footY) === T_SPIKE) {
		killPlayer(s);
	}

	// Water
	if (getTile(s, cx, cy) === T_WATER) {
		killPlayer(s);
	}

	// Fall off
	if (s.py > s.tiles.length * TILE_SIZE + 20) {
		killPlayer(s);
	}

	// Goal
	if (getTile(s, cx, cy) === T_GOAL) {
		s.won = true;
		s.wonTimer = 60;
		s.score += 500 + s.time * 5;
		spawnParticles(s, cx, cy, 20, COL_GOAL, 4);
	}

	if (s.invincible > 0) s.invincible--;
};

const updateEnemies = (s: GameState): void => {
	for (const e of s.enemies) {
		if (!e.alive) continue;
		e.frame++;

		e.vy += GRAVITY * 0.6;
		e.vy = Math.min(e.vy, MAX_FALL);

		// Horizontal
		const nx = e.x + e.vx;
		const probeX = e.vx > 0 ? nx + 5 : nx;
		let hitX = false;
		for (let py = e.y; py < e.y + 6; py += 2) {
			if (isSolid(getTile(s, probeX, py))) { hitX = true; break; }
		}
		if (hitX) e.vx = -e.vx; else e.x = nx;

		// Edge detection
		const aheadX = e.vx > 0 ? e.x + 8 : e.x - 2;
		if (!isSolid(getTile(s, aheadX, e.y + 8))) e.vx = -e.vx;

		// Vertical
		const ny = e.y + e.vy;
		const probeY = ny + 6;
		let onGround = false;
		for (let px = e.x; px < e.x + 6; px += 2) {
			if (isSolid(getTile(s, px, probeY))) { onGround = true; break; }
		}
		if (onGround) { e.y = Math.floor(probeY / TILE_SIZE) * TILE_SIZE - 6; e.vy = 0; }
		else e.y = ny;

		if (e.y > s.tiles.length * TILE_SIZE + 20) e.alive = false;
	}
};

const checkEnemyCollisions = (s: GameState): void => {
	if (s.dead || s.invincible > 0) return;
	for (const e of s.enemies) {
		if (!e.alive) continue;
		// Simple AABB
		if (s.px + PLAYER_W > e.x && s.px < e.x + 6 &&
			s.py + PLAYER_H > e.y && s.py < e.y + 6) {
			// Stomping?
			if (s.vy > 0 && s.py + PLAYER_H < e.y + 4) {
				e.alive = false;
				s.vy = -2;
				s.score += 50;
				spawnParticles(s, e.x + 3, e.y + 3, 8, COL_ENEMY, 2);
			} else {
				killPlayer(s);
			}
		}
	}
};

const updateClouds = (s: GameState): void => {
	for (const c of s.clouds) {
		c.x += c.speed;
		if (c.x > s.levelWidth * TILE_SIZE + 20) c.x = -c.w - 10;
	}
};

const updateParticles = (s: GameState): void => {
	for (const p of s.particles) {
		p.x += p.vx;
		p.y += p.vy;
		p.vy += 0.15;
		p.life--;
	}
	s.particles = s.particles.filter(p => p.life > 0);
};

const updateCamera = (s: GameState): void => {
	const target = s.px - VIEW_COLS * 0.3;
	const maxCam = s.levelWidth * TILE_SIZE - VIEW_COLS;
	const newCam = Math.max(0, Math.min(target, maxCam));
	s.cameraX += (newCam - s.cameraX) * 0.08;
};

// ===== HALF-BLOCK RENDERER =====
// Each character cell represents 2 vertical pixels using ▀ (upper) ▄ (lower) █ (both)

class PixelBuffer {
	width: number;
	height: number;
	pixels: number[];  // Color index per pixel, -1 = transparent

	constructor(w: number, h: number) {
		this.width = w;
		this.height = h;
		this.pixels = new Array(w * h).fill(-1);
	}

	clear(): void {
		this.pixels.fill(-1);
	}

	setPixel(x: number, y: number, color: number): void {
		const ix = Math.floor(x);
		const iy = Math.floor(y);
		if (ix >= 0 && ix < this.width && iy >= 0 && iy < this.height) {
			this.pixels[iy * this.width + ix] = color;
		}
	}

	getPixel(x: number, y: number): number {
		if (x < 0 || x >= this.width || y < 0 || y >= this.height) return -1;
		return this.pixels[y * this.width + x];
	}

	drawSprite(sprite: number[][], x: number, y: number, flipX: boolean = false): void {
		for (const [dx, dy, c] of sprite) {
			const px = flipX ? x + (5 - dx) : x + dx;
			this.setPixel(px, y + dy, c);
		}
	}

	drawRect(x: number, y: number, w: number, h: number, color: number): void {
		for (let py = y; py < y + h; py++) {
			for (let px = x; px < x + w; px++) {
				this.setPixel(px, py, color);
			}
		}
	}

	// Render to half-block string
	render(bgColor: number = COL_SKY): string[] {
		const lines: string[] = [];
		for (let row = 0; row < this.height; row += 2) {
			let line = "";
			for (let col = 0; col < this.width; col++) {
				const top = this.getPixel(col, row);
				const bot = this.getPixel(col, row + 1);
				const topC = top >= 0 ? top : bgColor;
				const botC = bot >= 0 ? bot : bgColor;

				if (topC === botC) {
					// Same color - full block with fg color
					line += `\x1b[38;5;${PALETTE[topC]}m█\x1b[0m`;
				} else {
					// Different - upper half block with fg=top, bg=bot
					line += `\x1b[38;5;${PALETTE[topC]};48;5;${PALETTE[botC]}m▀\x1b[0m`;
				}
			}
			lines.push(line);
		}
		return lines;
	}
}

class BadlogicComponent {
	private state: GameState;
	private buffer: PixelBuffer;
	private interval: ReturnType<typeof setInterval> | null = null;
	private timeInterval: ReturnType<typeof setInterval> | null = null;
	private onClose: () => void;
	private onSave: (s: GameState | null) => void;
	private tui: { requestRender: () => void };

	private leftHeld = false;
	private rightHeld = false;
	private jumpHeld = false;
	private releaseTimers: Record<string, ReturnType<typeof setTimeout> | null> = {};

	private version = 0;
	private cachedVersion = -1;
	private cachedWidth = 0;
	private cachedLines: string[] = [];

	constructor(
		tui: { requestRender: () => void },
		onClose: () => void,
		onSave: (s: GameState | null) => void,
		savedState?: GameState,
	) {
		this.tui = tui;
		this.onClose = onClose;
		this.onSave = onSave;
		this.state = savedState ? { ...savedState, paused: true } : createInitialState();
		this.buffer = new PixelBuffer(VIEW_COLS, PIXEL_H);
		this.startLoop();
	}

	private startLoop(): void {
		this.interval = setInterval(() => this.tick(), TICK_MS);
		this.timeInterval = setInterval(() => {
			if (!this.state.paused && !this.state.gameOver && !this.state.dead && !this.state.won) {
				this.state.time = Math.max(0, this.state.time - 1);
				if (this.state.time <= 0) killPlayer(this.state);
			}
		}, 1000);
	}

	private stopLoop(): void {
		if (this.interval) clearInterval(this.interval);
		if (this.timeInterval) clearInterval(this.timeInterval);
	}

	private tick(): void {
		const s = this.state;
		if (s.paused || s.gameOver) return;
		s.frame++;

		updateClouds(s);
		updateParticles(s);

		if (s.dead) {
			s.vy += GRAVITY * 0.5;
			s.py += s.vy;
			s.deadTimer--;
			if (s.deadTimer <= 0) {
				if (s.lives <= 0) s.gameOver = true;
				else loadLevel(s, s.level);
			}
		} else if (s.won) {
			s.wonTimer--;
			if (s.wonTimer <= 0) {
				if (s.level >= LEVELS.length) s.gameOver = true;
				else loadLevel(s, s.level + 1);
			}
		} else {
			updatePlayer(s, this.leftHeld, this.rightHeld, this.jumpHeld);
			updateEnemies(s);
			checkEnemyCollisions(s);
			updateCamera(s);
		}

		this.version++;
		this.tui.requestRender();
	}

	handleInput(key: string): void {
		const s = this.state;

		if (matchesKey(key, "escape") || key === "q" || key === "Q") {
			this.stopLoop();
			this.onSave(s.gameOver ? null : s);
			this.onClose();
			return;
		}

		if (key === "r" || key === "R") {
			Object.assign(this.state, createInitialState());
			this.version++;
			this.tui.requestRender();
			return;
		}

		if (key === "p" || key === "P") {
			s.paused = !s.paused;
			this.version++;
			this.tui.requestRender();
			return;
		}

		if (s.paused || s.gameOver) return;

		if (matchesKey(key, "left") || key === "a" || key === "A" || key === "h") {
			this.leftHeld = true; this.rightHeld = false;
			this.scheduleRelease("left");
		} else if (matchesKey(key, "right") || key === "d" || key === "D" || key === "l") {
			this.rightHeld = true; this.leftHeld = false;
			this.scheduleRelease("right");
		} else if (matchesKey(key, "up") || key === "w" || key === "W" || key === "k" || key === " ") {
			this.jumpHeld = true;
			this.scheduleRelease("jump");
		}
	}

	private scheduleRelease(type: string): void {
		if (this.releaseTimers[type]) clearTimeout(this.releaseTimers[type]!);
		this.releaseTimers[type] = setTimeout(() => {
			if (type === "left") this.leftHeld = false;
			else if (type === "right") this.rightHeld = false;
			else if (type === "jump") this.jumpHeld = false;
		}, type === "jump" ? 100 : 150);
	}

	render(width: number, height: number): string[] {
		const minW = VIEW_COLS + 4;
		if (width < minW) {
			return ["", `  Terminal too narrow (need ${minW})`, "", "  [Q] Quit"];
		}

		if (this.version === this.cachedVersion && width === this.cachedWidth) {
			return this.cachedLines;
		}

		const s = this.state;
		const buf = this.buffer;
		buf.clear();

		const camX = Math.floor(s.cameraX);

		// Draw sky gradient
		for (let y = 0; y < PIXEL_H; y++) {
			const skyCol = y < 12 ? COL_SKY : (y < 24 ? COL_SKY2 : COL_SKY);
			for (let x = 0; x < VIEW_COLS; x++) {
				buf.setPixel(x, y, skyCol);
			}
		}

		// Draw clouds (parallax)
		const parallax = camX * 0.3;
		for (const c of s.clouds) {
			const cx = Math.floor(c.x - parallax) - camX;
			for (let dy = 0; dy < c.h; dy++) {
				for (let dx = 0; dx < c.w; dx++) {
					buf.setPixel(cx + dx, Math.floor(c.y) + dy, COL_CLOUD);
				}
			}
		}

		// Draw tiles
		const startTX = Math.floor(camX / TILE_SIZE);
		const endTX = startTX + Math.ceil(VIEW_COLS / TILE_SIZE) + 1;

		for (let ty = 0; ty < s.tiles.length; ty++) {
			for (let tx = startTX; tx <= endTX && tx < s.levelWidth; tx++) {
				const t = s.tiles[ty]?.[tx];
				if (!t || t === T_EMPTY) continue;

				const px = tx * TILE_SIZE - camX;
				const py = ty * TILE_SIZE;

				if (t === T_GROUND) {
					// Grass on top?
					const above = ty > 0 ? s.tiles[ty - 1]?.[tx] : T_EMPTY;
					if (above !== T_GROUND && above !== T_BRICK) {
						buf.drawRect(px, py, TILE_SIZE, 1, COL_GRASS);
						buf.drawRect(px, py + 1, TILE_SIZE, TILE_SIZE - 1, COL_GROUND);
					} else {
						buf.drawRect(px, py, TILE_SIZE, TILE_SIZE, COL_GROUND);
					}
				} else if (t === T_BRICK) {
					buf.drawRect(px, py, TILE_SIZE, TILE_SIZE, COL_BRICK);
					// Brick pattern
					if (s.frame % 3 === 0) {
						buf.setPixel(px + 1, py + 1, COL_GROUND);
					}
				} else if (t === T_COIN) {
					const coinSpr = s.frame % 20 < 10 ? SPR_COIN1 : SPR_COIN2;
					buf.drawSprite(coinSpr, px, py, false);
				} else if (t === T_SPIKE) {
					// Triangle spike
					buf.setPixel(px + 1, py + 2, COL_SPIKE);
					buf.setPixel(px + 2, py + 2, COL_SPIKE);
					buf.setPixel(px, py + 3, COL_SPIKE);
					buf.setPixel(px + 1, py + 3, COL_SPIKE);
					buf.setPixel(px + 2, py + 3, COL_SPIKE);
					buf.setPixel(px + 3, py + 3, COL_SPIKE);
				} else if (t === T_GOAL) {
					const goalCol = s.frame % 10 < 5 ? COL_GOAL : COL_COIN;
					buf.drawRect(px + 1, py, 2, TILE_SIZE, goalCol);
				} else if (t === T_WATER) {
					const wave = (s.frame + tx) % 8 < 4;
					buf.drawRect(px, py, TILE_SIZE, TILE_SIZE, wave ? COL_WATER1 : COL_WATER2);
				}
			}
		}

		// Draw enemies
		for (const e of s.enemies) {
			if (!e.alive) continue;
			const ex = Math.floor(e.x) - camX;
			const ey = Math.floor(e.y);
			const spr = e.frame % 16 < 8 ? SPR_ENEMY1 : SPR_ENEMY2;
			buf.drawSprite(spr, ex, ey, e.vx > 0);
		}

		// Draw player
		if (!s.dead || s.deadTimer > 40) {
			const ppx = Math.floor(s.px) - camX;
			const ppy = Math.floor(s.py);
			const blink = s.invincible > 0 && s.frame % 4 < 2;
			if (!blink) {
				let spr: number[][];
				if (!s.onGround) {
					spr = SPR_PLAYER_JUMP;
				} else if (Math.abs(s.vx) > 0.2) {
					spr = s.runFrame < 6 ? SPR_PLAYER_RUN1 : SPR_PLAYER_RUN2;
				} else {
					spr = SPR_PLAYER_STAND;
				}
				buf.drawSprite(spr, ppx, ppy, !s.facingRight);
			}
		}

		// Draw particles
		for (const p of s.particles) {
			const px = Math.floor(p.x) - camX;
			const py = Math.floor(p.y);
			buf.setPixel(px, py, p.color);
		}

		// Render pixel buffer to half-blocks
		const gameLines = buf.render(COL_SKY);

		// Build output with header/footer
		const lines: string[] = [];
		const dim = (t: string) => `\x1b[2m${t}\x1b[0m`;
		const bold = (t: string) => `\x1b[1m${t}\x1b[0m`;
		const red = (t: string) => `\x1b[91m${t}\x1b[0m`;
		const yellow = (t: string) => `\x1b[93m${t}\x1b[0m`;
		const green = (t: string) => `\x1b[92m${t}\x1b[0m`;
		const magenta = (t: string) => `\x1b[95m${t}\x1b[0m`;

		// Header
		const title = magenta(bold("BADLOGIC"));
		const stats = `${yellow("●")}${s.coins} ${dim("Score")} ${yellow(String(s.score).padStart(5, "0"))} ` +
			`${dim("World")} ${s.level} ${dim("Time")} ${s.time < 60 ? red(String(s.time)) : String(s.time)} ` +
			`${red("♥".repeat(s.lives))}${dim("♡".repeat(INITIAL_LIVES - s.lives))}`;

		lines.push("");
		lines.push(this.pad(`  ${title}  ${stats}`, width));
		lines.push(this.pad(dim("─".repeat(VIEW_COLS + 2)), width));

		// Game state messages
		if (s.gameOver) {
			const won = s.level > LEVELS.length || (s.won && s.level === LEVELS.length);
			lines.push(this.pad(won ? green(bold("  ★ YOU WIN! ★")) : red(bold("  GAME OVER")), width));
			lines.push(this.pad(`  Score: ${s.score}  [R] Restart  [Q] Quit`, width));
			lines.push("");
		} else if (s.paused) {
			lines.push(this.pad(dim("  ═══ PAUSED ═══  [P] Resume  [R] Restart  [Q] Quit"), width));
		} else if (s.won) {
			lines.push(this.pad(yellow(bold("  ★ LEVEL CLEAR! ★")), width));
		} else if (s.dead) {
			lines.push(this.pad(red("  ☠ OUCH!"), width));
		}

		// Game viewport
		for (const gl of gameLines) {
			lines.push(this.pad(`  ${gl}`, width));
		}

		lines.push(this.pad(dim("─".repeat(VIEW_COLS + 2)), width));
		lines.push(this.pad(dim("  [←→/AD] Move  [↑/W/Space] Jump  [P] Pause  [R] Restart  [Q] Quit"), width));

		this.cachedLines = lines;
		this.cachedVersion = this.version;
		this.cachedWidth = width;
		return lines;
	}

	private pad(line: string, width: number): string {
		const t = truncateToWidth(line, width);
		const p = Math.max(0, width - visibleWidth(t));
		return t + " ".repeat(p);
	}

	dispose(): void {
		this.stopLoop();
		for (const t of Object.values(this.releaseTimers)) {
			if (t) clearTimeout(t);
		}
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("badlogic-game", {
		description: "Badlogic Platformer - pixel-art side-scroller with half-block graphics!",
		args: [],
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("This game requires interactive mode", "error");
				return;
			}

			const entries = ctx.sessionManager.getEntries();
			let saved: GameState | undefined;
			for (let i = entries.length - 1; i >= 0; i--) {
				const e = entries[i];
				if (e.type === "custom" && e.customType === SAVE_TYPE) {
					saved = e.data as GameState;
					break;
				}
			}

			await ctx.ui.custom((tui, _theme, done) => {
				return new BadlogicComponent(
					tui,
					() => done(undefined),
					(state) => { if (state) pi.appendEntry(SAVE_TYPE, state); },
					saved,
				);
			});
		},
	});
}
