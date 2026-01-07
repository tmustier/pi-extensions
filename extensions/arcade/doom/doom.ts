/**
 * ASCII Doom - First-person raycasting shooter. Play with /doom
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { matchesKey } from "@mariozechner/pi-tui";

// ============================================================================
// CONSTANTS
// ============================================================================

const TICK_MS = 50;
const FOV = Math.PI / 3; // 60 degrees
const MOVE_SPEED = 0.08;
const ROT_SPEED = 0.06;
const MAX_DEPTH = 16;
const SAVE_TYPE = "doom-save";

// ASCII shading characters (darkest to lightest)
const WALL_SHADES = ["█", "▓", "▒", "░", " "];
const FLOOR_CHAR = ".";
const CEILING_CHAR = " ";

// ANSI colors
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";
const BG_RED = "\x1b[41m";

// ============================================================================
// LEVEL DATA (doom-002, doom-007)
// ============================================================================

// Legend: # = wall, . = floor, P = player spawn, E = exit
const LEVEL_1 = [
	"################",
	"#..............#",
	"#..............#",
	"#....####......#",
	"#....#..#......#",
	"#....#..#......#",
	"#....####......#",
	"#..............#",
	"#.........###..#",
	"#.........#E#..#",
	"#..P......###..#",
	"#..............#",
	"#..............#",
	"################",
];

// ============================================================================
// TYPES
// ============================================================================

type GameScreen = "title" | "game" | "paused" | "help" | "gameover" | "victory";

interface Player {
	x: number;
	y: number;
	angle: number; // radians, 0 = facing right (+x)
	health: number;
	maxHealth: number;
	ammo: number;
	maxAmmo: number;
}

interface GameState {
	screen: GameScreen;
	player: Player;
	map: string[];
	mapWidth: number;
	mapHeight: number;
	level: number;
	kills: number;
	totalEnemies: number;
	itemsCollected: number;
	totalItems: number;
	secretsFound: number;
	totalSecrets: number;
	startTime: number;
	damageFlash: number; // ticks remaining for red flash
	muzzleFlash: number; // ticks remaining for muzzle flash
}

// ============================================================================
// MAP FUNCTIONS (doom-002)
// ============================================================================

function parseMap(levelData: string[]): { map: string[]; playerX: number; playerY: number; playerAngle: number } {
	let playerX = 1.5;
	let playerY = 1.5;
	const playerAngle = 0;

	const map = levelData.map((row, y) => {
		const pIndex = row.indexOf("P");
		if (pIndex !== -1) {
			playerX = pIndex + 0.5;
			playerY = y + 0.5;
			return row.replace("P", ".");
		}
		return row;
	});

	return { map, playerX, playerY, playerAngle };
}

function isWall(map: string[], x: number, y: number): boolean {
	const mapY = Math.floor(y);
	const mapX = Math.floor(x);
	if (mapY < 0 || mapY >= map.length) return true;
	if (mapX < 0 || mapX >= map[mapY].length) return true;
	return map[mapY][mapX] === "#";
}

function isExit(map: string[], x: number, y: number): boolean {
	const mapY = Math.floor(y);
	const mapX = Math.floor(x);
	if (mapY < 0 || mapY >= map.length) return false;
	if (mapX < 0 || mapX >= map[mapY].length) return false;
	return map[mapY][mapX] === "E";
}

// ============================================================================
// PLAYER MOVEMENT (doom-003, doom-024)
// ============================================================================

function movePlayer(state: GameState, forward: number, strafe: number): void {
	const { player, map } = state;
	const cos = Math.cos(player.angle);
	const sin = Math.sin(player.angle);

	// Calculate intended movement
	let dx = cos * forward - sin * strafe;
	let dy = sin * forward + cos * strafe;

	// Normalize diagonal movement
	const len = Math.sqrt(dx * dx + dy * dy);
	if (len > 0) {
		dx = (dx / len) * MOVE_SPEED;
		dy = (dy / len) * MOVE_SPEED;
	}

	const newX = player.x + dx;
	const newY = player.y + dy;
	const margin = 0.2; // Collision margin

	// Wall sliding collision (doom-024)
	// Try full movement first
	if (!isWall(map, newX, newY)) {
		player.x = newX;
		player.y = newY;
	} else {
		// Try X-only movement (slide along Y wall)
		if (!isWall(map, newX, player.y) && 
			!isWall(map, newX + margin, player.y) && 
			!isWall(map, newX - margin, player.y)) {
			player.x = newX;
		}
		// Try Y-only movement (slide along X wall)
		if (!isWall(map, player.x, newY) && 
			!isWall(map, player.x, newY + margin) && 
			!isWall(map, player.x, newY - margin)) {
			player.y = newY;
		}
	}

	// Check for exit
	if (isExit(map, player.x, player.y)) {
		state.screen = "victory";
	}
}

function rotatePlayer(player: Player, amount: number): void {
	player.angle += amount;
	// Normalize angle to 0-2π
	while (player.angle < 0) player.angle += Math.PI * 2;
	while (player.angle >= Math.PI * 2) player.angle -= Math.PI * 2;
}

// ============================================================================
// RAYCASTING ENGINE (doom-004)
// ============================================================================

interface RayHit {
	distance: number;
	wallX: number; // 0-1, where on the wall the ray hit (for texturing)
	side: 0 | 1; // 0 = hit vertical wall (N/S), 1 = hit horizontal wall (E/W)
}

function castRay(map: string[], px: number, py: number, angle: number): RayHit {
	const dx = Math.cos(angle);
	const dy = Math.sin(angle);

	// DDA algorithm
	let mapX = Math.floor(px);
	let mapY = Math.floor(py);

	const deltaDistX = dx === 0 ? 1e10 : Math.abs(1 / dx);
	const deltaDistY = dy === 0 ? 1e10 : Math.abs(1 / dy);

	const stepX = dx < 0 ? -1 : 1;
	const stepY = dy < 0 ? -1 : 1;

	let sideDistX = dx < 0 ? (px - mapX) * deltaDistX : (mapX + 1 - px) * deltaDistX;
	let sideDistY = dy < 0 ? (py - mapY) * deltaDistY : (mapY + 1 - py) * deltaDistY;

	let side: 0 | 1 = 0;
	let distance = 0;

	// Step through grid
	for (let i = 0; i < MAX_DEPTH * 2; i++) {
		if (sideDistX < sideDistY) {
			sideDistX += deltaDistX;
			mapX += stepX;
			side = 0;
		} else {
			sideDistY += deltaDistY;
			mapY += stepY;
			side = 1;
		}

		// Check if we hit a wall
		if (mapY >= 0 && mapY < map.length && mapX >= 0 && mapX < map[mapY].length) {
			if (map[mapY][mapX] === "#") {
				// Calculate distance (perpendicular to avoid fisheye)
				if (side === 0) {
					distance = sideDistX - deltaDistX;
				} else {
					distance = sideDistY - deltaDistY;
				}

				// Calculate wall X for texturing
				let wallX: number;
				if (side === 0) {
					wallX = py + distance * dy;
				} else {
					wallX = px + distance * dx;
				}
				wallX -= Math.floor(wallX);

				return { distance, wallX, side };
			}
		} else {
			// Out of bounds
			return { distance: MAX_DEPTH, wallX: 0, side: 0 };
		}
	}

	return { distance: MAX_DEPTH, wallX: 0, side: 0 };
}

// ============================================================================
// ASCII RENDERING (doom-005, doom-006, doom-006b, doom-015, doom-016)
// ============================================================================

function render3DView(state: GameState, width: number, height: number): string[] {
	const { player, map, damageFlash } = state;
	const lines: string[] = [];

	// Reserve space for HUD
	const viewHeight = height - 3;
	const halfHeight = Math.floor(viewHeight / 2);

	// Cast a ray for each column
	for (let y = 0; y < viewHeight; y++) {
		let line = "";
		for (let x = 0; x < width; x++) {
			// Calculate ray angle for this column
			const rayAngle = player.angle - FOV / 2 + (x / width) * FOV;
			const hit = castRay(map, player.x, player.y, rayAngle);

			// Calculate wall height on screen
			const wallHeight = Math.floor(viewHeight / (hit.distance + 0.0001));
			const wallTop = halfHeight - Math.floor(wallHeight / 2);
			const wallBottom = halfHeight + Math.floor(wallHeight / 2);

			let char: string;
			let color = "";

			if (y < wallTop) {
				// Ceiling
				char = CEILING_CHAR;
				color = DIM;
			} else if (y >= wallBottom) {
				// Floor - shade by distance from center
				const floorDist = (y - halfHeight) / halfHeight;
				if (floorDist > 0.7) {
					char = FLOOR_CHAR;
					color = DIM;
				} else if (floorDist > 0.4) {
					char = FLOOR_CHAR;
					color = "";
				} else {
					char = FLOOR_CHAR;
					color = DIM;
				}
			} else {
				// Wall - shade by distance
				const shadeIndex = Math.min(
					Math.floor(hit.distance / (MAX_DEPTH / WALL_SHADES.length)),
					WALL_SHADES.length - 1
				);
				char = WALL_SHADES[shadeIndex];

				// Darken sides hit by horizontal rays for depth perception
				if (hit.side === 1) {
					color = DIM;
				} else {
					color = "";
				}
			}

			// Crosshair (doom-016)
			const centerX = Math.floor(width / 2);
			const centerY = Math.floor(viewHeight / 2);
			if (y === centerY && (x === centerX - 1 || x === centerX + 1)) {
				char = "-";
				color = GREEN;
			} else if (x === centerX && (y === centerY - 1 || y === centerY + 1)) {
				char = "|";
				color = GREEN;
			} else if (x === centerX && y === centerY) {
				char = "+";
				color = GREEN + BOLD;
			}

			// Damage flash overlay
			if (damageFlash > 0 && char !== " ") {
				color = RED;
			}

			line += color + char + RESET;
		}
		lines.push(line);
	}

	return lines;
}

function renderMinimap(state: GameState, size: number): string[] {
	const { player, map } = state;
	const lines: string[] = [];
	const halfSize = Math.floor(size / 2);

	const playerMapX = Math.floor(player.x);
	const playerMapY = Math.floor(player.y);

	for (let dy = -halfSize; dy <= halfSize; dy++) {
		let line = "";
		for (let dx = -halfSize; dx <= halfSize; dx++) {
			const mapX = playerMapX + dx;
			const mapY = playerMapY + dy;

			if (dx === 0 && dy === 0) {
				// Player direction indicator
				const dir = Math.round((player.angle / (Math.PI * 2)) * 8) % 8;
				const arrows = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"];
				line += CYAN + arrows[dir] + RESET;
			} else if (mapY >= 0 && mapY < map.length && mapX >= 0 && mapX < map[mapY].length) {
				const cell = map[mapY][mapX];
				if (cell === "#") {
					line += DIM + "█" + RESET;
				} else if (cell === "E") {
					line += GREEN + "E" + RESET;
				} else {
					line += DIM + "·" + RESET;
				}
			} else {
				line += " ";
			}
		}
		lines.push(line);
	}

	return lines;
}

function renderHUD(state: GameState, width: number): string[] {
	const { player, level, ammo } = state;

	// Health bar
	const healthPct = player.health / player.maxHealth;
	const healthBarWidth = 10;
	const healthFilled = Math.round(healthPct * healthBarWidth);
	const healthColor = healthPct > 0.6 ? GREEN : healthPct > 0.3 ? YELLOW : RED;
	const healthBar = healthColor + "█".repeat(healthFilled) + DIM + "░".repeat(healthBarWidth - healthFilled) + RESET;

	// Ammo
	const ammoStr = `${YELLOW}AMMO:${RESET} ${player.ammo}/${player.maxAmmo}`;

	// Level
	const levelStr = `${CYAN}LEVEL ${level}${RESET}`;

	// Build HUD line
	const hud1 = `${RED}HP${RESET} [${healthBar}] ${player.health}/${player.maxHealth}  ${ammoStr}  ${levelStr}`;

	// Separator
	const separator = DIM + "─".repeat(width) + RESET;

	return [separator, hud1];
}

function renderWeaponSprite(width: number, muzzleFlash: number): string[] {
	// Simple ASCII pistol (doom-015)
	const centerX = Math.floor(width / 2);
	const padding = " ".repeat(Math.max(0, centerX - 8));

	if (muzzleFlash > 0) {
		return [
			padding + `    ${YELLOW}\\|/${RESET}`,
			padding + `    ${YELLOW}*${RESET}${WHITE}═╦═${RESET}`,
			padding + `   ${WHITE}╔═╩═╗${RESET}`,
			padding + `   ${WHITE}║ ▪ ║${RESET}`,
		];
	}

	return [
		padding + "        ",
		padding + `   ${WHITE}═╦═${RESET}  `,
		padding + `  ${WHITE}╔═╩═╗${RESET}`,
		padding + `  ${WHITE}║ ▪ ║${RESET}`,
	];
}

function renderTitleScreen(width: number, height: number): string[] {
	const lines: string[] = [];
	const centerY = Math.floor(height / 2) - 6;

	// ASCII art title
	const title = [
		` ██████╗  ██████╗  ██████╗ ███╗   ███╗`,
		` ██╔══██╗██╔═══██╗██╔═══██╗████╗ ████║`,
		` ██║  ██║██║   ██║██║   ██║██╔████╔██║`,
		` ██║  ██║██║   ██║██║   ██║██║╚██╔╝██║`,
		` ██████╔╝╚██████╔╝╚██████╔╝██║ ╚═╝ ██║`,
		` ╚═════╝  ╚═════╝  ╚═════╝ ╚═╝     ╚═╝`,
	];

	for (let i = 0; i < centerY; i++) lines.push("");

	const titlePadding = Math.floor((width - 38) / 2);
	for (const line of title) {
		lines.push(" ".repeat(Math.max(0, titlePadding)) + RED + line + RESET);
	}

	lines.push("");
	lines.push("");
	const subtitle = "ASCII TERMINAL EDITION";
	lines.push(" ".repeat(Math.floor((width - subtitle.length) / 2)) + DIM + subtitle + RESET);

	lines.push("");
	lines.push("");
	const prompt1 = "Press ENTER to start";
	lines.push(" ".repeat(Math.floor((width - prompt1.length) / 2)) + GREEN + prompt1 + RESET);

	const prompt2 = "Press H for controls";
	lines.push(" ".repeat(Math.floor((width - prompt2.length) / 2)) + DIM + prompt2 + RESET);

	const prompt3 = "Press ESC to quit";
	lines.push(" ".repeat(Math.floor((width - prompt3.length) / 2)) + DIM + prompt3 + RESET);

	while (lines.length < height) lines.push("");

	return lines;
}

function renderHelpScreen(width: number, height: number): string[] {
	const lines: string[] = [];

	const content = [
		`${CYAN}${BOLD}═══ CONTROLS ═══${RESET}`,
		"",
		`${WHITE}MOVEMENT${RESET}`,
		`  W / ↑      Move forward`,
		`  S / ↓      Move backward`,
		`  A          Strafe left`,
		`  D          Strafe right`,
		`  Q / ←      Turn left`,
		`  E / →      Turn right`,
		"",
		`${WHITE}ACTIONS${RESET}`,
		`  SPACE      Shoot`,
		`  1-3        Switch weapon`,
		`  TAB        Toggle automap`,
		"",
		`${WHITE}SYSTEM${RESET}`,
		`  P / ESC    Pause game`,
		`  H          This help screen`,
		"",
		`${DIM}Press any key to return${RESET}`,
	];

	const startY = Math.floor((height - content.length) / 2);
	for (let i = 0; i < startY; i++) lines.push("");

	for (const line of content) {
		const padding = Math.floor((width - 30) / 2);
		lines.push(" ".repeat(Math.max(0, padding)) + line);
	}

	while (lines.length < height) lines.push("");

	return lines;
}

function renderPauseScreen(width: number, height: number): string[] {
	const lines: string[] = [];
	const centerY = Math.floor(height / 2) - 3;

	for (let i = 0; i < centerY; i++) lines.push("");

	const title = "══ PAUSED ══";
	lines.push(" ".repeat(Math.floor((width - title.length) / 2)) + YELLOW + BOLD + title + RESET);
	lines.push("");
	lines.push(" ".repeat(Math.floor((width - 20) / 2)) + "P / ESC  Resume");
	lines.push(" ".repeat(Math.floor((width - 20) / 2)) + "H        Controls");
	lines.push(" ".repeat(Math.floor((width - 20) / 2)) + "Q        Quit to title");

	while (lines.length < height) lines.push("");

	return lines;
}

function renderGameOverScreen(width: number, height: number): string[] {
	const lines: string[] = [];
	const centerY = Math.floor(height / 2) - 4;

	for (let i = 0; i < centerY; i++) lines.push("");

	const skull = [
		"   ______   ",
		"  /      \\  ",
		" |  x  x  | ",
		" |    ▲   | ",
		" |  \\___/  |",
		"  \\______/  ",
	];

	for (const line of skull) {
		lines.push(" ".repeat(Math.floor((width - 12) / 2)) + RED + line + RESET);
	}

	lines.push("");
	const title = "YOU DIED";
	lines.push(" ".repeat(Math.floor((width - title.length) / 2)) + RED + BOLD + title + RESET);
	lines.push("");
	lines.push(" ".repeat(Math.floor((width - 20) / 2)) + "Press ENTER to restart");
	lines.push(" ".repeat(Math.floor((width - 20) / 2)) + "Press ESC for title");

	while (lines.length < height) lines.push("");

	return lines;
}

function renderVictoryScreen(state: GameState, width: number, height: number): string[] {
	const lines: string[] = [];
	const centerY = Math.floor(height / 2) - 5;

	for (let i = 0; i < centerY; i++) lines.push("");

	const title = "══ LEVEL COMPLETE ══";
	lines.push(" ".repeat(Math.floor((width - title.length) / 2)) + GREEN + BOLD + title + RESET);
	lines.push("");

	const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
	const mins = Math.floor(elapsed / 60);
	const secs = elapsed % 60;

	const stats = [
		`Time: ${mins}:${secs.toString().padStart(2, "0")}`,
		`Kills: ${state.kills}/${state.totalEnemies}`,
		`Items: ${state.itemsCollected}/${state.totalItems}`,
		`Secrets: ${state.secretsFound}/${state.totalSecrets}`,
	];

	for (const stat of stats) {
		lines.push(" ".repeat(Math.floor((width - stat.length) / 2)) + stat);
	}

	lines.push("");
	lines.push(" ".repeat(Math.floor((width - 25) / 2)) + GREEN + "Press ENTER to continue" + RESET);

	while (lines.length < height) lines.push("");

	return lines;
}

// ============================================================================
// GAME STATE MANAGEMENT
// ============================================================================

function createGameState(level: number = 1): GameState {
	const levelData = LEVEL_1; // TODO: multiple levels
	const { map, playerX, playerY, playerAngle } = parseMap(levelData);

	return {
		screen: "title",
		player: {
			x: playerX,
			y: playerY,
			angle: playerAngle,
			health: 100,
			maxHealth: 100,
			ammo: 50,
			maxAmmo: 200,
		},
		map,
		mapWidth: map[0]?.length || 0,
		mapHeight: map.length,
		level,
		kills: 0,
		totalEnemies: 0, // TODO: count from level
		itemsCollected: 0,
		totalItems: 0, // TODO: count from level
		secretsFound: 0,
		totalSecrets: 0, // TODO: count from level
		startTime: Date.now(),
		damageFlash: 0,
		muzzleFlash: 0,
	};
}

function startGame(state: GameState): void {
	const { map, playerX, playerY, playerAngle } = parseMap(LEVEL_1);
	state.map = map;
	state.player.x = playerX;
	state.player.y = playerY;
	state.player.angle = playerAngle;
	state.player.health = state.player.maxHealth;
	state.player.ammo = 50;
	state.screen = "game";
	state.startTime = Date.now();
	state.kills = 0;
	state.itemsCollected = 0;
	state.secretsFound = 0;
	state.damageFlash = 0;
	state.muzzleFlash = 0;
}

// ============================================================================
// MAIN RENDER FUNCTION
// ============================================================================

function renderGame(state: GameState, width: number, height: number): string[] {
	switch (state.screen) {
		case "title":
			return renderTitleScreen(width, height);
		case "help":
			return renderHelpScreen(width, height);
		case "paused":
			return renderPauseScreen(width, height);
		case "gameover":
			return renderGameOverScreen(width, height);
		case "victory":
			return renderVictoryScreen(state, width, height);
		case "game": {
			const lines: string[] = [];

			// 3D view
			const viewLines = render3DView(state, width, height - 6);
			lines.push(...viewLines);

			// HUD
			const hudLines = renderHUD(state, width);
			lines.push(...hudLines);

			// Weapon sprite at bottom
			const weaponLines = renderWeaponSprite(width, state.muzzleFlash);
			// Overlay weapon on last few lines
			// (skip for now to keep simple, weapon shown in HUD area)

			// Minimap overlay in top-right
			const minimap = renderMinimap(state, 7);
			for (let i = 0; i < minimap.length && i < lines.length; i++) {
				const mapLine = minimap[i];
				const mainLine = lines[i];
				// Strip ANSI to measure, then overlay
				const visLen = mainLine.replace(/\x1b\[[0-9;]*m/g, "").length;
				const padding = Math.max(0, width - 10 - mapLine.length);
				lines[i] = mainLine.substring(0, padding * 2) + " " + mapLine;
			}

			return lines;
		}
	}
}

// ============================================================================
// EXTENSION ENTRY POINT (doom-001)
// ============================================================================

export default function (pi: ExtensionAPI) {
	pi.registerCommand("doom", {
		description: "Play ASCII Doom - first-person shooter",
		handler: async (args, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Doom requires interactive mode", "error");
				return;
			}

			await ctx.waitForIdle();

			// Try to restore saved state
			let state = createGameState();

			// TODO: restore from save (doom-012)

			await ctx.ui.custom<void>((tui, theme, done) => {
				let tickTimer: ReturnType<typeof setInterval> | null = null;

				const component = {
					x: 0,
					y: 0,
					width: 0,
					height: 0,
					visible: true,
					parent: null as any,

					layout(x: number, y: number, width: number, height: number) {
						this.x = x;
						this.y = y;
						this.width = width;
						this.height = height;
					},

					render(targetWidth: number): string[] {
						return renderGame(state, targetWidth, this.height || 24);
					},

					handleInput(data: string): boolean {
						// ESC key
						if (data === "\x1b" || data === "\x1b\x1b") {
							if (state.screen === "game") {
								state.screen = "paused";
							} else if (state.screen === "paused") {
								state.screen = "game";
							} else if (state.screen === "help") {
								state.screen = state.player.health > 0 ? "paused" : "title";
							} else {
								// Quit from title
								if (tickTimer) clearInterval(tickTimer);
								done();
							}
							tui.invalidate();
							return true;
						}

						// Handle by screen
						if (state.screen === "title") {
							if (data === "\r" || data === "\n") {
								startGame(state);
								tui.invalidate();
							} else if (data.toLowerCase() === "h") {
								state.screen = "help";
								tui.invalidate();
							}
							return true;
						}

						if (state.screen === "help") {
							// Any key returns
							state.screen = state.player.health > 0 && state.screen !== "title" ? "paused" : "title";
							tui.invalidate();
							return true;
						}

						if (state.screen === "paused") {
							if (data.toLowerCase() === "p" || data === "\r") {
								state.screen = "game";
								tui.invalidate();
							} else if (data.toLowerCase() === "h") {
								state.screen = "help";
								tui.invalidate();
							} else if (data.toLowerCase() === "q") {
								state.screen = "title";
								tui.invalidate();
							}
							return true;
						}

						if (state.screen === "gameover") {
							if (data === "\r" || data === "\n") {
								startGame(state);
								tui.invalidate();
							} else if (data === "\x1b") {
								state.screen = "title";
								tui.invalidate();
							}
							return true;
						}

						if (state.screen === "victory") {
							if (data === "\r" || data === "\n") {
								// TODO: next level
								state.screen = "title";
								tui.invalidate();
							}
							return true;
						}

						// Game controls
						if (state.screen === "game") {
							const key = data.toLowerCase();

							// Movement
							if (key === "w" || data === "\x1b[A") {
								movePlayer(state, 1, 0);
							} else if (key === "s" || data === "\x1b[B") {
								movePlayer(state, -1, 0);
							} else if (key === "a") {
								movePlayer(state, 0, -1);
							} else if (key === "d") {
								movePlayer(state, 0, 1);
							}

							// Rotation
							if (key === "q" || data === "\x1b[D") {
								rotatePlayer(state.player, -ROT_SPEED * 2);
							} else if (key === "e" || data === "\x1b[C") {
								rotatePlayer(state.player, ROT_SPEED * 2);
							}

							// Pause
							if (key === "p") {
								state.screen = "paused";
							}

							// Shoot
							if (data === " ") {
								if (state.player.ammo > 0) {
									state.player.ammo--;
									state.muzzleFlash = 3;
									// TODO: hit detection (doom-009)
								}
							}

							tui.invalidate();
							return true;
						}

						return false;
					},

					invalidate() {
						tui.invalidate();
					},
				};

				// Game tick
				tickTimer = setInterval(() => {
					if (state.screen === "game") {
						// Decay flashes
						if (state.damageFlash > 0) state.damageFlash--;
						if (state.muzzleFlash > 0) state.muzzleFlash--;

						// TODO: enemy updates, projectiles, etc.

						tui.invalidate();
					}
				}, TICK_MS);

				return component;
			});
		},
	});
}
