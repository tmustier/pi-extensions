/**
 * Picman game extension - play with /picman
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

const TICK_MS = 100;
const POWER_DURATION = 50;
const GHOST_RESPAWN_TICKS = 30;
const INITIAL_LIVES = 3;
const GHOST_MOVE_INTERVAL = 2;
const SAVE_TYPE = "picman-save";

type Direction = "up" | "down" | "left" | "right";

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

const DIRECTIONS: Record<Direction, { x: number; y: number }> = {
	up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
};
const OPPOSITE: Record<Direction, Direction> = { up: "down", down: "up", left: "right", right: "left" };

// ANSI colors
const [RESET, YELLOW, BLUE, WHITE, DIM, RED] = ["\x1b[0m", "\x1b[1;93m", "\x1b[1;34m", "\x1b[1;97m", "\x1b[2m", "\x1b[1;91m"];
const GHOST_COLORS = ["\x1b[1;91m", "\x1b[1;95m", "\x1b[1;96m", "\x1b[1;33m"]; // Red, Pink, Cyan, Orange
const GHOST_NAMES = ["Blinky", "Pinky", "Inky", "Clyde"];

interface Ghost {
	x: number; y: number; homeX: number; homeY: number;
	direction: Direction; color: string; name: string;
	eaten: boolean; respawnTimer: number;
}

interface GameState {
	pacman: { x: number; y: number };
	pacmanDir: Direction;
	nextDir: Direction | null;
	ghosts: Ghost[];
	maze: string[][];
	score: number; highScore: number; lives: number; level: number;
	dotsRemaining: number; powerMode: number; tickCount: number;
	gameOver: boolean; paused: boolean; mouthOpen: boolean;
	deathAnimation: number; levelCompleteTimer: number;
}

const findInMaze = (char: string): { x: number; y: number }[] => {
	const results: { x: number; y: number }[] = [];
	MAZE_TEMPLATE.forEach((row, y) => {
		for (let x = 0; x < row.length; x++) if (row[x] === char) results.push({ x, y });
	});
	return results;
};

const createMaze = (): string[][] => {
	const maze = MAZE_TEMPLATE.map(row => row.split(""));
	// Clear markers
	for (let y = 0; y < maze.length; y++)
		for (let x = 0; x < maze[y].length; x++)
			if (maze[y][x] === "P" || maze[y][x] === "G") maze[y][x] = " ";
	return maze;
};

const countDots = (maze: string[][]): number =>
	maze.flat().filter(c => c === "." || c === "O").length;

const createGhosts = (): Ghost[] =>
	findInMaze("G").slice(0, 4).map((pos, i) => ({
		x: pos.x, y: pos.y, homeX: pos.x, homeY: pos.y,
		direction: "up" as Direction, color: GHOST_COLORS[i], name: GHOST_NAMES[i],
		eaten: false, respawnTimer: 0,
	}));

const createState = (highScore = 0): GameState => {
	const maze = createMaze();
	const pacStart = findInMaze("P")[0] || { x: 10, y: 16 };
	return {
		pacman: pacStart, pacmanDir: "right", nextDir: null,
		ghosts: createGhosts(), maze,
		score: 0, highScore, lives: INITIAL_LIVES, level: 1,
		dotsRemaining: countDots(maze), powerMode: 0, tickCount: 0,
		gameOver: false, paused: false, mouthOpen: true,
		deathAnimation: 0, levelCompleteTimer: 0,
	};
};

const resetLevel = (s: GameState): void => {
	s.maze = createMaze();
	s.pacman = findInMaze("P")[0] || { x: 10, y: 16 };
	s.pacmanDir = "right"; s.nextDir = null;
	s.ghosts = createGhosts();
	s.dotsRemaining = countDots(s.maze);
	s.powerMode = s.deathAnimation = s.levelCompleteTimer = 0;
};

const resetPositions = (s: GameState): void => {
	s.pacman = findInMaze("P")[0] || { x: 10, y: 16 };
	s.pacmanDir = "right"; s.nextDir = null;
	s.powerMode = s.deathAnimation = 0;
	s.ghosts.forEach(g => { g.x = g.homeX; g.y = g.homeY; g.eaten = false; g.respawnTimer = 0; });
};

const isWalkable = (maze: string[][], x: number, y: number): boolean =>
	y >= 0 && y < maze.length && (x < 0 || x >= maze[0].length || maze[y][x] !== "#");

const wrap = (x: number, w: number): number => x < 0 ? w - 1 : x >= w ? 0 : x;

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
	Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

const getValidDirs = (maze: string[][], x: number, y: number, exclude?: Direction): Direction[] =>
	(Object.keys(DIRECTIONS) as Direction[]).filter(dir => {
		if (dir === exclude) return false;
		const d = DIRECTIONS[dir];
		return isWalkable(maze, x + d.x, y + d.y);
	});

const moveGhost = (g: Ghost, s: GameState): void => {
	if (g.eaten) {
		if (--g.respawnTimer <= 0) { g.eaten = false; g.x = g.homeX; g.y = g.homeY; }
		return;
	}

	const { maze, pacman, powerMode } = s;
	const validDirs = getValidDirs(maze, g.x, g.y, OPPOSITE[g.direction]);

	if (validDirs.length === 0) {
		const rev = OPPOSITE[g.direction], d = DIRECTIONS[rev];
		if (isWalkable(maze, g.x + d.x, g.y + d.y)) {
			g.direction = rev; g.x = wrap(g.x + d.x, maze[0].length); g.y += d.y;
		}
		return;
	}

	// Target: flee if scared, else chase with personality
	let target = pacman;
	if (powerMode <= 0) {
		if (g.name === "Pinky") {
			const d = DIRECTIONS[s.pacmanDir];
			target = { x: pacman.x + d.x * 4, y: pacman.y + d.y * 4 };
		} else if (g.name === "Clyde" && dist(g, pacman) < 8) {
			target = { x: 0, y: maze.length - 1 };
		}
	}

	// Pick best direction
	const bestDir = validDirs.reduce((best, dir) => {
		const d = DIRECTIONS[dir];
		const nx = wrap(g.x + d.x, maze[0].length), ny = g.y + d.y;
		const score = dist({ x: nx, y: ny }, target);
		const bestScore = dist({ x: wrap(g.x + DIRECTIONS[best].x, maze[0].length), y: g.y + DIRECTIONS[best].y }, target);
		return powerMode > 0 ? (score > bestScore ? dir : best) : (score < bestScore ? dir : best);
	}, validDirs[0]);

	g.direction = bestDir;
	const d = DIRECTIONS[bestDir];
	g.x = wrap(g.x + d.x, maze[0].length); g.y += d.y;
};

const movePacman = (s: GameState): void => {
	const { maze, pacman } = s;

	// Try queued direction
	if (s.nextDir) {
		const d = DIRECTIONS[s.nextDir];
		if (isWalkable(maze, pacman.x + d.x, pacman.y + d.y)) { s.pacmanDir = s.nextDir; s.nextDir = null; }
	}

	const d = DIRECTIONS[s.pacmanDir];
	if (isWalkable(maze, pacman.x + d.x, pacman.y + d.y)) {
		pacman.x = wrap(pacman.x + d.x, maze[0].length); pacman.y += d.y;
		const cell = maze[pacman.y][pacman.x];
		if (cell === ".") { maze[pacman.y][pacman.x] = " "; s.score += 10; s.dotsRemaining--; }
		else if (cell === "O") { maze[pacman.y][pacman.x] = " "; s.score += 50; s.dotsRemaining--; s.powerMode = POWER_DURATION; }
	}

	if (s.tickCount % 3 === 0) s.mouthOpen = !s.mouthOpen;
};

const checkCollisions = (s: GameState): void => {
	for (const g of s.ghosts) {
		if (g.eaten || g.x !== s.pacman.x || g.y !== s.pacman.y) continue;
		if (s.powerMode > 0) { g.eaten = true; g.respawnTimer = GHOST_RESPAWN_TICKS; s.score += 200; }
		else if (--s.lives <= 0) s.gameOver = true;
		else s.deathAnimation = 10;
	}
};

class PicmanComponent {
	private state: GameState;
	private interval: ReturnType<typeof setInterval> | null = null;
	private onClose: () => void;
	private onSave: (state: GameState) => void;
	private tui: { requestRender: () => void };
	private cache = { lines: [] as string[], width: 0, version: -1 };
	private version = 0;

	constructor(tui: { requestRender: () => void }, onClose: () => void, onSave: (s: GameState) => void, saved?: GameState) {
		this.tui = tui; this.onClose = onClose; this.onSave = onSave;
		this.state = saved ? { ...saved, paused: true } : createState();
		this.interval = setInterval(() => this.tick(), TICK_MS);
	}

	private tick(): void {
		const s = this.state;
		if (s.paused || s.gameOver) return;
		s.tickCount++;

		if (s.deathAnimation > 0) { if (--s.deathAnimation === 0) resetPositions(s); }
		else if (s.levelCompleteTimer > 0) { if (--s.levelCompleteTimer === 0) { s.level++; resetLevel(s); } }
		else if (s.dotsRemaining === 0) s.levelCompleteTimer = 20;
		else {
			if (s.powerMode > 0) s.powerMode--;
			movePacman(s);
			const ghostInterval = Math.max(1, GHOST_MOVE_INTERVAL - Math.floor(s.level / 3));
			if (s.tickCount % ghostInterval === 0) s.ghosts.forEach(g => moveGhost(g, s));
			checkCollisions(s);
			if (s.score > s.highScore) s.highScore = s.score;
		}

		this.version++;
		this.tui.requestRender();
	}

	handleInput(key: string): boolean {
		const s = this.state;
		if (matchesKey(key, "escape") || key === "q" || key === "Q") { this.onSave(s); this.onClose(); return true; }
		if (key === "n" || key === "N") { Object.assign(this.state, createState(s.highScore)); this.version++; this.tui.requestRender(); return true; }
		if (key === " " || key === "p" || key === "P") { s.paused = !s.paused; this.version++; this.tui.requestRender(); return true; }
		if (s.gameOver || s.paused) return true;

		const dirMap: Record<string, Direction> = { k: "up", w: "up", j: "down", s: "down", h: "left", a: "left", l: "right", d: "right" };
		if (matchesKey(key, "up")) s.nextDir = "up";
		else if (matchesKey(key, "down")) s.nextDir = "down";
		else if (matchesKey(key, "left")) s.nextDir = "left";
		else if (matchesKey(key, "right")) s.nextDir = "right";
		else if (dirMap[key]) s.nextDir = dirMap[key];
		return true;
	}

	render(width: number, _height: number): string[] {
		const pad = (line: string) => truncateToWidth(line, width) + " ".repeat(Math.max(0, width - visibleWidth(truncateToWidth(line, width))));
		const minWidth = MAZE_TEMPLATE[0].length * 2 + 4;

		if (width < minWidth) {
			return ["", pad(`${YELLOW}PICMAN${RESET}`), "", pad("Terminal too narrow"), pad(`Need ${minWidth} cols`), "", pad("[Q] Quit")];
		}

		if (this.cache.version === this.version && this.cache.width === width) return this.cache.lines;

		const s = this.state, lines: string[] = [""];
		const lives = Array(s.lives).fill(`${YELLOW}@${RESET}`).join(" ");
		lines.push(pad(`${YELLOW}PICMAN${RESET}  Score: ${WHITE}${s.score}${RESET}  Hi: ${s.highScore}  Lv: ${s.level}  ${lives}`));
		lines.push("");

		if (s.gameOver) {
			lines.push(pad(`${YELLOW}GAME OVER${RESET}`), pad(`Final Score: ${s.score}`), "", pad("[N] New Game  [Q] Quit"), "");
		} else {
			if (s.paused) lines.push(pad(`${DIM}PAUSED${RESET}`), pad("[SPACE] Resume  [N] New  [Q] Quit"), "");
			if (s.levelCompleteTimer > 0) lines.push(pad(`${YELLOW}LEVEL ${s.level} COMPLETE!${RESET}`), "");
			if (s.deathAnimation > 0) lines.push(pad(`${RED}OUCH!${RESET}`), "");

			for (let y = 0; y < s.maze.length; y++) {
				let row = "";
				for (let x = 0; x < s.maze[y].length; x++) {
					const cell = s.maze[y][x];
					if (s.pacman.x === x && s.pacman.y === y && s.deathAnimation === 0) {
						const glyph = s.mouthOpen ? ({ right: "@>", left: "<@", up: "@^", down: "@v" })[s.pacmanDir] : "@@";
						row += `${YELLOW}${glyph}${RESET}`;
					} else {
						const ghost = s.ghosts.find(g => g.x === x && g.y === y && !g.eaten);
						if (ghost) {
							const scared = s.powerMode > 0, blink = scared && s.powerMode < 15 && s.tickCount % 4 < 2;
							row += `${blink ? WHITE : scared ? "\x1b[1;94m" : ghost.color}${scared ? "vv" : "/\\"}${RESET}`;
						} else {
							row += cell === "#" ? `${BLUE}██${RESET}` : cell === "." ? " •" : cell === "O" ? `${WHITE}<>${RESET}` : "  ";
						}
					}
				}
				lines.push(pad(row));
			}

			lines.push("", pad(s.powerMode > 0 ? `${YELLOW}POWER!${RESET} [Arrows/HJKL] Move  [SPACE] Pause  [Q] Quit` : "[Arrows/HJKL] Move  [SPACE] Pause  [N] New  [Q] Quit"), "");
		}

		this.cache = { lines, width, version: this.version };
		return lines;
	}

	dispose(): void { if (this.interval) clearInterval(this.interval); }
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("picman", {
		description: "Play Picman! Eat dots, avoid ghosts, get power pellets!",
		handler: async (_args, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) { ctx.ui.notify("Picman requires interactive mode", "error"); return; }

			const entries = ctx.sessionManager.getEntries();
			const saved = entries.reverse().find(e => e.type === "custom" && e.customType === SAVE_TYPE)?.data as GameState | undefined;

			await ctx.ui.custom((tui, _theme, done) => new PicmanComponent(tui, () => done(undefined), s => pi.appendEntry(SAVE_TYPE, s), saved));
		},
	});
}
