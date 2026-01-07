/**
 * ASCII Doom - First-person raycasting shooter. Play with /doom
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

// Constants
const TICK_MS = 50;
const FOV = Math.PI / 3; // 60 degrees
const MOVE_SPEED = 0.08;
const ROT_SPEED = 0.12;
const MAX_DEPTH = 16;

const WALL_SHADES = ["█", "▓", "▒", "░", " "];
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";

// Level data
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

// Types
type Screen = "title" | "game" | "paused" | "help" | "gameover" | "victory";

interface Player {
	x: number;
	y: number;
	angle: number;
	health: number;
	ammo: number;
}

interface State {
	screen: Screen;
	prevScreen: Screen;
	player: Player;
	map: string[];
	level: number;
	startTime: number;
	damageFlash: number;
	muzzleFlash: number;
}

// Map functions
function parseMap(level: string[]): { map: string[]; px: number; py: number } {
	let px = 1.5, py = 1.5;
	const map = level.map((row, y) => {
		const i = row.indexOf("P");
		if (i !== -1) { px = i + 0.5; py = y + 0.5; return row.replace("P", "."); }
		return row;
	});
	return { map, px, py };
}

function getCell(map: string[], x: number, y: number): string {
	const my = Math.floor(y), mx = Math.floor(x);
	if (my < 0 || my >= map.length || mx < 0 || mx >= map[my].length) return "#";
	return map[my][mx];
}

function isWall(map: string[], x: number, y: number): boolean {
	return getCell(map, x, y) === "#";
}

// Player movement with wall sliding
function movePlayer(s: State, fwd: number, strafe: number): void {
	const { player: p, map } = s;
	const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
	
	let dx = cos * fwd - sin * strafe;
	let dy = sin * fwd + cos * strafe;
	const len = Math.sqrt(dx * dx + dy * dy);
	if (len > 0) { dx = dx / len * MOVE_SPEED; dy = dy / len * MOVE_SPEED; }

	const nx = p.x + dx, ny = p.y + dy;
	
	// Wall sliding collision
	if (!isWall(map, nx, ny)) {
		p.x = nx; p.y = ny;
	} else {
		if (!isWall(map, nx, p.y)) p.x = nx;
		if (!isWall(map, p.x, ny)) p.y = ny;
	}

	// Check exit
	if (getCell(map, p.x, p.y) === "E") s.screen = "victory";
}

// DDA Raycasting
function castRay(map: string[], px: number, py: number, angle: number): { dist: number; side: number } {
	const dx = Math.cos(angle), dy = Math.sin(angle);
	let mapX = Math.floor(px), mapY = Math.floor(py);
	
	const ddx = dx === 0 ? 1e10 : Math.abs(1 / dx);
	const ddy = dy === 0 ? 1e10 : Math.abs(1 / dy);
	const stepX = dx < 0 ? -1 : 1, stepY = dy < 0 ? -1 : 1;
	
	let sideX = dx < 0 ? (px - mapX) * ddx : (mapX + 1 - px) * ddx;
	let sideY = dy < 0 ? (py - mapY) * ddy : (mapY + 1 - py) * ddy;
	let side = 0;

	for (let i = 0; i < MAX_DEPTH * 2; i++) {
		if (sideX < sideY) { sideX += ddx; mapX += stepX; side = 0; }
		else { sideY += ddy; mapY += stepY; side = 1; }
		
		if (getCell(map, mapX, mapY) === "#") {
			const dist = side === 0 ? sideX - ddx : sideY - ddy;
			return { dist, side };
		}
	}
	return { dist: MAX_DEPTH, side: 0 };
}

// Rendering
function render3DView(s: State, w: number, h: number): string[] {
	const { player: p, map, damageFlash } = s;
	const lines: string[] = [];
	const half = Math.floor(h / 2);

	for (let y = 0; y < h; y++) {
		let line = "";
		for (let x = 0; x < w; x++) {
			const rayAngle = p.angle - FOV / 2 + (x / w) * FOV;
			const { dist, side } = castRay(map, p.x, p.y, rayAngle);
			
			const wallH = Math.floor(h / (dist + 0.0001));
			const wallTop = half - Math.floor(wallH / 2);
			const wallBot = half + Math.floor(wallH / 2);

			let char: string, color = "";
			const cx = Math.floor(w / 2), cy = half;

			// Crosshair takes priority
			if ((y === cy && (x === cx - 1 || x === cx + 1)) ||
				(x === cx && (y === cy - 1 || y === cy + 1))) {
				char = y === cy ? "-" : "|"; color = GREEN;
			} else if (x === cx && y === cy) {
				char = "+"; color = GREEN + BOLD;
			} else if (y < wallTop) {
				char = " "; color = DIM;
			} else if (y >= wallBot) {
				char = "."; color = DIM;
			} else {
				const shade = Math.min(Math.floor(dist / (MAX_DEPTH / WALL_SHADES.length)), WALL_SHADES.length - 1);
				char = WALL_SHADES[shade];
				color = side === 1 ? DIM : "";
			}

			if (damageFlash > 0 && char !== " ") color = RED;
			line += color + char + RESET;
		}
		lines.push(line);
	}
	return lines;
}

function renderMinimap(s: State): string[] {
	const { player: p, map } = s;
	const lines: string[] = [];
	const size = 3;

	for (let dy = -size; dy <= size; dy++) {
		let line = "";
		for (let dx = -size; dx <= size; dx++) {
			const mx = Math.floor(p.x) + dx, my = Math.floor(p.y) + dy;
			if (dx === 0 && dy === 0) {
				const arrows = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"];
				const dir = Math.round((p.angle / (Math.PI * 2)) * 8 + 8) % 8;
				line += CYAN + arrows[dir] + RESET;
			} else {
				const cell = getCell(map, mx, my);
				line += cell === "#" ? DIM + "█" + RESET : cell === "E" ? GREEN + "E" + RESET : DIM + "·" + RESET;
			}
		}
		lines.push(line);
	}
	return lines;
}

function renderHUD(s: State, w: number): string {
	const { player: p, level } = s;
	const pct = p.health / 100;
	const hpColor = pct > 0.6 ? GREEN : pct > 0.3 ? YELLOW : RED;
	const bar = hpColor + "█".repeat(Math.round(pct * 10)) + DIM + "░".repeat(10 - Math.round(pct * 10)) + RESET;
	return `${RED}HP${RESET}[${bar}]${p.health}  ${YELLOW}AMMO${RESET}:${p.ammo}  ${CYAN}LV${level}${RESET}`;
}

function center(text: string, w: number): string {
	const clean = text.replace(/\x1b\[[0-9;]*m/g, "");
	return " ".repeat(Math.max(0, Math.floor((w - clean.length) / 2))) + text;
}

function renderScreen(s: State, w: number, h: number): string[] {
	const lines: string[] = [];
	const pad = (n: number) => { while (lines.length < n) lines.push(""); };

	if (s.screen === "title") {
		const title = [
			"██████╗  ██████╗  ██████╗ ███╗   ███╗",
			"██╔══██╗██╔═══██╗██╔═══██╗████╗ ████║",
			"██║  ██║██║   ██║██║   ██║██╔████╔██║",
			"██║  ██║██║   ██║██║   ██║██║╚██╔╝██║",
			"██████╔╝╚██████╔╝╚██████╔╝██║ ╚═╝ ██║",
			"╚═════╝  ╚═════╝  ╚═════╝ ╚═╝     ╚═╝",
		];
		pad(Math.floor(h / 2) - 6);
		for (const l of title) lines.push(center(RED + l + RESET, w));
		lines.push("", center(DIM + "ASCII TERMINAL EDITION" + RESET, w), "");
		lines.push(center(GREEN + "ENTER" + RESET + " Start  " + DIM + "H" + RESET + " Help  " + DIM + "ESC" + RESET + " Quit", w));
	} else if (s.screen === "help") {
		pad(Math.floor(h / 2) - 8);
		lines.push(center(CYAN + BOLD + "═══ CONTROLS ═══" + RESET, w), "");
		lines.push(center("W/S - Move  A/D - Strafe  Q/E - Turn", w));
		lines.push(center("SPACE - Shoot  P - Pause  TAB - Map", w));
		lines.push("", center(DIM + "Press any key to return" + RESET, w));
	} else if (s.screen === "paused") {
		pad(Math.floor(h / 2) - 2);
		lines.push(center(YELLOW + BOLD + "══ PAUSED ══" + RESET, w), "");
		lines.push(center("P/ESC Resume  H Help  Q Quit", w));
	} else if (s.screen === "gameover") {
		pad(Math.floor(h / 2) - 3);
		lines.push(center(RED + BOLD + "YOU DIED" + RESET, w), "");
		lines.push(center("ENTER Restart  ESC Title", w));
	} else if (s.screen === "victory") {
		pad(Math.floor(h / 2) - 3);
		const t = Math.floor((Date.now() - s.startTime) / 1000);
		lines.push(center(GREEN + BOLD + "══ LEVEL COMPLETE ══" + RESET, w), "");
		lines.push(center(`Time: ${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, "0")}`, w));
		lines.push("", center(GREEN + "ENTER to continue" + RESET, w));
	} else {
		// Game view
		const viewH = h - 2;
		const view = render3DView(s, w, viewH);
		lines.push(...view);
		lines.push(DIM + "─".repeat(w) + RESET);
		lines.push(renderHUD(s, w));

		// Overlay minimap
		const mm = renderMinimap(s);
		for (let i = 0; i < mm.length && i < lines.length; i++) {
			const stripped = lines[i].replace(/\x1b\[[0-9;]*m/g, "");
			const padLen = w - 9;
			if (stripped.length >= padLen) {
				// Rebuild line with minimap overlay
				lines[i] = lines[i].substring(0, padLen * 3) + " " + mm[i];
			}
		}
	}

	pad(h);
	return lines.slice(0, h);
}

// Game state
function createState(): State {
	const { map, px, py } = parseMap(LEVEL_1);
	return {
		screen: "title", prevScreen: "title",
		player: { x: px, y: py, angle: 0, health: 100, ammo: 50 },
		map, level: 1, startTime: Date.now(), damageFlash: 0, muzzleFlash: 0,
	};
}

function resetGame(s: State): void {
	const { map, px, py } = parseMap(LEVEL_1);
	s.map = map;
	s.player = { x: px, y: py, angle: 0, health: 100, ammo: 50 };
	s.screen = "game";
	s.startTime = Date.now();
	s.damageFlash = s.muzzleFlash = 0;
}

// Extension entry
export default function (pi: ExtensionAPI) {
	pi.registerCommand("doom", {
		description: "Play ASCII Doom - first-person shooter",
		handler: async (_args, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) { ctx.ui.notify("Doom requires interactive mode", "error"); return; }
			await ctx.waitForIdle();

			const s = createState();

			await ctx.ui.custom<void>((tui, _theme, done) => {
				const timer = setInterval(() => {
					if (s.screen === "game") {
						if (s.damageFlash > 0) s.damageFlash--;
						if (s.muzzleFlash > 0) s.muzzleFlash--;
						tui.invalidate();
					}
				}, TICK_MS);

				return {
					x: 0, y: 0, width: 0, height: 0, visible: true, parent: null as any,
					
					layout(x: number, y: number, w: number, h: number) {
						this.x = x; this.y = y; this.width = w; this.height = h;
					},
					
					render(w: number): string[] {
						return renderScreen(s, w, this.height || 24);
					},
					
					handleInput(data: string): boolean {
						const key = data.toLowerCase();
						const esc = data === "\x1b" || data === "\x1b\x1b";
						const enter = data === "\r" || data === "\n";

						if (s.screen === "title") {
							if (enter) { resetGame(s); }
							else if (key === "h") { s.prevScreen = "title"; s.screen = "help"; }
							else if (esc) { clearInterval(timer); done(); return true; }
						} else if (s.screen === "help") {
							s.screen = s.prevScreen;
						} else if (s.screen === "paused") {
							if (key === "p" || esc || enter) s.screen = "game";
							else if (key === "h") { s.prevScreen = "paused"; s.screen = "help"; }
							else if (key === "q") s.screen = "title";
						} else if (s.screen === "gameover") {
							if (enter) resetGame(s);
							else if (esc) s.screen = "title";
						} else if (s.screen === "victory") {
							if (enter || esc) s.screen = "title";
						} else if (s.screen === "game") {
							if (key === "w" || data === "\x1b[A") movePlayer(s, 1, 0);
							else if (key === "s" || data === "\x1b[B") movePlayer(s, -1, 0);
							else if (key === "a") movePlayer(s, 0, -1);
							else if (key === "d") movePlayer(s, 0, 1);
							else if (key === "q" || data === "\x1b[D") s.player.angle -= ROT_SPEED;
							else if (key === "e" || data === "\x1b[C") s.player.angle += ROT_SPEED;
							else if (key === "p" || esc) s.screen = "paused";
							else if (data === " " && s.player.ammo > 0) {
								s.player.ammo--;
								s.muzzleFlash = 3;
							}
						}
						
						tui.invalidate();
						return true;
					},
				};
			});
		},
	});
}
