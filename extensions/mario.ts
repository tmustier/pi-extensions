/**
 * Super Mario Bros style platformer - play with /mario
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

// Game constants
const VIEWPORT_WIDTH = 40;
const VIEWPORT_HEIGHT = 15;
const TICK_MS = 50;
const GRAVITY = 0.4;
const JUMP_FORCE = -2.2;
const MAX_FALL_SPEED = 1.5;
const MOVE_SPEED = 0.5;
const MAX_SPEED = 1.2;
const FRICTION = 0.85;
const INITIAL_LIVES = 3;
const MARIO_SAVE_TYPE = "mario-save";

// Block types
const EMPTY = " ";
const GROUND = "#";
const BRICK = "B";
const QUESTION = "?";
const QUESTION_USED = "X";
const PIPE_TOP_L = "[";
const PIPE_TOP_R = "]";
const PIPE_BODY_L = "{";
const PIPE_BODY_R = "}";
const COIN_BLOCK = "C";
const FLAG_POLE = "|";
const FLAG_TOP = "F";
const CASTLE = "^";

// Entity types
type EntityType = "goomba" | "koopa" | "mushroom" | "coin" | "fireball";

interface Entity {
	type: EntityType;
	x: number;
	y: number;
	vx: number;
	vy: number;
	alive: boolean;
	frame: number;
	data?: any; // koopa shell state, etc.
}

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	char: string;
	color: string;
	life: number;
}

interface GameState {
	// Mario state
	marioX: number;
	marioY: number;
	marioVX: number;
	marioVY: number;
	marioFacing: "left" | "right";
	isBig: boolean;
	isJumping: boolean;
	onGround: boolean;
	isDead: boolean;
	isWinning: boolean;
	winTimer: number;
	invincibleTimer: number;
	
	// Camera
	cameraX: number;
	
	// Level state
	level: number;
	levelData: string[][];
	levelWidth: number;
	entities: Entity[];
	particles: Particle[];
	
	// Game state
	score: number;
	coins: number;
	lives: number;
	time: number;
	gameOver: boolean;
	paused: boolean;
	
	// Animation
	frame: number;
	runFrame: number;
}

// Level definitions - each level is an array of strings
const LEVELS: string[][] = [
	// Level 1 - Classic intro
	[
		"                                                                                                                    F                    ",
		"                                                                                                                    |         ^          ",
		"                                                                                                                    |        ^^^         ",
		"                                                                              ?                                     |       ^^^^^        ",
		"                                                                                                                    |      ^^^^^^^       ",
		"                         ?   ?B?B?                                                   ?B?                            |                    ",
		"                                                                                                                    |                    ",
		"                                               []                                                []                 |                    ",
		"                  g                 g          {}          g            []       g               {}        g        |                    ",
		"                                               {}     g                {}                        {}                 |                    ",
		"M            BB                           BB   {}                      {}                   BB   {}                 |                    ",
		"            BBB                          BBB   {}                      {}                  BBB   {}                 |                    ",
		"############################################################################################################################################################################",
		"############################################################################################################################################################################",
		"############################################################################################################################################################################",
	],
	// Level 2 - More platforming
	[
		"                                                                                                                              F          ",
		"                                                                                                                              |    ^     ",
		"                                                                                                                              |   ^^^    ",
		"                                                                    ?                                              ?          |  ^^^^^   ",
		"                                                                                                                              |          ",
		"                    ?         ?B?          ?                                    ?B?             BBBB                          |          ",
		"                                                                                                                              |          ",
		"                                       []                                  []             []            []                    |          ",
		"                  g          g         {}       g         g                {}    g        {}     g      {}         g          |          ",
		"     []                                {}                      []          {}             {}             {}                   |          ",
		"M    {}      BBB          BBB          {}          BBB         {}          {}        BBB  {}        BBB  {}                   |          ",
		"     {}     BBBB         BBBB          {}         BBBB         {}          {}       BBBB  {}       BBBB  {}                   |          ",
		"#########      #####          #####    ########        ####    ########    ##############################################################################################################",
		"#########      #####          #####    ########        ####    ########    ##############################################################################################################",
		"#########      #####          #####    ########        ####    ########    ##############################################################################################################",
	],
];

const createLevel = (levelNum: number): { data: string[][], width: number, entities: Entity[] } => {
	const template = LEVELS[Math.min(levelNum - 1, LEVELS.length - 1)];
	const data = template.map(row => row.split(""));
	const width = data[0].length;
	const entities: Entity[] = [];
	
	// Find and create entities from level data
	for (let y = 0; y < data.length; y++) {
		for (let x = 0; x < data[y].length; x++) {
			const cell = data[y][x];
			if (cell === "g") {
				entities.push({
					type: "goomba",
					x, y,
					vx: -0.3,
					vy: 0,
					alive: true,
					frame: 0,
				});
				data[y][x] = EMPTY;
			} else if (cell === "k") {
				entities.push({
					type: "koopa",
					x, y: y - 1,
					vx: -0.3,
					vy: 0,
					alive: true,
					frame: 0,
					data: { shell: false },
				});
				data[y][x] = EMPTY;
			} else if (cell === "M") {
				// Mario start position marker - clear it
				data[y][x] = EMPTY;
			}
		}
	}
	
	return { data, width, entities };
};

const findMarioStart = (levelData: string[][]): { x: number, y: number } => {
	for (let y = 0; y < levelData.length; y++) {
		for (let x = 0; x < levelData[y].length; x++) {
			if (LEVELS[0][y]?.[x] === "M") {
				return { x, y: y - 1 };
			}
		}
	}
	return { x: 2, y: 10 };
};

const createInitialState = (): GameState => {
	const { data, width, entities } = createLevel(1);
	const start = findMarioStart(data);
	
	return {
		marioX: start.x,
		marioY: start.y,
		marioVX: 0,
		marioVY: 0,
		marioFacing: "right",
		isBig: false,
		isJumping: false,
		onGround: false,
		isDead: false,
		isWinning: false,
		winTimer: 0,
		invincibleTimer: 0,
		cameraX: 0,
		level: 1,
		levelData: data,
		levelWidth: width,
		entities,
		particles: [],
		score: 0,
		coins: 0,
		lives: INITIAL_LIVES,
		time: 400,
		gameOver: false,
		paused: false,
		frame: 0,
		runFrame: 0,
	};
};

const isSolid = (cell: string): boolean => {
	return cell === GROUND || cell === BRICK || cell === QUESTION || 
		   cell === QUESTION_USED || cell === PIPE_TOP_L || cell === PIPE_TOP_R ||
		   cell === PIPE_BODY_L || cell === PIPE_BODY_R || cell === COIN_BLOCK;
};

const getCell = (state: GameState, x: number, y: number): string => {
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	if (iy < 0 || iy >= state.levelData.length) return EMPTY;
	if (ix < 0 || ix >= state.levelWidth) return EMPTY;
	return state.levelData[iy]?.[ix] ?? EMPTY;
};

const setCell = (state: GameState, x: number, y: number, value: string): void => {
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	if (iy >= 0 && iy < state.levelData.length && ix >= 0 && ix < state.levelWidth) {
		state.levelData[iy][ix] = value;
	}
};

const addParticle = (state: GameState, x: number, y: number, char: string, color: string, vx = 0, vy = 0): void => {
	state.particles.push({ x, y, vx, vy, char, color, life: 20 });
};

const addBrickParticles = (state: GameState, x: number, y: number): void => {
	const brown = "\x1b[33m";
	for (let i = 0; i < 4; i++) {
		addParticle(state, x, y, "▪", brown, (Math.random() - 0.5) * 2, -Math.random() * 2);
	}
};

const hitBlock = (state: GameState, x: number, y: number): void => {
	const cell = getCell(state, x, y);
	
	if (cell === QUESTION || cell === COIN_BLOCK) {
		setCell(state, x, y, QUESTION_USED);
		// Spawn coin
		state.coins++;
		state.score += 200;
		addParticle(state, x, y - 1, "●", "\x1b[93m", 0, -1);
	} else if (cell === BRICK) {
		if (state.isBig) {
			setCell(state, x, y, EMPTY);
			addBrickParticles(state, x, y);
			state.score += 50;
		} else {
			// Small Mario just bumps the brick
			addParticle(state, x, y, "!", "\x1b[97m", 0, -0.5);
		}
	}
};

const spawnMushroom = (state: GameState, x: number, y: number): void => {
	state.entities.push({
		type: "mushroom",
		x, y: y - 1,
		vx: 0.5,
		vy: 0,
		alive: true,
		frame: 0,
	});
};

const updateMario = (state: GameState, keys: Set<string>): void => {
	if (state.isDead || state.isWinning) return;
	
	// Horizontal movement
	let accel = 0;
	if (keys.has("left")) {
		accel = -MOVE_SPEED;
		state.marioFacing = "left";
	}
	if (keys.has("right")) {
		accel = MOVE_SPEED;
		state.marioFacing = "right";
	}
	
	state.marioVX += accel;
	state.marioVX *= FRICTION;
	state.marioVX = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, state.marioVX));
	
	// Apply gravity
	state.marioVY += GRAVITY;
	state.marioVY = Math.min(MAX_FALL_SPEED, state.marioVY);
	
	// Jump
	if (keys.has("jump") && state.onGround && !state.isJumping) {
		state.marioVY = JUMP_FORCE;
		state.isJumping = true;
		state.onGround = false;
	}
	if (!keys.has("jump")) {
		state.isJumping = false;
		// Variable jump height - cut jump short if button released
		if (state.marioVY < -0.5) {
			state.marioVY *= 0.5;
		}
	}
	
	// Horizontal collision
	const newX = state.marioX + state.marioVX;
	const marioTop = state.isBig ? state.marioY - 1 : state.marioY;
	
	// Check horizontal collision
	let canMoveX = true;
	const checkX = state.marioVX > 0 ? Math.ceil(newX) : Math.floor(newX);
	for (let checkY = Math.floor(marioTop); checkY <= Math.floor(state.marioY); checkY++) {
		if (isSolid(getCell(state, checkX, checkY))) {
			canMoveX = false;
			break;
		}
	}
	
	if (canMoveX && newX >= 0) {
		state.marioX = newX;
	} else {
		state.marioVX = 0;
	}
	
	// Vertical collision
	const newY = state.marioY + state.marioVY;
	let canMoveY = true;
	
	if (state.marioVY > 0) {
		// Falling - check below
		const checkY = Math.floor(newY + 0.9);
		for (let checkX = Math.floor(state.marioX); checkX <= Math.floor(state.marioX + 0.9); checkX++) {
			if (isSolid(getCell(state, checkX, checkY))) {
				canMoveY = false;
				state.marioY = Math.floor(newY);
				state.marioVY = 0;
				state.onGround = true;
				break;
			}
		}
	} else if (state.marioVY < 0) {
		// Rising - check above
		const checkY = Math.floor(marioTop + state.marioVY);
		for (let checkX = Math.floor(state.marioX); checkX <= Math.floor(state.marioX + 0.9); checkX++) {
			if (isSolid(getCell(state, checkX, checkY))) {
				canMoveY = false;
				state.marioVY = 0;
				hitBlock(state, checkX, checkY);
				break;
			}
		}
	}
	
	if (canMoveY) {
		state.marioY = newY;
		if (state.marioVY > 0.1) {
			state.onGround = false;
		}
	}
	
	// Check if fell off
	if (state.marioY > state.levelData.length + 2) {
		killMario(state);
	}
	
	// Update run animation
	if (Math.abs(state.marioVX) > 0.1 && state.onGround) {
		state.runFrame = (state.runFrame + 1) % 4;
	}
	
	// Decrement invincibility
	if (state.invincibleTimer > 0) {
		state.invincibleTimer--;
	}
	
	// Check flag collision
	const cellHere = getCell(state, state.marioX, state.marioY);
	const cellAbove = getCell(state, state.marioX, state.marioY - 1);
	if (cellHere === FLAG_POLE || cellAbove === FLAG_POLE || cellHere === FLAG_TOP) {
		state.isWinning = true;
		state.winTimer = 60;
		state.score += Math.max(0, state.time) * 10;
	}
};

const killMario = (state: GameState): void => {
	if (state.invincibleTimer > 0) return;
	
	if (state.isBig) {
		state.isBig = false;
		state.invincibleTimer = 60;
	} else {
		state.isDead = true;
		state.marioVY = -2;
		state.lives--;
	}
};

const updateEntities = (state: GameState): void => {
	for (const entity of state.entities) {
		if (!entity.alive) continue;
		
		// Apply gravity
		entity.vy += GRAVITY * 0.5;
		entity.vy = Math.min(MAX_FALL_SPEED, entity.vy);
		
		// Move horizontally
		const newX = entity.x + entity.vx;
		let blocked = false;
		
		const checkX = entity.vx > 0 ? Math.ceil(newX) : Math.floor(newX);
		if (isSolid(getCell(state, checkX, Math.floor(entity.y)))) {
			entity.vx = -entity.vx;
			blocked = true;
		}
		
		if (!blocked) {
			entity.x = newX;
		}
		
		// Move vertically
		const newY = entity.y + entity.vy;
		const checkY = Math.floor(newY + 0.9);
		if (isSolid(getCell(state, Math.floor(entity.x), checkY))) {
			entity.y = Math.floor(newY);
			entity.vy = 0;
		} else {
			entity.y = newY;
		}
		
		// Fall off screen
		if (entity.y > state.levelData.length + 2) {
			entity.alive = false;
		}
		
		// Animation
		entity.frame = (entity.frame + 1) % 20;
	}
};

const checkEntityCollisions = (state: GameState): void => {
	if (state.isDead || state.invincibleTimer > 0) return;
	
	const marioLeft = state.marioX;
	const marioRight = state.marioX + 0.9;
	const marioTop = state.isBig ? state.marioY - 1 : state.marioY;
	const marioBottom = state.marioY + 0.9;
	
	for (const entity of state.entities) {
		if (!entity.alive) continue;
		
		const entLeft = entity.x;
		const entRight = entity.x + 0.9;
		const entTop = entity.y;
		const entBottom = entity.y + 0.9;
		
		// Check overlap
		if (marioRight > entLeft && marioLeft < entRight &&
			marioBottom > entTop && marioTop < entBottom) {
			
			if (entity.type === "mushroom") {
				entity.alive = false;
				state.isBig = true;
				state.score += 1000;
				addParticle(state, entity.x, entity.y, "1UP", "\x1b[92m", 0, -1);
			} else if (entity.type === "coin") {
				entity.alive = false;
				state.coins++;
				state.score += 200;
			} else if (entity.type === "goomba" || entity.type === "koopa") {
				// Check if stomping (Mario falling and above enemy)
				if (state.marioVY > 0 && marioBottom < entTop + 0.5) {
					entity.alive = false;
					state.score += 100;
					state.marioVY = -1.5; // Bounce
					addParticle(state, entity.x, entity.y, "💥", "\x1b[93m", 0, 0);
				} else {
					// Mario takes damage
					killMario(state);
				}
			}
		}
	}
};

const updateCamera = (state: GameState): void => {
	// Camera follows Mario with some lead room
	const targetX = state.marioX - VIEWPORT_WIDTH / 3;
	state.cameraX = Math.max(0, Math.min(targetX, state.levelWidth - VIEWPORT_WIDTH));
};

const updateParticles = (state: GameState): void => {
	for (const particle of state.particles) {
		particle.x += particle.vx;
		particle.y += particle.vy;
		particle.vy += 0.1;
		particle.life--;
	}
	state.particles = state.particles.filter(p => p.life > 0);
};

// Rendering
const RESET = "\x1b[0m";
const RED = "\x1b[91m";
const GREEN = "\x1b[92m";
const YELLOW = "\x1b[93m";
const BLUE = "\x1b[94m";
const BROWN = "\x1b[33m";
const WHITE = "\x1b[97m";
const CYAN = "\x1b[96m";
const BG_BLUE = "\x1b[44m";
const DIM = "\x1b[2m";

const getMarioChar = (state: GameState): string => {
	if (state.isDead) return "💀";
	
	const runChars = state.marioFacing === "right" 
		? ["🏃", "🚶", "🏃", "🚶"]
		: ["🏃", "🚶", "🏃", "🚶"];
	
	if (!state.onGround) {
		return state.marioFacing === "right" ? "🦘" : "🦘";
	}
	
	if (Math.abs(state.marioVX) > 0.1) {
		return runChars[Math.floor(state.runFrame / 2) % 2];
	}
	
	return "🧍";
};

const getEntityChar = (entity: Entity): string => {
	switch (entity.type) {
		case "goomba":
			return entity.frame < 10 ? "🍄" : "🍄";
		case "koopa":
			return "🐢";
		case "mushroom":
			return "🔴";
		case "coin":
			return "●";
		default:
			return "?";
	}
};

const renderCell = (cell: string, x: number, y: number, state: GameState): string => {
	switch (cell) {
		case GROUND:
			return `${BROWN}▓▓${RESET}`;
		case BRICK:
			return `${BROWN}▒▒${RESET}`;
		case QUESTION:
			return `${YELLOW}?${RESET}${YELLOW}?${RESET}`;
		case QUESTION_USED:
			return `${DIM}▒▒${RESET}`;
		case PIPE_TOP_L:
			return `${GREEN}╔═${RESET}`;
		case PIPE_TOP_R:
			return `${GREEN}═╗${RESET}`;
		case PIPE_BODY_L:
			return `${GREEN}║${RESET}${GREEN}░${RESET}`;
		case PIPE_BODY_R:
			return `${GREEN}░${RESET}${GREEN}║${RESET}`;
		case FLAG_POLE:
			return `${WHITE} |${RESET}`;
		case FLAG_TOP:
			return `${GREEN}▶|${RESET}`;
		case CASTLE:
			return `${BROWN}▓▓${RESET}`;
		case COIN_BLOCK:
			return `${YELLOW}¢¢${RESET}`;
		default:
			return `${BG_BLUE}  ${RESET}`;
	}
};

class MarioComponent {
	private state: GameState;
	private keys = new Set<string>();
	private interval: ReturnType<typeof setInterval> | null = null;
	private timeInterval: ReturnType<typeof setInterval> | null = null;
	private onClose: () => void;
	private onSave: (state: GameState | null) => void;
	private tui: { requestRender: () => void };
	private cachedLines: string[] = [];
	private cachedWidth = 0;
	private version = 0;
	private cachedVersion = -1;

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
			if (!this.state.paused && !this.state.gameOver && !this.state.isDead && !this.state.isWinning) {
				this.state.time--;
				if (this.state.time <= 0) {
					killMario(this.state);
				}
			}
		}, 1000);
	}

	private stopLoop(): void {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
		if (this.timeInterval) {
			clearInterval(this.timeInterval);
			this.timeInterval = null;
		}
	}

	private tick(): void {
		const { state } = this;
		if (state.paused || state.gameOver) return;
		
		state.frame++;
		
		// Death animation
		if (state.isDead) {
			state.marioVY += GRAVITY * 0.5;
			state.marioY += state.marioVY;
			
			if (state.marioY > state.levelData.length + 5) {
				if (state.lives <= 0) {
					state.gameOver = true;
				} else {
					// Reset level
					const { data, width, entities } = createLevel(state.level);
					const start = findMarioStart(data);
					state.levelData = data;
					state.levelWidth = width;
					state.entities = entities;
					state.marioX = start.x;
					state.marioY = start.y;
					state.marioVX = 0;
					state.marioVY = 0;
					state.isDead = false;
					state.isBig = false;
					state.time = 400;
				}
			}
			this.version++;
			this.tui.requestRender();
			return;
		}
		
		// Win animation
		if (state.isWinning) {
			state.winTimer--;
			if (state.winTimer <= 0) {
				// Next level
				state.level++;
				if (state.level > LEVELS.length) {
					state.gameOver = true; // Won the game!
				} else {
					const { data, width, entities } = createLevel(state.level);
					const start = findMarioStart(data);
					state.levelData = data;
					state.levelWidth = width;
					state.entities = entities;
					state.marioX = start.x;
					state.marioY = start.y;
					state.marioVX = 0;
					state.marioVY = 0;
					state.isWinning = false;
					state.time = 400;
				}
			}
			this.version++;
			this.tui.requestRender();
			return;
		}
		
		// Normal gameplay
		updateMario(state, this.keys);
		updateEntities(state);
		checkEntityCollisions(state);
		updateCamera(state);
		updateParticles(state);
		
		this.version++;
		this.tui.requestRender();
	}

	handleInput(key: string): boolean {
		const { state } = this;

		// Quit
		if (matchesKey(key, { key: "q" }) || matchesKey(key, { key: "escape" })) {
			this.onSave(state);
			this.onClose();
			return true;
		}

		// New game
		if (matchesKey(key, { key: "n" })) {
			Object.assign(this.state, createInitialState());
			this.version++;
			this.tui.requestRender();
			return true;
		}

		// Pause
		if (matchesKey(key, { key: "p" })) {
			state.paused = !state.paused;
			this.version++;
			this.tui.requestRender();
			return true;
		}

		if (state.gameOver || state.paused) return true;

		// Movement keys - track held state
		if (matchesKey(key, { key: "left" }) || matchesKey(key, { key: "a" }) || matchesKey(key, { key: "h" })) {
			this.keys.add("left");
			this.keys.delete("right");
		} else if (matchesKey(key, { key: "right" }) || matchesKey(key, { key: "d" }) || matchesKey(key, { key: "l" })) {
			this.keys.add("right");
			this.keys.delete("left");
		} else if (matchesKey(key, { key: "up" }) || matchesKey(key, { key: "w" }) || matchesKey(key, { key: "k" }) || matchesKey(key, { key: " " })) {
			this.keys.add("jump");
		}
		
		// Clear keys after a short delay (simulates key release)
		setTimeout(() => {
			this.keys.delete("left");
			this.keys.delete("right");
		}, 150);
		
		setTimeout(() => {
			this.keys.delete("jump");
		}, 100);

		return true;
	}

	render(width: number, height: number): string[] {
		const minWidth = VIEWPORT_WIDTH * 2 + 4;
		if (width < minWidth) {
			return [
				"",
				this.padLine(`${RED}SUPER MARIO${RESET}`, width),
				"",
				this.padLine(`Terminal too narrow`, width),
				this.padLine(`Need ${minWidth} cols, have ${width}`, width),
				"",
				this.padLine(`[Q] Quit`, width),
			];
		}

		if (this.cachedVersion === this.version && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const lines: string[] = [];
		const { state } = this;

		// Header
		lines.push("");
		const header = `${RED}MARIO${RESET}  ` +
			`Score: ${String(state.score).padStart(6, "0")}  ` +
			`Coins: ${YELLOW}●${RESET}×${state.coins}  ` +
			`World ${state.level}-1  ` +
			`Time: ${state.time}  ` +
			`Lives: ${"❤".repeat(state.lives)}`;
		lines.push(this.padLine(header, width));
		lines.push("");

		// Game over
		if (state.gameOver) {
			if (state.level > LEVELS.length) {
				lines.push(this.padLine(`${YELLOW}★ CONGRATULATIONS! ★${RESET}`, width));
				lines.push(this.padLine(`You saved the Princess!`, width));
			} else {
				lines.push(this.padLine(`${RED}GAME OVER${RESET}`, width));
			}
			lines.push(this.padLine(`Final Score: ${state.score}`, width));
			lines.push("");
			lines.push(this.padLine(`[N] New Game  [Q] Quit`, width));
			lines.push("");
			this.cachedLines = lines;
			this.cachedVersion = this.version;
			this.cachedWidth = width;
			return lines;
		}

		// Paused
		if (state.paused) {
			lines.push(this.padLine(`${DIM}PAUSED${RESET}`, width));
			lines.push(this.padLine(`[P] Resume  [N] New  [Q] Quit`, width));
			lines.push("");
		}

		// Win message
		if (state.isWinning) {
			lines.push(this.padLine(`${YELLOW}★ LEVEL CLEAR! ★${RESET}`, width));
			lines.push("");
		}

		// Render viewport
		const camX = Math.floor(state.cameraX);
		
		for (let y = 0; y < VIEWPORT_HEIGHT; y++) {
			let row = "";
			for (let x = 0; x < VIEWPORT_WIDTH; x++) {
				const worldX = camX + x;
				const worldY = y;
				let rendered = false;
				
				// Check for Mario
				const marioScreenX = Math.floor(state.marioX) - camX;
				const marioScreenY = Math.floor(state.marioY);
				const marioTopY = state.isBig ? marioScreenY - 1 : marioScreenY;
				
				if (x === marioScreenX && (y === marioScreenY || (state.isBig && y === marioTopY))) {
					// Blink when invincible
					if (state.invincibleTimer === 0 || state.frame % 4 < 2) {
						if (y === marioTopY && state.isBig) {
							row += `${RED}◆${RESET} `; // Big Mario top
						} else {
							row += getMarioChar(state) + " ";
						}
					} else {
						row += "  ";
					}
					rendered = true;
				}
				
				// Check for entities
				if (!rendered) {
					for (const entity of state.entities) {
						if (!entity.alive) continue;
						const entScreenX = Math.floor(entity.x) - camX;
						const entScreenY = Math.floor(entity.y);
						if (x === entScreenX && y === entScreenY) {
							const color = entity.type === "mushroom" ? RED : 
								         entity.type === "coin" ? YELLOW : BROWN;
							row += `${color}${getEntityChar(entity)}${RESET} `;
							rendered = true;
							break;
						}
					}
				}
				
				// Check for particles
				if (!rendered) {
					for (const particle of state.particles) {
						const pScreenX = Math.floor(particle.x) - camX;
						const pScreenY = Math.floor(particle.y);
						if (x === pScreenX && y === pScreenY) {
							row += `${particle.color}${particle.char.slice(0, 2).padEnd(2)}${RESET}`;
							rendered = true;
							break;
						}
					}
				}
				
				// Render terrain
				if (!rendered) {
					const cell = getCell(state, worldX, worldY);
					row += renderCell(cell, worldX, worldY, state);
				}
			}
			lines.push(this.padLine(row, width));
		}

		// Controls
		lines.push("");
		const controls = `[←→/AD] Move  [↑/W/SPACE] Jump  [P] Pause  [N] New  [Q] Quit`;
		lines.push(this.padLine(controls, width));
		lines.push("");

		this.cachedLines = lines;
		this.cachedVersion = this.version;
		this.cachedWidth = width;
		return lines;
	}

	private padLine(line: string, width: number): string {
		const truncated = truncateToWidth(line, width);
		const padding = Math.max(0, width - visibleWidth(truncated));
		return truncated + " ".repeat(padding);
	}

	dispose(): void {
		this.stopLoop();
	}
}

export default function (pi: ExtensionAPI) {
	const runGame = async (_args: string, ctx: ExtensionCommandContext) => {
		if (!ctx.hasUI) {
			ctx.ui.notify("Mario requires interactive mode", "error");
			return;
		}

		const entries = ctx.sessionManager.getEntries();
		let savedState: GameState | undefined;
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry.type === "custom" && entry.customType === MARIO_SAVE_TYPE) {
				savedState = entry.data as GameState;
				break;
			}
		}

		await ctx.ui.custom((tui, _theme, done) => {
			return new MarioComponent(
				tui,
				() => done(undefined),
				(state) => {
					pi.appendEntry(MARIO_SAVE_TYPE, state);
				},
				savedState,
			);
		});
	};

	pi.registerCommand("mario", {
		description: "Play Super Mario! Jump, collect coins, stomp goombas!",
		handler: runGame,
	});
}
