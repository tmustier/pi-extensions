/**
 * ASCII Doom - First-person raycasting shooter. Play with /doom
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

// Constants
const TICK_MS = 50;
const FOV = Math.PI / 3;
const MOVE_SPEED = 0.08;
const ROT_SPEED = 0.12;
const MAX_DEPTH = 16;
const ENEMY_SPEED = 0.02;
const ENEMY_DAMAGE = 10;
const ATTACK_RANGE = 1.0;
const ATTACK_COOLDOWN = 20; // ticks

const WALL_SHADES = ["█", "▓", "▒", "░", " "];
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";

// Level data - E=exit, Z=zombie spawn
const LEVEL_1 = [
	"################",
	"#..............#",
	"#.....Z........#",
	"#....####......#",
	"#....#..#..Z...#",
	"#....#..#......#",
	"#....####......#",
	"#..Z...........#",
	"#.........###..#",
	"#.........#E#..#",
	"#..P......###..#",
	"#..............#",
	"#.......Z......#",
	"################",
];

// Types
type Screen = "title" | "game" | "paused" | "help" | "gameover" | "victory";

interface Player {
	x: number; y: number; angle: number;
	health: number; ammo: number;
}

interface Enemy {
	x: number; y: number;
	health: number; maxHealth: number;
	speed: number; damage: number;
	attackCooldown: number;
	type: "zombie" | "imp" | "demon";
	dead: boolean;
}

interface State {
	screen: Screen; prevScreen: Screen;
	player: Player;
	enemies: Enemy[];
	map: string[];
	level: number; kills: number; totalEnemies: number;
	startTime: number;
	damageFlash: number; muzzleFlash: number;
}

// Enemy definitions (doom-008)
const ENEMY_TYPES: Record<string, Omit<Enemy, "x" | "y" | "attackCooldown" | "dead">> = {
	Z: { type: "zombie", health: 30, maxHealth: 30, speed: 0.015, damage: 8 },
	I: { type: "imp", health: 50, maxHealth: 50, speed: 0.025, damage: 15 },
	D: { type: "demon", health: 80, maxHealth: 80, speed: 0.035, damage: 25 },
};

// Map functions
function parseMap(level: string[]): { map: string[]; px: number; py: number; enemies: Enemy[] } {
	let px = 1.5, py = 1.5;
	const enemies: Enemy[] = [];
	
	const map = level.map((row, y) => {
		let newRow = "";
		for (let x = 0; x < row.length; x++) {
			const c = row[x];
			if (c === "P") { px = x + 0.5; py = y + 0.5; newRow += "."; }
			else if (ENEMY_TYPES[c]) {
				enemies.push({ ...ENEMY_TYPES[c], x: x + 0.5, y: y + 0.5, attackCooldown: 0, dead: false });
				newRow += ".";
			}
			else newRow += c;
		}
		return newRow;
	});
	return { map, px, py, enemies };
}

function getCell(map: string[], x: number, y: number): string {
	const my = Math.floor(y), mx = Math.floor(x);
	if (my < 0 || my >= map.length || mx < 0 || mx >= map[my].length) return "#";
	return map[my][mx];
}

function isWall(map: string[], x: number, y: number): boolean {
	return getCell(map, x, y) === "#";
}

function dist(x1: number, y1: number, x2: number, y2: number): number {
	return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

// Player movement
function movePlayer(s: State, fwd: number, strafe: number): void {
	const { player: p, map } = s;
	const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
	
	let dx = cos * fwd - sin * strafe;
	let dy = sin * fwd + cos * strafe;
	const len = Math.sqrt(dx * dx + dy * dy);
	if (len > 0) { dx = dx / len * MOVE_SPEED; dy = dy / len * MOVE_SPEED; }

	const nx = p.x + dx, ny = p.y + dy;
	if (!isWall(map, nx, ny)) { p.x = nx; p.y = ny; }
	else {
		if (!isWall(map, nx, p.y)) p.x = nx;
		if (!isWall(map, p.x, ny)) p.y = ny;
	}

	if (getCell(map, p.x, p.y) === "E") s.screen = "victory";
}

// Enemy AI (doom-008b)
function updateEnemies(s: State): void {
	const { player: p, map, enemies } = s;
	
	for (const e of enemies) {
		if (e.dead) continue;
		
		// Simple chase AI - move toward player
		const dx = p.x - e.x, dy = p.y - e.y;
		const d = Math.sqrt(dx * dx + dy * dy);
		
		if (d > 0.5) { // Don't get too close
			const mx = (dx / d) * e.speed;
			const my = (dy / d) * e.speed;
			
			// Try to move, with wall collision
			const nx = e.x + mx, ny = e.y + my;
			if (!isWall(map, nx, ny)) { e.x = nx; e.y = ny; }
			else {
				if (!isWall(map, nx, e.y)) e.x = nx;
				else if (!isWall(map, e.x, ny)) e.y = ny;
			}
		}
		
		// Attack player if close (doom-010)
		if (d < ATTACK_RANGE && e.attackCooldown <= 0) {
			p.health -= e.damage;
			s.damageFlash = 5;
			e.attackCooldown = ATTACK_COOLDOWN;
			
			if (p.health <= 0) {
				p.health = 0;
				s.screen = "gameover";
			}
		}
		
		if (e.attackCooldown > 0) e.attackCooldown--;
	}
}

// Shooting (doom-009)
function shoot(s: State): boolean {
	const { player: p, enemies, map } = s;
	
	// Cast ray from player in facing direction
	const dx = Math.cos(p.angle), dy = Math.sin(p.angle);
	
	// Check for enemy hits along ray
	let closestHit: Enemy | null = null;
	let closestDist = MAX_DEPTH;
	
	for (const e of enemies) {
		if (e.dead) continue;
		
		// Vector from player to enemy
		const ex = e.x - p.x, ey = e.y - p.y;
		
		// Project enemy onto ray direction
		const proj = ex * dx + ey * dy;
		if (proj < 0.1 || proj > closestDist) continue; // Behind player or further than current hit
		
		// Perpendicular distance from ray to enemy
		const perpDist = Math.abs(ex * dy - ey * dx);
		if (perpDist < 0.4) { // Hit radius
			// Check if wall blocks the shot
			const { dist: wallDist } = castRay(map, p.x, p.y, p.angle);
			if (proj < wallDist) {
				closestHit = e;
				closestDist = proj;
			}
		}
	}
	
	if (closestHit) {
		closestHit.health -= 25; // Pistol damage
		if (closestHit.health <= 0) {
			closestHit.dead = true;
			s.kills++;
		}
		return true;
	}
	return false;
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
			return { dist: side === 0 ? sideX - ddx : sideY - ddy, side };
		}
	}
	return { dist: MAX_DEPTH, side: 0 };
}

// Sprite rendering (doom-018) - calculate screen position for enemies
interface Sprite { x: number; screenX: number; dist: number; height: number; enemy: Enemy }

function getVisibleSprites(s: State, w: number, h: number): Sprite[] {
	const { player: p, enemies } = s;
	const sprites: Sprite[] = [];
	
	for (const e of enemies) {
		if (e.dead) continue;
		
		// Vector from player to enemy
		const dx = e.x - p.x, dy = e.y - p.y;
		const d = Math.sqrt(dx * dx + dy * dy);
		if (d > MAX_DEPTH || d < 0.1) continue;
		
		// Angle to enemy relative to player facing
		const angleToEnemy = Math.atan2(dy, dx);
		let relAngle = angleToEnemy - p.angle;
		
		// Normalize angle to -PI to PI
		while (relAngle > Math.PI) relAngle -= Math.PI * 2;
		while (relAngle < -Math.PI) relAngle += Math.PI * 2;
		
		// Check if in FOV
		if (Math.abs(relAngle) > FOV / 2 + 0.2) continue;
		
		// Screen X position
		const screenX = Math.floor((0.5 + relAngle / FOV) * w);
		const height = Math.floor(h / d);
		
		sprites.push({ x: e.x, screenX, dist: d, height, enemy: e });
	}
	
	// Sort by distance (far to near for proper overlap)
	sprites.sort((a, b) => b.dist - a.dist);
	return sprites;
}

// Rendering
function render3DView(s: State, w: number, h: number): string[] {
	const { player: p, map, damageFlash, muzzleFlash } = s;
	const half = Math.floor(h / 2);
	
	// Pre-calculate wall distances for each column (for sprite clipping)
	const wallDists: number[] = [];
	for (let x = 0; x < w; x++) {
		const rayAngle = p.angle - FOV / 2 + (x / w) * FOV;
		const { dist } = castRay(map, p.x, p.y, rayAngle);
		wallDists.push(dist);
	}
	
	// Build frame buffer
	const buffer: { char: string; color: string }[][] = [];
	for (let y = 0; y < h; y++) {
		buffer[y] = [];
		for (let x = 0; x < w; x++) {
			const rayAngle = p.angle - FOV / 2 + (x / w) * FOV;
			const dist = wallDists[x];
			
			const wallH = Math.floor(h / (dist + 0.0001));
			const wallTop = half - Math.floor(wallH / 2);
			const wallBot = half + Math.floor(wallH / 2);

			let char: string, color = "";

			if (y < wallTop) {
				char = " "; color = DIM;
			} else if (y >= wallBot) {
				char = "."; color = DIM;
			} else {
				const { side } = castRay(map, p.x, p.y, rayAngle);
				const shade = Math.min(Math.floor(dist / (MAX_DEPTH / WALL_SHADES.length)), WALL_SHADES.length - 1);
				char = WALL_SHADES[shade];
				color = side === 1 ? DIM : "";
			}
			
			buffer[y][x] = { char, color };
		}
	}
	
	// Render sprites on top (doom-018)
	const sprites = getVisibleSprites(s, w, h);
	for (const spr of sprites) {
		const sprH = spr.height;
		const sprW = Math.floor(sprH * 0.6); // Aspect ratio
		const startX = spr.screenX - Math.floor(sprW / 2);
		const startY = half - Math.floor(sprH / 2);
		
		// Enemy appearance based on type and health
		const e = spr.enemy;
		const hpPct = e.health / e.maxHealth;
		const enemyColor = e.type === "zombie" ? GREEN : e.type === "imp" ? MAGENTA : RED;
		const enemyChar = hpPct > 0.5 ? "█" : hpPct > 0.25 ? "▓" : "░";
		
		for (let sy = 0; sy < sprH; sy++) {
			const y = startY + sy;
			if (y < 0 || y >= h) continue;
			
			for (let sx = 0; sx < sprW; sx++) {
				const x = startX + sx;
				if (x < 0 || x >= w) continue;
				
				// Sprite clipping - don't draw if wall is closer
				if (spr.dist > wallDists[x]) continue;
				
				// Simple sprite shape (rectangular for now)
				const relY = sy / sprH;
				const relX = sx / sprW;
				
				// Draw body (skip corners for rough shape)
				const isCorner = (relX < 0.2 || relX > 0.8) && (relY < 0.2 || relY > 0.8);
				if (!isCorner) {
					buffer[y][x] = { char: enemyChar, color: enemyColor };
				}
			}
		}
	}
	
	// Draw crosshair
	const cx = Math.floor(w / 2), cy = half;
	if (cy > 0 && cy < h - 1) {
		buffer[cy][cx - 1] = { char: "-", color: muzzleFlash > 0 ? YELLOW : GREEN };
		buffer[cy][cx + 1] = { char: "-", color: muzzleFlash > 0 ? YELLOW : GREEN };
		buffer[cy - 1][cx] = { char: "|", color: muzzleFlash > 0 ? YELLOW : GREEN };
		buffer[cy + 1][cx] = { char: "|", color: muzzleFlash > 0 ? YELLOW : GREEN };
		buffer[cy][cx] = { char: muzzleFlash > 0 ? "*" : "+", color: (muzzleFlash > 0 ? YELLOW : GREEN) + BOLD };
	}
	
	// Apply damage flash and convert to strings
	const lines: string[] = [];
	for (let y = 0; y < h; y++) {
		let line = "";
		for (let x = 0; x < w; x++) {
			let { char, color } = buffer[y][x];
			if (damageFlash > 0 && char !== " ") color = RED;
			line += color + char + RESET;
		}
		lines.push(line);
	}
	return lines;
}

function renderMinimap(s: State): string[] {
	const { player: p, map, enemies } = s;
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
				// Check for enemy at this position
				const enemy = enemies.find(e => !e.dead && Math.floor(e.x) === mx && Math.floor(e.y) === my);
				if (enemy) {
					line += RED + "!" + RESET;
				} else {
					const cell = getCell(map, mx, my);
					line += cell === "#" ? DIM + "█" + RESET : cell === "E" ? GREEN + "E" + RESET : DIM + "·" + RESET;
				}
			}
		}
		lines.push(line);
	}
	return lines;
}

function renderHUD(s: State, w: number): string {
	const { player: p, level, kills, totalEnemies } = s;
	const pct = p.health / 100;
	const hpColor = pct > 0.6 ? GREEN : pct > 0.3 ? YELLOW : RED;
	const bar = hpColor + "█".repeat(Math.round(pct * 10)) + DIM + "░".repeat(10 - Math.round(pct * 10)) + RESET;
	return `${RED}HP${RESET}[${bar}]${p.health}  ${YELLOW}AMMO${RESET}:${p.ammo}  ${RED}KILLS${RESET}:${kills}/${totalEnemies}  ${CYAN}LV${level}${RESET}`;
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
		lines.push(center("SPACE - Shoot  P - Pause", w));
		lines.push("", center(DIM + "Press any key to return" + RESET, w));
	} else if (s.screen === "paused") {
		pad(Math.floor(h / 2) - 2);
		lines.push(center(YELLOW + BOLD + "══ PAUSED ══" + RESET, w), "");
		lines.push(center("P/ESC Resume  H Help  Q Quit", w));
	} else if (s.screen === "gameover") {
		pad(Math.floor(h / 2) - 3);
		lines.push(center(RED + BOLD + "YOU DIED" + RESET, w), "");
		lines.push(center(`Kills: ${s.kills}/${s.totalEnemies}`, w));
		lines.push("", center("ENTER Restart  ESC Title", w));
	} else if (s.screen === "victory") {
		pad(Math.floor(h / 2) - 4);
		const t = Math.floor((Date.now() - s.startTime) / 1000);
		lines.push(center(GREEN + BOLD + "══ LEVEL COMPLETE ══" + RESET, w), "");
		lines.push(center(`Time: ${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, "0")}`, w));
		lines.push(center(`Kills: ${s.kills}/${s.totalEnemies}`, w));
		lines.push("", center(GREEN + "ENTER to continue" + RESET, w));
	} else {
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
				lines[i] = lines[i].substring(0, padLen * 3) + " " + mm[i];
			}
		}
	}

	pad(h);
	return lines.slice(0, h);
}

// Game state
function createState(): State {
	const { map, px, py, enemies } = parseMap(LEVEL_1);
	return {
		screen: "title", prevScreen: "title",
		player: { x: px, y: py, angle: 0, health: 100, ammo: 50 },
		enemies, map, level: 1,
		kills: 0, totalEnemies: enemies.length,
		startTime: Date.now(), damageFlash: 0, muzzleFlash: 0,
	};
}

function resetGame(s: State): void {
	const { map, px, py, enemies } = parseMap(LEVEL_1);
	s.map = map;
	s.player = { x: px, y: py, angle: 0, health: 100, ammo: 50 };
	s.enemies = enemies;
	s.kills = 0;
	s.totalEnemies = enemies.length;
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
						updateEnemies(s);
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
							if (enter) resetGame(s);
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
								shoot(s);
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
