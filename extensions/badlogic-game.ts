/**
 * Badlogic Platformer - a side-scrolling platformer
 * Play with /badlogic-game
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

// Display
const VIEWPORT_WIDTH = 40;
const VIEWPORT_HEIGHT = 14;
const CELL_WIDTH = 2;
const TICK_MS = 50;

// Physics
const GRAVITY = 0.35;
const JUMP_VELOCITY = -1.8;
const MOVE_ACCEL = 0.25;
const MAX_SPEED = 0.8;
const FRICTION = 0.75;
const MAX_FALL = 1.2;

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

// Colors
const RESET = "\x1b[0m";
const RED = "\x1b[91m";
const GREEN = "\x1b[92m";
const YELLOW = "\x1b[93m";
const BLUE = "\x1b[94m";
const MAGENTA = "\x1b[95m";
const CYAN = "\x1b[96m";
const WHITE = "\x1b[97m";
const BROWN = "\x1b[33m";
const DIM = "\x1b[2m";
const BG_CYAN = "\x1b[46m";

interface Entity {
	x: number;
	y: number;
	vx: number;
	vy: number;
	alive: boolean;
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

	// World
	level: number;
	tiles: string[][];
	levelWidth: number;
	enemies: Entity[];
	cameraX: number;

	// Stats
	score: number;
	coins: number;
	lives: number;

	// Meta
	paused: boolean;
	gameOver: boolean;
	frame: number;
}

// Level data - each row is a string, P = player start, E = enemy, G = goal
const LEVELS: string[][] = [
	// Level 1 - Tutorial
	[
		"                                                                                              ",
		"                                                                                              ",
		"                                                                                              ",
		"                                                                                              ",
		"                                                                                              ",
		"                                                                              G               ",
		"                           o o o                                           #####              ",
		"                          BBBBBBB                    o   o                ##   ##             ",
		"              o                          BBB        BB   BB              ##     ##            ",
		"             BBB      E              E             ##     ##       E    ##       ##           ",
		"P                                                 ##       ##         ###         ###      G  ",
		"##########      ########      ######    ####    ###         ##################################",
		"##########      ########      ######    ####    ##############################################",
		"##########      ########      ######    ####    ##############################################",
	],
	// Level 2 - Gaps and spikes
	[
		"                                                                                              ",
		"                                                                                              ",
		"                                                                                              ",
		"                                                                                              ",
		"                                             o o o                                            ",
		"                                            BBBBBBB                              G            ",
		"                    o                                       o   o              ####           ",
		"                   BBB                  E          E       BB   BB            ##  ##          ",
		"           o                                              ##     ##     E    ##    ##         ",
		"          BBB    E      ^^     E           ^^             #       #         ##      ##        ",
		"P                      ####           E   ####                             ##        ##    G  ",
		"#######       ####    ######    ###      ######    ###         ###        ####################",
		"#######       ####    ######    ###      ######    ###         ###        ####################",
		"#######       ####    ######    ###      ######    ###         ###        ####################",
	],
	// Level 3 - Vertical challenge
	[
		"                                                                                              ",
		"                                                              o o o                           ",
		"                                                             BBBBBBB                          ",
		"                                          o                                    G              ",
		"                                         BB                               ########            ",
		"                      o   o                                 E                                 ",
		"                     BB   BB            ##                 ###                                ",
		"          o                                    E                                              ",
		"         BB      E       E      ^^     ###            E                                       ",
		"                               ####          ^^      ###     ^^                               ",
		"P             ####                          ####            ####                           G  ",
		"######       ######      ###       ###     ######    ###   ######    #########################",
		"######       ######      ###       ###     ######    ###   ######    #########################",
		"######       ######      ###       ###     ######    ###   ######    #########################",
	],
];

const parseLevel = (levelNum: number): { tiles: string[][], width: number, enemies: Entity[], startX: number, startY: number } => {
	const template = LEVELS[Math.min(levelNum - 1, LEVELS.length - 1)];
	const tiles = template.map(row => row.split(""));
	const width = tiles[0].length;
	const enemies: Entity[] = [];
	let startX = 1, startY = 10;

	for (let y = 0; y < tiles.length; y++) {
		for (let x = 0; x < tiles[y].length; x++) {
			const c = tiles[y][x];
			if (c === PLAYER_START) {
				startX = x;
				startY = y;
				tiles[y][x] = EMPTY;
			} else if (c === ENEMY) {
				enemies.push({ x, y, vx: -0.3, vy: 0, alive: true });
				tiles[y][x] = EMPTY;
			}
		}
	}

	return { tiles, width, enemies, startX, startY };
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
		level: 1,
		tiles,
		levelWidth: width,
		enemies,
		cameraX: 0,
		score: 0,
		coins: 0,
		lives: INITIAL_LIVES,
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
};

const isSolid = (c: string): boolean => c === GROUND || c === BRICK;

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

const killPlayer = (state: GameState): void => {
	if (state.invincible > 0 || state.dead) return;
	state.dead = true;
	state.deadTimer = 40;
	state.vy = -1.5;
	state.lives--;
};

const updatePlayer = (state: GameState, left: boolean, right: boolean, jump: boolean): void => {
	if (state.dead || state.won) return;

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

	// Jumping
	if (jump && state.onGround && !state.jumpHeld) {
		state.vy = JUMP_VELOCITY;
		state.onGround = false;
		state.jumpHeld = true;
	}
	if (!jump) {
		state.jumpHeld = false;
		// Variable jump height
		if (state.vy < -0.3) {
			state.vy *= 0.6;
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
	const probeX = state.vx > 0 ? newX + 0.9 : newX;
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
		// Falling
		const probeY = newY + 0.99;
		const leftX = state.px;
		const rightX = state.px + 0.9;
		if (isSolid(getTile(state, leftX, probeY)) || isSolid(getTile(state, rightX, probeY))) {
			state.py = Math.floor(newY);
			state.vy = 0;
			state.onGround = true;
		} else {
			state.py = newY;
		}
	} else {
		// Rising - check head
		const probeY = newY;
		const leftX = state.px;
		const rightX = state.px + 0.9;
		const headTileL = getTile(state, leftX, probeY);
		const headTileR = getTile(state, rightX, probeY);

		if (isSolid(headTileL) || isSolid(headTileR)) {
			state.vy = 0;
			// Hit a brick? Break it or bounce
			if (headTileL === BRICK) {
				setTile(state, leftX, probeY, EMPTY);
				state.score += 10;
			}
			if (headTileR === BRICK) {
				setTile(state, rightX, probeY, EMPTY);
				state.score += 10;
			}
		} else {
			state.py = newY;
		}
	}

	// Collect coins
	const coinTile = getTile(state, state.px + 0.5, state.py + 0.5);
	if (coinTile === COIN) {
		setTile(state, state.px + 0.5, state.py + 0.5, EMPTY);
		state.coins++;
		state.score += 100;
	}

	// Hit spikes?
	const floorL = getTile(state, state.px, state.py + 1);
	const floorR = getTile(state, state.px + 0.9, state.py + 1);
	if (floorL === SPIKE || floorR === SPIKE) {
		killPlayer(state);
	}

	// Fell off?
	if (state.py > state.tiles.length + 2) {
		killPlayer(state);
	}

	// Reach goal?
	if (coinTile === GOAL || getTile(state, state.px, state.py) === GOAL) {
		state.won = true;
		state.wonTimer = 60;
		state.score += 500;
	}

	// Decrement invincibility
	if (state.invincible > 0) state.invincible--;
};

const updateEnemies = (state: GameState): void => {
	for (const e of state.enemies) {
		if (!e.alive) continue;

		// Gravity
		e.vy += GRAVITY * 0.5;
		e.vy = Math.min(e.vy, MAX_FALL);

		// Horizontal movement
		const newX = e.x + e.vx;
		const probeX = e.vx > 0 ? newX + 0.9 : newX;
		if (isSolid(getTile(state, probeX, e.y)) || isSolid(getTile(state, probeX, e.y + 0.9))) {
			e.vx = -e.vx; // Turn around
		} else {
			e.x = newX;
		}

		// Edge detection - turn around at ledges
		const aheadX = e.vx > 0 ? e.x + 1.5 : e.x - 0.5;
		if (!isSolid(getTile(state, aheadX, e.y + 1.5))) {
			e.vx = -e.vx;
		}

		// Vertical
		const newY = e.y + e.vy;
		const probeY = newY + 0.99;
		if (isSolid(getTile(state, e.x, probeY)) || isSolid(getTile(state, e.x + 0.9, probeY))) {
			e.y = Math.floor(newY);
			e.vy = 0;
		} else {
			e.y = newY;
		}

		// Fell off
		if (e.y > state.tiles.length + 2) {
			e.alive = false;
		}
	}
};

const checkEnemyCollisions = (state: GameState): void => {
	if (state.dead || state.invincible > 0) return;

	const pLeft = state.px;
	const pRight = state.px + 0.9;
	const pTop = state.py;
	const pBot = state.py + 0.9;

	for (const e of state.enemies) {
		if (!e.alive) continue;

		const eLeft = e.x;
		const eRight = e.x + 0.9;
		const eTop = e.y;
		const eBot = e.y + 0.9;

		// Overlap?
		if (pRight > eLeft && pLeft < eRight && pBot > eTop && pTop < eBot) {
			// Stomping? (player falling and above enemy center)
			if (state.vy > 0 && pBot < eTop + 0.5) {
				e.alive = false;
				state.vy = -1.2; // Bounce
				state.score += 50;
			} else {
				killPlayer(state);
			}
		}
	}
};

const updateCamera = (state: GameState): void => {
	const targetX = state.px - VIEWPORT_WIDTH / 3;
	state.cameraX = Math.max(0, Math.min(targetX, state.levelWidth - VIEWPORT_WIDTH));
};

class BadlogicComponent {
	private state: GameState;
	private interval: ReturnType<typeof setInterval> | null = null;
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
	}

	private stopLoop(): void {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
	}

	private tick(): void {
		const s = this.state;
		if (s.paused || s.gameOver) return;

		s.frame++;

		// Death animation
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

		// Win animation
		if (s.won) {
			s.wonTimer--;
			if (s.wonTimer <= 0) {
				if (s.level >= LEVELS.length) {
					s.gameOver = true; // Beat the game!
				} else {
					loadLevel(s, s.level + 1);
				}
			}
			this.markDirty();
			return;
		}

		// Normal gameplay
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

		// Quit
		if (matchesKey(key, "escape") || key === "q" || key === "Q") {
			this.stopLoop();
			this.onSave(s.gameOver ? null : s);
			this.onClose();
			return;
		}

		// Restart
		if (key === "r" || key === "R") {
			Object.assign(this.state, createInitialState());
			this.markDirty();
			return;
		}

		// Pause
		if (key === "p" || key === "P") {
			s.paused = !s.paused;
			this.markDirty();
			return;
		}

		if (s.paused || s.gameOver) return;

		// Movement - hold-based
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
		if (this.releaseTimers[type]) {
			clearTimeout(this.releaseTimers[type]!);
		}
		const delay = type === "jump" ? 120 : 180;
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
				this.pad(`${MAGENTA}BADLOGIC GAME${RESET}`, width),
				"",
				this.pad(`Terminal too narrow (need ${minWidth})`, width),
				"",
				this.pad(`[Q] Quit`, width),
			];
		}

		if (this.version === this.cachedVersion && width === this.cachedWidth) {
			return this.cachedLines;
		}

		const s = this.state;
		const lines: string[] = [];

		// Header
		lines.push("");
		const hdr = `${MAGENTA}BADLOGIC${RESET}  ` +
			`Score: ${String(s.score).padStart(5, "0")}  ` +
			`${YELLOW}●${RESET}×${s.coins}  ` +
			`World ${s.level}  ` +
			`Lives: ${RED}${"♥".repeat(s.lives)}${RESET}`;
		lines.push(this.pad(hdr, width));
		lines.push("");

		// Game over / win
		if (s.gameOver) {
			const won = s.level > LEVELS.length || (s.won && s.level === LEVELS.length);
			if (won) {
				lines.push(this.pad(`${YELLOW}★ YOU WIN! ★${RESET}`, width));
			} else {
				lines.push(this.pad(`${RED}GAME OVER${RESET}`, width));
			}
			lines.push(this.pad(`Final Score: ${s.score}`, width));
			lines.push("");
			lines.push(this.pad(`[R] Restart  [Q] Quit`, width));
			this.cache(lines, width);
			return lines;
		}

		// Paused
		if (s.paused) {
			lines.push(this.pad(`${DIM}PAUSED${RESET}  [P] Resume  [R] Restart  [Q] Quit`, width));
			lines.push("");
		}

		// Won level
		if (s.won) {
			lines.push(this.pad(`${YELLOW}★ LEVEL CLEAR! ★${RESET}`, width));
			lines.push("");
		}

		// Dead
		if (s.dead) {
			lines.push(this.pad(`${RED}OUCH!${RESET}`, width));
			lines.push("");
		}

		// Render viewport
		const camX = Math.floor(s.cameraX);

		for (let y = 0; y < VIEWPORT_HEIGHT; y++) {
			let row = "";
			for (let x = 0; x < VIEWPORT_WIDTH; x++) {
				const wx = camX + x;
				const wy = y;

				// Player?
				const pScreenX = Math.floor(s.px) - camX;
				const pScreenY = Math.floor(s.py);
				if (x === pScreenX && y === pScreenY && !s.dead) {
					const blink = s.invincible > 0 && s.frame % 4 < 2;
					if (!blink) {
						const pChar = s.facingRight ? "►" : "◄";
						row += `${CYAN}${pChar}${RESET} `;
					} else {
						row += "  ";
					}
					continue;
				}

				// Enemy?
				let isEnemy = false;
				for (const e of s.enemies) {
					if (!e.alive) continue;
					const esx = Math.floor(e.x) - camX;
					const esy = Math.floor(e.y);
					if (x === esx && y === esy) {
						const eChar = e.vx > 0 ? "◄" : "►";
						row += `${RED}${eChar}${RESET} `;
						isEnemy = true;
						break;
					}
				}
				if (isEnemy) continue;

				// Tile
				const tile = getTile(s, wx, wy);
				row += this.renderTile(tile);
			}
			lines.push(this.pad(row, width));
		}

		// Controls
		lines.push("");
		lines.push(this.pad(`[←→/AD] Move  [↑/W/SPACE] Jump  [P] Pause  [R] Restart  [Q] Quit`, width));

		this.cache(lines, width);
		return lines;
	}

	private renderTile(t: string): string {
		switch (t) {
			case GROUND: return `${BROWN}██${RESET}`;
			case BRICK: return `${BROWN}▒▒${RESET}`;
			case COIN: return `${YELLOW}●${RESET} `;
			case SPIKE: return `${RED}▲▲${RESET}`;
			case GOAL: return `${GREEN}⚑${RESET} `;
			default: return `${BG_CYAN}  ${RESET}`;
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
		description: "Badlogic Platformer - run, jump, collect coins, avoid enemies!",
		args: [],
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("This game requires interactive mode", "error");
				return;
			}

			// Load saved state
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
