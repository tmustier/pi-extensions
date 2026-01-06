/**
 * Picman game extension - play with /picman
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

// Grid dimensions (maze is 21x21, each cell renders as 2 chars)
const MAZE_WIDTH = 21;
const MAZE_HEIGHT = 21;
const TICK_MS = 100;
const POWER_DURATION = 50; // ticks
const GHOST_RESPAWN_TICKS = 30;
const INITIAL_LIVES = 3;
const GHOST_MOVE_INTERVAL = 2; // ghosts move every N ticks
const PACMAN_MOVE_INTERVAL = 1; // pacman moves every tick

const PICMAN_SAVE_TYPE = "picman-save";

type Direction = "up" | "down" | "left" | "right";

// Maze cell types
const WALL = "#";
const DOT = ".";
const POWER = "O";
const EMPTY = " ";

// Classic Pac-Man inspired maze (simplified for terminal)
const MAZE_TEMPLATE = [
	"#####################",
	"#.........#.........#",
	"#O###.###.#.###.###O#",
	"#.###.###.#.###.###.#",
	"#...................#",
	"#.###.#.#####.#.###.#",
	"#.....#...#...#.....#",
	"#####.### # ###.#####",
	"    #.#  G G  #.#    ",
	"#####.# GGG G#.#####",
	"     .  GGG G .     ",
	"#####.# GGGGG #.#####",
	"    #.#       #.#    ",
	"#####.# ##### #.#####",
	"#.........#.........#",
	"#.###.###.#.###.###.#",
	"#O..#.....P.....#..O#",
	"###.#.#.#####.#.#.###",
	"#.....#...#...#.....#",
	"#.#######.#.#######.#",
	"#####################",
];

interface Position {
	x: number;
	y: number;
}

interface Ghost {
	x: number;
	y: number;
	direction: Direction;
	color: string;
	glyph: string;
	name: string;
	eaten: boolean;
	respawnTimer: number;
	homeX: number;
	homeY: number;
}

interface GameState {
	pacman: Position;
	pacmanDir: Direction;
	nextDir: Direction | null;
	ghosts: Ghost[];
	maze: string[][];
	score: number;
	highScore: number;
	lives: number;
	level: number;
	dotsRemaining: number;
	powerMode: number; // ticks remaining
	gameOver: boolean;
	won: boolean;
	paused: boolean;
	mouthOpen: boolean;
	deathAnimation: number;
	levelCompleteTimer: number;
	tickCount: number;
}

const DIRECTIONS: Record<Direction, Position> = {
	up: { x: 0, y: -1 },
	down: { x: 0, y: 1 },
	left: { x: -1, y: 0 },
	right: { x: 1, y: 0 },
};

const OPPOSITE: Record<Direction, Direction> = {
	up: "down",
	down: "up",
	left: "right",
	right: "left",
};

// ANSI colors (using bright variants for better visibility)
const RESET = "\x1b[0m";
const YELLOW = "\x1b[1;93m"; // Bold bright yellow
const BLUE = "\x1b[1;34m";   // Bold blue for walls
const WHITE = "\x1b[1;97m";  // Bold white
const DIM = "\x1b[2m";
const RED = "\x1b[1;91m";    // Bold bright red (Blinky)
const PINK = "\x1b[1;95m";   // Bold bright magenta (Pinky)
const CYAN = "\x1b[1;96m";   // Bold bright cyan (Inky)
const ORANGE = "\x1b[1;33m"; // Bold yellow/orange (Clyde)
const SCARED_COLOR = "\x1b[1;94m"; // Bold bright blue when scared

// Ghost configs - each has color and 2-char glyph
const GHOST_CONFIGS = [
	{ color: RED, glyph: "/\\", name: "Blinky" },
	{ color: PINK, glyph: "/\\", name: "Pinky" },
	{ color: CYAN, glyph: "/\\", name: "Inky" },
	{ color: ORANGE, glyph: "/\\", name: "Clyde" },
];

const createMaze = (): string[][] => {
	return MAZE_TEMPLATE.map((row) => row.split(""));
};

const countDots = (maze: string[][]): number => {
	let count = 0;
	for (const row of maze) {
		for (const cell of row) {
			if (cell === DOT || cell === POWER) count++;
		}
	}
	return count;
};

const findPacmanStart = (): Position => {
	for (let y = 0; y < MAZE_TEMPLATE.length; y++) {
		const x = MAZE_TEMPLATE[y].indexOf("P");
		if (x !== -1) return { x, y };
	}
	return { x: 10, y: 16 }; // fallback
};

const findGhostPositions = (): Position[] => {
	const positions: Position[] = [];
	for (let y = 0; y < MAZE_TEMPLATE.length; y++) {
		for (let x = 0; x < MAZE_TEMPLATE[y].length; x++) {
			if (MAZE_TEMPLATE[y][x] === "G") {
				positions.push({ x, y });
			}
		}
	}
	return positions;
};

const createGhosts = (): Ghost[] => {
	const positions = findGhostPositions();
	return positions.slice(0, 4).map((pos, i) => ({
		x: pos.x,
		y: pos.y,
		direction: "up" as Direction,
		color: GHOST_CONFIGS[i % GHOST_CONFIGS.length].color,
		glyph: GHOST_CONFIGS[i % GHOST_CONFIGS.length].glyph,
		name: GHOST_CONFIGS[i % GHOST_CONFIGS.length].name,
		eaten: false,
		respawnTimer: 0,
		homeX: pos.x,
		homeY: pos.y,
	}));
};

const createInitialState = (highScore = 0): GameState => {
	const maze = createMaze();
	const pacStart = findPacmanStart();
	// Clear P from maze
	maze[pacStart.y][pacStart.x] = EMPTY;
	// Clear G markers from maze (ghost house area)
	for (let y = 0; y < maze.length; y++) {
		for (let x = 0; x < maze[y].length; x++) {
			if (maze[y][x] === "G") maze[y][x] = EMPTY;
		}
	}

	return {
		pacman: pacStart,
		pacmanDir: "right",
		nextDir: null,
		ghosts: createGhosts(),
		maze,
		score: 0,
		highScore,
		lives: INITIAL_LIVES,
		level: 1,
		dotsRemaining: countDots(maze),
		powerMode: 0,
		gameOver: false,
		won: false,
		paused: false,
		mouthOpen: true,
		deathAnimation: 0,
		levelCompleteTimer: 0,
		tickCount: 0,
	};
};

const resetLevel = (state: GameState): void => {
	const maze = createMaze();
	const pacStart = findPacmanStart();
	maze[pacStart.y][pacStart.x] = EMPTY;
	for (let y = 0; y < maze.length; y++) {
		for (let x = 0; x < maze[y].length; x++) {
			if (maze[y][x] === "G") maze[y][x] = EMPTY;
		}
	}
	state.maze = maze;
	state.pacman = pacStart;
	state.pacmanDir = "right";
	state.nextDir = null;
	state.ghosts = createGhosts();
	state.dotsRemaining = countDots(maze);
	state.powerMode = 0;
	state.deathAnimation = 0;
	state.levelCompleteTimer = 0;
};

const resetPositions = (state: GameState): void => {
	const pacStart = findPacmanStart();
	state.pacman = pacStart;
	state.pacmanDir = "right";
	state.nextDir = null;
	state.powerMode = 0;
	state.deathAnimation = 0;
	for (const ghost of state.ghosts) {
		ghost.x = ghost.homeX;
		ghost.y = ghost.homeY;
		ghost.eaten = false;
		ghost.respawnTimer = 0;
	}
};

const isWalkable = (maze: string[][], x: number, y: number): boolean => {
	if (y < 0 || y >= maze.length) return false;
	// Tunnel wrapping
	if (x < 0 || x >= maze[0].length) return true;
	const cell = maze[y][x];
	return cell !== WALL;
};

const wrapPosition = (x: number, width: number): number => {
	if (x < 0) return width - 1;
	if (x >= width) return 0;
	return x;
};

const getValidDirections = (maze: string[][], x: number, y: number, exclude?: Direction): Direction[] => {
	const dirs: Direction[] = [];
	for (const dir of Object.keys(DIRECTIONS) as Direction[]) {
		if (dir === exclude) continue;
		const delta = DIRECTIONS[dir];
		const nx = x + delta.x;
		const ny = y + delta.y;
		if (isWalkable(maze, nx, ny)) {
			dirs.push(dir);
		}
	}
	return dirs;
};

const distance = (a: Position, b: Position): number => {
	return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
};

const moveGhost = (ghost: Ghost, state: GameState): void => {
	if (ghost.eaten) {
		ghost.respawnTimer--;
		if (ghost.respawnTimer <= 0) {
			ghost.eaten = false;
			ghost.x = ghost.homeX;
			ghost.y = ghost.homeY;
		}
		return;
	}

	const { maze, pacman, powerMode } = state;
	const validDirs = getValidDirections(maze, ghost.x, ghost.y, OPPOSITE[ghost.direction]);

	if (validDirs.length === 0) {
		// Dead end, reverse
		const delta = DIRECTIONS[OPPOSITE[ghost.direction]];
		if (isWalkable(maze, ghost.x + delta.x, ghost.y + delta.y)) {
			ghost.direction = OPPOSITE[ghost.direction];
			ghost.x = wrapPosition(ghost.x + delta.x, maze[0].length);
			ghost.y += delta.y;
		}
		return;
	}

	let targetDir: Direction;

	if (powerMode > 0) {
		// Run away from Pac-Man
		let bestDir = validDirs[0];
		let bestDist = -1;
		for (const dir of validDirs) {
			const delta = DIRECTIONS[dir];
			const nx = wrapPosition(ghost.x + delta.x, maze[0].length);
			const ny = ghost.y + delta.y;
			const dist = distance({ x: nx, y: ny }, pacman);
			if (dist > bestDist) {
				bestDist = dist;
				bestDir = dir;
			}
		}
		targetDir = bestDir;
	} else {
		// Chase Pac-Man with some personality
		let target = pacman;

		// Blinky: direct chase
		// Pinky: target 4 tiles ahead
		// Inky: complex targeting
		// Clyde: runs away when close
		if (ghost.name === "Pinky") {
			const delta = DIRECTIONS[state.pacmanDir];
			target = { x: pacman.x + delta.x * 4, y: pacman.y + delta.y * 4 };
		} else if (ghost.name === "Clyde") {
			if (distance({ x: ghost.x, y: ghost.y }, pacman) < 8) {
				// Run to corner
				target = { x: 0, y: maze.length - 1 };
			}
		}

		// Find direction that gets closest to target
		let bestDir = validDirs[0];
		let bestDist = Infinity;
		for (const dir of validDirs) {
			const delta = DIRECTIONS[dir];
			const nx = wrapPosition(ghost.x + delta.x, maze[0].length);
			const ny = ghost.y + delta.y;
			const dist = distance({ x: nx, y: ny }, target);
			if (dist < bestDist) {
				bestDist = dist;
				bestDir = dir;
			}
		}
		targetDir = bestDir;
	}

	ghost.direction = targetDir;
	const delta = DIRECTIONS[targetDir];
	ghost.x = wrapPosition(ghost.x + delta.x, maze[0].length);
	ghost.y += delta.y;
};

const movePacman = (state: GameState): void => {
	const { maze, pacman } = state;

	// Try next direction first
	if (state.nextDir) {
		const delta = DIRECTIONS[state.nextDir];
		if (isWalkable(maze, pacman.x + delta.x, pacman.y + delta.y)) {
			state.pacmanDir = state.nextDir;
			state.nextDir = null;
		}
	}

	// Move in current direction
	const delta = DIRECTIONS[state.pacmanDir];
	const nx = pacman.x + delta.x;
	const ny = pacman.y + delta.y;

	if (isWalkable(maze, nx, ny)) {
		pacman.x = wrapPosition(nx, maze[0].length);
		pacman.y = ny;

		// Eat dot
		const cell = maze[pacman.y][pacman.x];
		if (cell === DOT) {
			maze[pacman.y][pacman.x] = EMPTY;
			state.score += 10;
			state.dotsRemaining--;
		} else if (cell === POWER) {
			maze[pacman.y][pacman.x] = EMPTY;
			state.score += 50;
			state.dotsRemaining--;
			state.powerMode = POWER_DURATION;
		}
	}

	// Animate mouth every few ticks
	if (state.tickCount % 3 === 0) {
		state.mouthOpen = !state.mouthOpen;
	}
};

const checkCollisions = (state: GameState): void => {
	for (const ghost of state.ghosts) {
		if (ghost.eaten) continue;
		if (ghost.x === state.pacman.x && ghost.y === state.pacman.y) {
			if (state.powerMode > 0) {
				// Eat ghost
				ghost.eaten = true;
				ghost.respawnTimer = GHOST_RESPAWN_TICKS;
				state.score += 200;
			} else {
				// Pac-Man dies
				state.lives--;
				if (state.lives <= 0) {
					state.gameOver = true;
				} else {
					state.deathAnimation = 10;
				}
			}
		}
	}
};

class PacmanComponent {
	private state: GameState;
	private interval: ReturnType<typeof setInterval> | null = null;
	private onClose: () => void;
	private onSave: (state: GameState | null) => void;
	private tui: { requestRender: () => void };
	private cachedLines: string[] = [];
	private cachedWidth = 0;
	private version = 0;
	private cachedVersion = -1;
	private autoPausedForWidth = false;

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
		const { state } = this;
		if (state.paused || state.gameOver) return;

		state.tickCount++;

		// Death animation
		if (state.deathAnimation > 0) {
			state.deathAnimation--;
			if (state.deathAnimation === 0) {
				resetPositions(state);
			}
			this.version++;
			this.tui.requestRender();
			return;
		}

		// Level complete animation
		if (state.levelCompleteTimer > 0) {
			state.levelCompleteTimer--;
			if (state.levelCompleteTimer === 0) {
				state.level++;
				resetLevel(state);
			}
			this.version++;
			this.tui.requestRender();
			return;
		}

		// Check for level complete
		if (state.dotsRemaining === 0) {
			state.levelCompleteTimer = 20;
			this.version++;
			this.tui.requestRender();
			return;
		}

		// Decrement power mode
		if (state.powerMode > 0) {
			state.powerMode--;
		}

		// Move Pac-Man every tick
		if (state.tickCount % PACMAN_MOVE_INTERVAL === 0) {
			movePacman(state);
		}

		// Move ghosts at fixed intervals (faster at higher levels)
		const ghostInterval = Math.max(1, GHOST_MOVE_INTERVAL - Math.floor(state.level / 3));
		if (state.tickCount % ghostInterval === 0) {
			for (const ghost of state.ghosts) {
				moveGhost(ghost, state);
			}
		}

		// Check collisions
		checkCollisions(state);

		// Update high score
		if (state.score > state.highScore) {
			state.highScore = state.score;
		}

		this.version++;
		this.tui.requestRender();
	}

	handleInput(key: string): boolean {
		const { state } = this;

		// Quit
		if (matchesKey(key, "escape") || key === "q" || key === "Q") {
			this.onSave(state);
			this.onClose();
			return true;
		}

		// New game
		if (key === "n" || key === "N") {
			const highScore = state.highScore;
			Object.assign(this.state, createInitialState(highScore));
			this.version++;
			this.tui.requestRender();
			return true;
		}

		// Pause
		if (key === " " || key === "p" || key === "P") {
			state.paused = !state.paused;
			this.version++;
			this.tui.requestRender();
			return true;
		}

		if (state.gameOver || state.paused) return true;

		// Movement - arrow keys and vim keys
		if (matchesKey(key, "up") || key === "k" || key === "w") {
			state.nextDir = "up";
		} else if (matchesKey(key, "down") || key === "j" || key === "s") {
			state.nextDir = "down";
		} else if (matchesKey(key, "left") || key === "h" || key === "a") {
			state.nextDir = "left";
		} else if (matchesKey(key, "right") || key === "l" || key === "d") {
			state.nextDir = "right";
		}

		return true;
	}

	render(width: number, height: number): string[] {
		// Check minimum width
		const minWidth = MAZE_WIDTH * 2 + 4;
		if (width < minWidth) {
			if (!this.autoPausedForWidth && !this.state.paused) {
				this.state.paused = true;
				this.autoPausedForWidth = true;
			}
			return [
				"",
				this.padLine(`${YELLOW}PICMAN${RESET}`, width),
				"",
				this.padLine(`Terminal too narrow`, width),
				this.padLine(`Need ${minWidth} cols, have ${width}`, width),
				"",
				this.padLine(`[Q] Quit`, width),
			];
		}

		if (this.autoPausedForWidth) {
			this.state.paused = false;
			this.autoPausedForWidth = false;
		}

		if (this.cachedVersion === this.version && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const lines: string[] = [];
		const { state } = this;

		// Header
		lines.push("");
		const livesStr = Array(state.lives).fill(`${YELLOW}@${RESET}`).join(" ");
		const scoreText = `Score: ${WHITE}${state.score}${RESET}  Hi: ${state.highScore}  Lv: ${state.level}  Lives: ${livesStr}`;
		lines.push(this.padLine(`${YELLOW}PICMAN${RESET}  ${scoreText}`, width));
		lines.push("");

		// Game over message
		if (state.gameOver) {
			lines.push(this.padLine(`${YELLOW}GAME OVER${RESET}`, width));
			lines.push(this.padLine(`Final Score: ${state.score}`, width));
			lines.push("");
			lines.push(this.padLine(`[N] New Game  [Q] Quit`, width));
			lines.push("");
			this.cachedLines = lines;
			this.cachedVersion = this.version;
			this.cachedWidth = width;
			return lines;
		}

		// Paused message
		if (state.paused) {
			lines.push(this.padLine(`${DIM}PAUSED${RESET}`, width));
			lines.push(this.padLine(`[SPACE] Resume  [N] New  [Q] Quit`, width));
			lines.push("");
		}

		// Level complete animation
		if (state.levelCompleteTimer > 0) {
			lines.push(this.padLine(`${YELLOW}LEVEL ${state.level} COMPLETE!${RESET}`, width));
			lines.push("");
		}

		// Death animation
		if (state.deathAnimation > 0) {
			lines.push(this.padLine(`${RED}OUCH!${RESET}`, width));
			lines.push("");
		}

		// Render maze - all cells are exactly 2 characters wide
		for (let y = 0; y < state.maze.length; y++) {
			let row = "";
			for (let x = 0; x < state.maze[y].length; x++) {
				const cell = state.maze[y][x];
				let rendered = false;

				// Check if Pac-Man is here
				if (state.pacman.x === x && state.pacman.y === y && state.deathAnimation === 0) {
					const pacGlyph = this.getPacmanGlyph(state.pacmanDir, state.mouthOpen);
					row += `${YELLOW}${pacGlyph}${RESET}`;
					rendered = true;
				}

				// Check if a ghost is here
				if (!rendered) {
					for (const ghost of state.ghosts) {
						if (ghost.x === x && ghost.y === y && !ghost.eaten) {
							const isScared = state.powerMode > 0;
							const isBlinking = isScared && state.powerMode < 15 && state.tickCount % 4 < 2;
							const color = isBlinking ? WHITE : (isScared ? SCARED_COLOR : ghost.color);
							const glyph = isScared ? "vv" : ghost.glyph;
							row += `${color}${glyph}${RESET}`;
							rendered = true;
							break;
						}
					}
				}

				// Render cell
				if (!rendered) {
					switch (cell) {
						case WALL:
							row += `${BLUE}██${RESET}`;
							break;
						case DOT:
							row += ` •`;
							break;
						case POWER:
							row += `${WHITE}<>${RESET}`;
							break;
						case EMPTY:
						default:
							row += "  ";
							break;
					}
				}
			}
			lines.push(this.padLine(row, width));
		}

		// Controls
		lines.push("");
		const controls = state.powerMode > 0
			? `${YELLOW}POWER!${RESET} [Arrows/HJKL] Move  [SPACE] Pause  [Q] Quit`
			: `[Arrows/HJKL] Move  [SPACE] Pause  [N] New  [Q] Quit`;
		lines.push(this.padLine(controls, width));
		lines.push("");

		this.cachedLines = lines;
		this.cachedVersion = this.version;
		this.cachedWidth = width;
		return lines;
	}

	// All glyphs are exactly 2 characters
	private getPacmanGlyph(dir: Direction, mouthOpen: boolean): string {
		if (!mouthOpen) return "@@";
		switch (dir) {
			case "right": return "@>";
			case "left": return "<@";
			case "up": return "@^";
			case "down": return "@v";
		}
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
			ctx.ui.notify("Picman requires interactive mode", "error");
			return;
		}

		const entries = ctx.sessionManager.getEntries();
		let savedState: GameState | undefined;
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry.type === "custom" && entry.customType === PICMAN_SAVE_TYPE) {
				savedState = entry.data as GameState;
				break;
			}
		}

		await ctx.ui.custom((tui, _theme, done) => {
			return new PacmanComponent(
				tui,
				() => done(undefined),
				(state) => {
					pi.appendEntry(PICMAN_SAVE_TYPE, state);
				},
				savedState,
			);
		});
	};

	pi.registerCommand("picman", {
		description: "Play Picman! Eat dots, avoid ghosts, get power pellets!",
		handler: runGame,
	});
}
