/**
 * Badlogic Platformer - a side-scrolling platformer
 * Play with /badlogic-game
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

// Display
const VIEWPORT_WIDTH = 50;
const VIEWPORT_HEIGHT = 16;
const CELL_WIDTH = 2;
const TICK_MS = 50;

// Physics
const GRAVITY = 0.32;
const JUMP_VELOCITY = -1.7;
const MOVE_ACCEL = 0.22;
const MAX_SPEED = 0.7;
const FRICTION = 0.78;
const MAX_FALL = 1.1;

// Gameplay
const INITIAL_LIVES = 3;
const SAVE_TYPE = "badlogic-save";

// Tile types
const EMPTY = " ";
const GROUND = "#";
const BRICK = "B";
const COIN = "o";
const SPIKE = "^";
const GOAL = "G";
const PLAYER_START = "P";
const ENEMY = "E";
const CLOUD = "~";
const BUSH = "*";
const WATER = "w";

// ANSI Colors
const c = (code: string, text: string) => `\x1b[${code}m${text}\x1b[0m`;
const RESET = "\x1b[0m";

// Color helpers
const dim = (t: string) => c("2", t);
const bold = (t: string) => c("1", t);
const red = (t: string) => c("91", t);
const green = (t: string) => c("92", t);
const yellow = (t: string) => c("93", t);
const blue = (t: string) => c("94", t);
const magenta = (t: string) => c("95", t);
const cyan = (t: string) => c("96", t);
const white = (t: string) => c("97", t);
const brown = (t: string) => c("33", t);
const darkGreen = (t: string) => c("32", t);
const bgCyan = (t: string) => c("46", t);
const bgBlue = (t: string) => c("44", t);

// Player sprites (2 chars wide, direction-dependent)
const PLAYER_STAND_R = ["▶◆", "█▌"];
const PLAYER_STAND_L = ["◆◀", "▐█"];
const PLAYER_RUN_R = [["▶◇", "█▄"], ["▶◆", "▄█"]];
const PLAYER_RUN_L = [["◇◀", "▄█"], ["◆◀", "█▄"]];
const PLAYER_JUMP_R = ["▶★", "█ "];
const PLAYER_JUMP_L = ["★◀", " █"];
const PLAYER_DEAD = ["💀", "  "];

// Enemy sprites (animated)
const ENEMY_FRAMES = [
	["◄●", "██"],
	["●►", "██"],
];

// Particle types
interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	char: string;
	color: string;
	life: number;
	maxLife: number;
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
	speed: number;
	size: number;
}

interface GameState {
	// Player
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

	// World
	level: number;
	tiles: string[][];
	levelWidth: number;
	enemies: Entity[];
	clouds: Cloud[];
	particles: Particle[];
	cameraX: number;

	// Stats
	score: number;
	coins: number;
	lives: number;
	time: number;

	// Meta
	paused: boolean;
	gameOver: boolean;
	frame: number;
}

// Level data
const LEVELS: string[][] = [
	// Level 1 - Grassy plains
	[
		"          ~                    ~                           ~                                      ~                ",
		"                     ~                          ~                       ~                                          ",
		"     ~                              ~                                            ~                          ~      ",
		"                                                                                                                    ",
		"                                                                                                     G              ",
		"                                                                                                  #####            ",
		"                              o o o                                      o   o                   ##   ##           ",
		"                             BBBBBBB                      BBB           BB   BB        *        ##     ##    *     ",
		"               o      *                       BBB                      ##     ##       *       ##       ##   *     ",
		"              BBB     *         E                         E           ##       ##  E   *      ##         ##  *     ",
		"P    *                *                                              ##         ##     *     ##           ## *  G  ",
		"###########       #########       #######     ######    ######     ###           #####################################",
		"###########       #########       #######     ######    ######     ###############################################",
		"###########wwwwwww#########wwwwwww#######wwwww######wwww######wwwww################################################",
		"###########wwwwwww#########wwwwwww#######wwwww######wwww######wwwww################################################",
		"###########wwwwwww#########wwwwwww#######wwwww######wwww######wwwww################################################",
	],
	// Level 2 - Underground
	[
		"####################################################################################################",
		"#                                                                                                  #",
		"#       o                                                        o o o                       G     #",
		"#      BBB                                                      BBBBBBB                    ###     #",
		"#                         o   o   o                                              *                 #",
		"#                        BBB BBB BBB                  E                          *       ###       #",
		"#            o                                       ###        E                *                 #",
		"#           BBB                         ^^                     ###        ^^     *      ###        #",
		"#                    E                 ####     E                         ####   *                 #",
		"#                   ###       ^^              ####        ^^                     *     ###         #",
		"#P                           ####                        ####     E              *                G#",
		"#######       #######       ######     ####      ####   ######   ###    #####################################",
		"#######       #######       ######     ####      ####   ######   ###    #####################################",
		"#######       #######       ######     ####      ####   ######   ###    #####################################",
		"#######       #######       ######     ####      ####   ######   ###    #####################################",
		"#######       #######       ######     ####      ####   ######   ###    #####################################",
	],
	// Level 3 - Sky fortress
	[
		"          ~           ~                    ~              ~                    ~                    ~              ",
		"     ~          ~               ~                   ~              ~                     ~                   ~     ",
		"                         ~                                   ~                                    ~                ",
		"                                                                                           G                       ",
		"                                                                                         #####                     ",
		"                                          o o o                                                                    ",
		"                                         BBBBBBB                   E                                               ",
		"                     o                              ^^            ###                    ###                       ",
		"                    BB          E                  ####                      E                                     ",
		"          o                    ###     ^^                   ^^              ###                                    ",
		"         BB     E             ####    ####       ####      ####                     E                           G  ",
		"P       ####   ###       ###       ####     ###       ###       ###       ###      ###    ########################",
		"##     ######                                                                                                      ",
		"                                                                                                                   ",
		"                                                                                                                   ",
		"                                                                                                                   ",
	],
];

const parseLevel = (levelNum: number): { tiles: string[][], width: number, enemies: Entity[], startX: number, startY: number } => {
	const template = LEVELS[Math.min(levelNum - 1, LEVELS.length - 1)];
	const tiles = template.map(row => {
		// Pad rows to consistent length
		const padded = row.padEnd(120, " ");
		return padded.split("");
	});
	const width = tiles[0].length;
	const enemies: Entity[] = [];
	let startX = 1, startY = 10;

	for (let y = 0; y < tiles.length; y++) {
		for (let x = 0; x < tiles[y].length; x++) {
			const ch = tiles[y][x];
			if (ch === PLAYER_START) {
				startX = x;
				startY = y;
				tiles[y][x] = EMPTY;
			} else if (ch === ENEMY) {
				enemies.push({ x, y, vx: -0.25, vy: 0, alive: true, frame: 0 });
				tiles[y][x] = EMPTY;
			}
		}
	}

	return { tiles, width, enemies, startX, startY };
};

const createClouds = (width: number): Cloud[] => {
	const clouds: Cloud[] = [];
	for (let i = 0; i < 8; i++) {
		clouds.push({
			x: Math.random() * width,
			y: Math.random() * 4,
			speed: 0.02 + Math.random() * 0.03,
			size: 1 + Math.floor(Math.random() * 3),
		});
	}
	return clouds;
};

const createInitialState = (): GameState => {
	const { tiles, width, enemies, startX, startY } = parseLevel(1);
	return {
		px: startX,
		py: startY,
		vx: 0,
		vy: 0,
		onGround: false,
		facingRight: true,
		jumpHeld: false,
		dead: false,
		deadTimer: 0,
		won: false,
		wonTimer: 0,
		invincible: 0,
		runFrame: 0,
		level: 1,
		tiles,
		levelWidth: width,
		enemies,
		clouds: createClouds(width),
		particles: [],
		cameraX: 0,
		score: 0,
		coins: 0,
		lives: INITIAL_LIVES,
		time: 300,
		paused: false,
		gameOver: false,
		frame: 0,
	};
};

const loadLevel = (state: GameState, levelNum: number): void => {
	const { tiles, width, enemies, startX, startY } = parseLevel(levelNum);
	state.level = levelNum;
	state.tiles = tiles;
	state.levelWidth = width;
	state.enemies = enemies;
	state.clouds = createClouds(width);
	state.particles = [];
	state.px = startX;
	state.py = startY;
	state.vx = 0;
	state.vy = 0;
	state.onGround = false;
	state.dead = false;
	state.deadTimer = 0;
	state.won = false;
	state.wonTimer = 0;
	state.cameraX = 0;
	state.time = 300;
};

const isSolid = (ch: string): boolean => ch === GROUND || ch === BRICK;

const getTile = (state: GameState, x: number, y: number): string => {
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	if (iy < 0 || iy >= state.tiles.length) return EMPTY;
	if (ix < 0 || ix >= state.levelWidth) return EMPTY;
	return state.tiles[iy]?.[ix] ?? EMPTY;
};

const setTile = (state: GameState, x: number, y: number, val: string): void => {
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	if (iy >= 0 && iy < state.tiles.length && ix >= 0 && ix < state.levelWidth) {
		state.tiles[iy][ix] = val;
	}
};

const spawnParticle = (state: GameState, x: number, y: number, char: string, color: string, vx = 0, vy = 0, life = 20): void => {
	state.particles.push({ x, y, vx, vy, char, color, life, maxLife: life });
};

const spawnCoinParticles = (state: GameState, x: number, y: number): void => {
	for (let i = 0; i < 5; i++) {
		const angle = (Math.PI * 2 * i) / 5;
		spawnParticle(state, x, y, "✦", "93", Math.cos(angle) * 0.5, Math.sin(angle) * 0.5 - 0.5, 15);
	}
	spawnParticle(state, x, y - 0.5, "+100", "93", 0, -0.3, 25);
};

const spawnBrickParticles = (state: GameState, x: number, y: number): void => {
	for (let i = 0; i < 4; i++) {
		spawnParticle(state, x + Math.random(), y, "▪", "33", (Math.random() - 0.5) * 1.5, -Math.random() * 1.5, 25);
	}
};

const spawnDeathParticles = (state: GameState, x: number, y: number): void => {
	for (let i = 0; i < 6; i++) {
		const angle = (Math.PI * 2 * i) / 6;
		spawnParticle(state, x, y, "★", "91", Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, 20);
	}
};

const spawnEnemyDeathParticles = (state: GameState, x: number, y: number): void => {
	spawnParticle(state, x, y - 0.5, "+50", "92", 0, -0.3, 25);
	for (let i = 0; i < 4; i++) {
		spawnParticle(state, x, y, "×", "91", (Math.random() - 0.5) * 1, -Math.random() * 1, 15);
	}
};

const spawnDustParticle = (state: GameState, x: number, y: number): void => {
	spawnParticle(state, x, y + 0.8, ".", "2", (Math.random() - 0.5) * 0.3, -0.1, 10);
};

const killPlayer = (state: GameState): void => {
	if (state.invincible > 0 || state.dead) return;
	state.dead = true;
	state.deadTimer = 50;
	state.vy = -1.8;
	state.lives--;
	spawnDeathParticles(state, state.px, state.py);
};

const updatePlayer = (state: GameState, left: boolean, right: boolean, jump: boolean): void => {
	if (state.dead || state.won) return;

	const wasOnGround = state.onGround;

	// Horizontal input
	if (left && !right) {
		state.vx -= MOVE_ACCEL;
		state.facingRight = false;
	} else if (right && !left) {
		state.vx += MOVE_ACCEL;
		state.facingRight = true;
	}

	// Friction
	state.vx *= FRICTION;
	if (Math.abs(state.vx) < 0.01) state.vx = 0;
	state.vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, state.vx));

	// Running animation
	if (Math.abs(state.vx) > 0.1 && state.onGround) {
		state.runFrame = (state.runFrame + 1) % 8;
		// Dust particles when running
		if (state.frame % 6 === 0) {
			spawnDustParticle(state, state.px, state.py);
		}
	} else {
		state.runFrame = 0;
	}

	// Jumping
	if (jump && state.onGround && !state.jumpHeld) {
		state.vy = JUMP_VELOCITY;
		state.onGround = false;
		state.jumpHeld = true;
		// Jump dust
		spawnDustParticle(state, state.px - 0.3, state.py);
		spawnDustParticle(state, state.px + 0.3, state.py);
	}
	if (!jump) {
		state.jumpHeld = false;
		if (state.vy < -0.3) {
			state.vy *= 0.65;
		}
	}

	// Gravity
	state.vy += GRAVITY;
	state.vy = Math.min(state.vy, MAX_FALL);

	// Horizontal collision
	const newX = state.px + state.vx;
	const top = state.py;
	const bot = state.py + 0.9;

	let hitX = false;
	const probeX = state.vx > 0 ? newX + 0.8 : newX;
	if (isSolid(getTile(state, probeX, top)) || isSolid(getTile(state, probeX, bot))) {
		hitX = true;
	}

	if (!hitX && newX >= 0) {
		state.px = newX;
	} else {
		state.vx = 0;
	}

	// Vertical collision
	const newY = state.py + state.vy;
	state.onGround = false;

	if (state.vy >= 0) {
		const probeY = newY + 0.99;
		const leftX = state.px;
		const rightX = state.px + 0.8;
		if (isSolid(getTile(state, leftX, probeY)) || isSolid(getTile(state, rightX, probeY))) {
			state.py = Math.floor(newY);
			state.vy = 0;
			state.onGround = true;
			// Land dust
			if (!wasOnGround) {
				spawnDustParticle(state, state.px, state.py);
			}
		} else {
			state.py = newY;
		}
	} else {
		const probeY = newY;
		const leftX = state.px;
		const rightX = state.px + 0.8;
		const headTileL = getTile(state, leftX, probeY);
		const headTileR = getTile(state, rightX, probeY);

		if (isSolid(headTileL) || isSolid(headTileR)) {
			state.vy = 0;
			if (headTileL === BRICK) {
				setTile(state, leftX, probeY, EMPTY);
				state.score += 10;
				spawnBrickParticles(state, Math.floor(leftX), Math.floor(probeY));
			}
			if (headTileR === BRICK) {
				setTile(state, rightX, probeY, EMPTY);
				state.score += 10;
				spawnBrickParticles(state, Math.floor(rightX), Math.floor(probeY));
			}
		} else {
			state.py = newY;
		}
	}

	// Collect coins
	const coinX = state.px + 0.4;
	const coinY = state.py + 0.4;
	const coinTile = getTile(state, coinX, coinY);
	if (coinTile === COIN) {
		setTile(state, coinX, coinY, EMPTY);
		state.coins++;
		state.score += 100;
		spawnCoinParticles(state, Math.floor(coinX), Math.floor(coinY));
	}

	// Hit spikes?
	const floorL = getTile(state, state.px, state.py + 1);
	const floorR = getTile(state, state.px + 0.8, state.py + 1);
	if (floorL === SPIKE || floorR === SPIKE) {
		killPlayer(state);
	}

	// Hit water?
	const waterCheck = getTile(state, state.px + 0.4, state.py + 0.5);
	if (waterCheck === WATER) {
		killPlayer(state);
	}

	// Fell off?
	if (state.py > state.tiles.length + 2) {
		killPlayer(state);
	}

	// Reach goal?
	const goalCheck = getTile(state, state.px + 0.4, state.py + 0.4);
	if (goalCheck === GOAL) {
		state.won = true;
		state.wonTimer = 60;
		state.score += 500 + state.time * 5;
		// Victory particles
		for (let i = 0; i < 10; i++) {
			spawnParticle(state, state.px, state.py, "★", "93", (Math.random() - 0.5) * 2, -Math.random() * 2, 30);
		}
	}

	if (state.invincible > 0) state.invincible--;
};

const updateEnemies = (state: GameState): void => {
	for (const e of state.enemies) {
		if (!e.alive) continue;

		e.frame = (e.frame + 1) % 16;

		e.vy += GRAVITY * 0.5;
		e.vy = Math.min(e.vy, MAX_FALL);

		const newX = e.x + e.vx;
		const probeX = e.vx > 0 ? newX + 0.9 : newX;
		if (isSolid(getTile(state, probeX, e.y)) || isSolid(getTile(state, probeX, e.y + 0.9))) {
			e.vx = -e.vx;
		} else {
			e.x = newX;
		}

		const aheadX = e.vx > 0 ? e.x + 1.2 : e.x - 0.2;
		if (!isSolid(getTile(state, aheadX, e.y + 1.2))) {
			e.vx = -e.vx;
		}

		const newY = e.y + e.vy;
		const probeY = newY + 0.99;
		if (isSolid(getTile(state, e.x, probeY)) || isSolid(getTile(state, e.x + 0.9, probeY))) {
			e.y = Math.floor(newY);
			e.vy = 0;
		} else {
			e.y = newY;
		}

		if (e.y > state.tiles.length + 2) {
			e.alive = false;
		}
	}
};

const checkEnemyCollisions = (state: GameState): void => {
	if (state.dead || state.invincible > 0) return;

	const pLeft = state.px;
	const pRight = state.px + 0.8;
	const pTop = state.py;
	const pBot = state.py + 0.9;

	for (const e of state.enemies) {
		if (!e.alive) continue;

		const eLeft = e.x;
		const eRight = e.x + 0.9;
		const eTop = e.y;
		const eBot = e.y + 0.9;

		if (pRight > eLeft && pLeft < eRight && pBot > eTop && pTop < eBot) {
			if (state.vy > 0 && pBot < eTop + 0.5) {
				e.alive = false;
				state.vy = -1.0;
				state.score += 50;
				spawnEnemyDeathParticles(state, e.x, e.y);
			} else {
				killPlayer(state);
			}
		}
	}
};

const updateClouds = (state: GameState): void => {
	for (const cloud of state.clouds) {
		cloud.x += cloud.speed;
		if (cloud.x > state.levelWidth + 5) {
			cloud.x = -5;
		}
	}
};

const updateParticles = (state: GameState): void => {
	for (const p of state.particles) {
		p.x += p.vx;
		p.y += p.vy;
		p.vy += 0.05;
		p.life--;
	}
	state.particles = state.particles.filter(p => p.life > 0);
};

const updateCamera = (state: GameState): void => {
	const targetX = state.px - VIEWPORT_WIDTH / 3;
	const newCam = Math.max(0, Math.min(targetX, state.levelWidth - VIEWPORT_WIDTH));
	// Smooth camera
	state.cameraX += (newCam - state.cameraX) * 0.1;
};

class BadlogicComponent {
	private state: GameState;
	private interval: ReturnType<typeof setInterval> | null = null;
	private timeInterval: ReturnType<typeof setInterval> | null = null;
	private onClose: () => void;
	private onSave: (state: GameState | null) => void;
	private tui: { requestRender: () => void };

	private leftHeld = false;
	private rightHeld = false;
	private jumpHeld = false;

	private version = 0;
	private cachedVersion = -1;
	private cachedWidth = 0;
	private cachedLines: string[] = [];

	constructor(
		tui: { requestRender: () => void },
		onClose: () => void,
		onSave: (state: GameState | null) => void,
		savedState?: GameState,
	) {
		this.tui = tui;
		this.onClose = onClose;
		this.onSave = onSave;
		this.state = savedState ? { ...savedState, paused: true } : createInitialState();
		this.startLoop();
	}

	private startLoop(): void {
		this.interval = setInterval(() => this.tick(), TICK_MS);
		this.timeInterval = setInterval(() => {
			if (!this.state.paused && !this.state.gameOver && !this.state.dead && !this.state.won) {
				this.state.time = Math.max(0, this.state.time - 1);
				if (this.state.time <= 0) {
					killPlayer(this.state);
				}
			}
		}, 1000);
	}

	private stopLoop(): void {
		if (this.interval) clearInterval(this.interval);
		if (this.timeInterval) clearInterval(this.timeInterval);
		this.interval = null;
		this.timeInterval = null;
	}

	private tick(): void {
		const s = this.state;
		if (s.paused || s.gameOver) return;

		s.frame++;

		// Always update visual elements
		updateClouds(s);
		updateParticles(s);

		if (s.dead) {
			s.vy += GRAVITY * 0.5;
			s.py += s.vy;
			s.deadTimer--;
			if (s.deadTimer <= 0) {
				if (s.lives <= 0) {
					s.gameOver = true;
				} else {
					loadLevel(s, s.level);
				}
			}
			this.markDirty();
			return;
		}

		if (s.won) {
			s.wonTimer--;
			if (s.wonTimer <= 0) {
				if (s.level >= LEVELS.length) {
					s.gameOver = true;
				} else {
					loadLevel(s, s.level + 1);
				}
			}
			this.markDirty();
			return;
		}

		updatePlayer(s, this.leftHeld, this.rightHeld, this.jumpHeld);
		updateEnemies(s);
		checkEnemyCollisions(s);
		updateCamera(s);

		this.markDirty();
	}

	private markDirty(): void {
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
			this.markDirty();
			return;
		}

		if (key === "p" || key === "P") {
			s.paused = !s.paused;
			this.markDirty();
			return;
		}

		if (s.paused || s.gameOver) return;

		if (matchesKey(key, "left") || key === "a" || key === "A" || key === "h") {
			this.leftHeld = true;
			this.rightHeld = false;
			this.scheduleRelease("left");
		} else if (matchesKey(key, "right") || key === "d" || key === "D" || key === "l") {
			this.rightHeld = true;
			this.leftHeld = false;
			this.scheduleRelease("right");
		} else if (matchesKey(key, "up") || key === "w" || key === "W" || key === "k" || key === " ") {
			this.jumpHeld = true;
			this.scheduleRelease("jump");
		}
	}

	private releaseTimers: Record<string, ReturnType<typeof setTimeout> | null> = {};

	private scheduleRelease(type: "left" | "right" | "jump"): void {
		if (this.releaseTimers[type]) clearTimeout(this.releaseTimers[type]!);
		const delay = type === "jump" ? 100 : 160;
		this.releaseTimers[type] = setTimeout(() => {
			if (type === "left") this.leftHeld = false;
			else if (type === "right") this.rightHeld = false;
			else if (type === "jump") this.jumpHeld = false;
		}, delay);
	}

	render(width: number, height: number): string[] {
		const minWidth = VIEWPORT_WIDTH * 2 + 4;
		if (width < minWidth) {
			return [
				"",
				this.pad(`${magenta(bold("BADLOGIC GAME"))}`, width),
				"",
				this.pad(dim(`Terminal too narrow (need ${minWidth})`), width),
				this.pad(dim(`[Q] Quit`), width),
			];
		}

		if (this.version === this.cachedVersion && width === this.cachedWidth) {
			return this.cachedLines;
		}

		const s = this.state;
		const lines: string[] = [];
		const boxWidth = VIEWPORT_WIDTH * 2;

		// Border helper
		const border = dim(`+${"-".repeat(boxWidth)}+`);
		const boxLine = (content: string): string => {
			const t = truncateToWidth(content, boxWidth);
			const p = Math.max(0, boxWidth - visibleWidth(t));
			return dim("|") + t + " ".repeat(p) + dim("|");
		};

		// Header
		lines.push(this.pad(border, width));
		
		const title = `${magenta(bold("BADLOGIC"))}  ${dim("World")} ${white(bold(String(s.level)))}`;
		const stats = `${yellow("●")}${s.coins}  ${dim("Score")} ${yellow(String(s.score).padStart(5, "0"))}  ` +
			`${dim("Time")} ${s.time < 60 ? red(String(s.time)) : white(String(s.time))}  ` +
			`${red("♥".repeat(s.lives))}${dim("♡".repeat(INITIAL_LIVES - s.lives))}`;
		
		lines.push(this.pad(boxLine(title + "  " + stats), width));
		lines.push(this.pad(boxLine(dim("-".repeat(boxWidth))), width));

		// Game state messages
		if (s.gameOver) {
			const won = s.level > LEVELS.length || (s.won && s.level === LEVELS.length);
			if (won) {
				lines.push(this.pad(boxLine(`  ${yellow(bold("★ CONGRATULATIONS! YOU WIN! ★"))}`), width));
			} else {
				lines.push(this.pad(boxLine(`  ${red(bold("GAME OVER"))}`), width));
			}
			lines.push(this.pad(boxLine(`  Final Score: ${yellow(String(s.score))}  Coins: ${yellow(String(s.coins))}`), width));
			lines.push(this.pad(boxLine(""), width));
			lines.push(this.pad(boxLine(`  ${dim("[R] Restart  [Q] Quit")}`), width));
			lines.push(this.pad(border, width));
			this.cache(lines, width);
			return lines;
		}

		if (s.paused) {
			lines.push(this.pad(boxLine(`  ${dim("══ PAUSED ══  [P] Resume  [R] Restart  [Q] Quit")}`), width));
		} else if (s.won) {
			lines.push(this.pad(boxLine(`  ${yellow(bold("★ LEVEL CLEAR! ★"))}  +${500 + s.time * 5} pts`), width));
		} else if (s.dead) {
			lines.push(this.pad(boxLine(`  ${red("☠ OUCH! ☠")}`), width));
		}

		// Render viewport
		const camX = Math.floor(s.cameraX);
		const parallaxOffset = Math.floor(s.cameraX * 0.3);

		for (let y = 0; y < VIEWPORT_HEIGHT; y++) {
			let row = "";
			for (let x = 0; x < VIEWPORT_WIDTH; x++) {
				const wx = camX + x;
				const wy = y;
				let rendered = false;

				// Particles (on top)
				for (const p of s.particles) {
					const psx = Math.floor(p.x) - camX;
					const psy = Math.floor(p.y);
					if (x === psx && y === psy) {
						const fade = p.life / p.maxLife;
						const col = fade > 0.5 ? p.color : "2;" + p.color;
						row += c(col, p.char.slice(0, 2).padEnd(2));
						rendered = true;
						break;
					}
				}
				if (rendered) continue;

				// Player
				const psx = Math.floor(s.px) - camX;
				const psy = Math.floor(s.py);
				if (x === psx && (y === psy || y === psy - 1) && !s.dead) {
					const blink = s.invincible > 0 && s.frame % 4 < 2;
					if (!blink) {
						const sprite = this.getPlayerSprite(s, y === psy - 1);
						row += cyan(sprite);
					} else {
						row += "  ";
					}
					continue;
				}

				// Dead player (falling)
				if (s.dead && x === psx && y === Math.floor(s.py)) {
					row += red("💀");
					continue;
				}

				// Enemies
				let isEnemy = false;
				for (const e of s.enemies) {
					if (!e.alive) continue;
					const esx = Math.floor(e.x) - camX;
					const esy = Math.floor(e.y);
					if (x === esx && (y === esy || y === esy - 1)) {
						const frame = ENEMY_FRAMES[Math.floor(e.frame / 8) % 2];
						const part = y === esy - 1 ? frame[0] : frame[1];
						row += red(part);
						isEnemy = true;
						break;
					}
				}
				if (isEnemy) continue;

				// Clouds (background, parallax)
				let isCloud = false;
				for (const cloud of s.clouds) {
					const cloudX = Math.floor(cloud.x - parallaxOffset * 0.5);
					if (y === Math.floor(cloud.y) && x >= cloudX - camX && x < cloudX - camX + cloud.size + 2) {
						row += white(dim("░░"));
						isCloud = true;
						break;
					}
				}
				if (isCloud) continue;

				// Tiles
				row += this.renderTile(getTile(s, wx, wy), wx, wy, s);
			}
			lines.push(this.pad(boxLine(row), width));
		}

		// Footer
		lines.push(this.pad(boxLine(dim("-".repeat(boxWidth))), width));
		const controls = `${dim("[←→/AD] Move  [↑/W/Space] Jump  [P] Pause  [R] Restart  [Q] Quit")}`;
		lines.push(this.pad(boxLine(controls), width));
		lines.push(this.pad(border, width));

		this.cache(lines, width);
		return lines;
	}

	private getPlayerSprite(s: GameState, isTop: boolean): string {
		const idx = isTop ? 0 : 1;
		
		if (!s.onGround) {
			return s.facingRight ? PLAYER_JUMP_R[idx] : PLAYER_JUMP_L[idx];
		}
		
		if (Math.abs(s.vx) > 0.1) {
			const frame = Math.floor(s.runFrame / 4) % 2;
			return s.facingRight ? PLAYER_RUN_R[frame][idx] : PLAYER_RUN_L[frame][idx];
		}
		
		return s.facingRight ? PLAYER_STAND_R[idx] : PLAYER_STAND_L[idx];
	}

	private renderTile(t: string, x: number, y: number, s: GameState): string {
		const shimmer = (s.frame + x) % 20 < 2;
		
		switch (t) {
			case GROUND: {
				// Grass on top?
				const above = getTile(s, x, y - 1);
				if (above !== GROUND && above !== BRICK) {
					return green("▓▓");
				}
				return brown("██");
			}
			case BRICK: {
				return brown(shimmer ? "▒░" : "▒▒");
			}
			case COIN: {
				return shimmer ? yellow(bold("◆ ")) : yellow("● ");
			}
			case SPIKE: {
				return red("▲▲");
			}
			case GOAL: {
				return (s.frame % 10 < 5) ? green(bold("⚑ ")) : yellow(bold("⚑ "));
			}
			case BUSH: {
				return darkGreen("♣♣");
			}
			case WATER: {
				const wave = (s.frame + x) % 8 < 4;
				return blue(wave ? "~≈" : "≈~");
			}
			case CLOUD: {
				return white(dim("░░"));
			}
			default: {
				// Sky gradient based on y position
				if (y < 3) return c("48;5;39", "  "); // Light blue
				if (y < 6) return c("48;5;38", "  ");
				if (y < 9) return c("48;5;37", "  ");
				return c("48;5;36", "  "); // Darker blue
			}
		}
	}

	private pad(line: string, width: number): string {
		const t = truncateToWidth(line, width);
		const p = Math.max(0, width - visibleWidth(t));
		return t + " ".repeat(p);
	}

	private cache(lines: string[], width: number): void {
		this.cachedLines = lines;
		this.cachedVersion = this.version;
		this.cachedWidth = width;
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
		description: "Badlogic Platformer - jump, collect coins, defeat enemies!",
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
					(state) => {
						if (state) pi.appendEntry(SAVE_TYPE, state);
					},
					saved,
				);
			});
		},
	});
}
