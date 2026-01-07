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
const ATTACK_RANGE = 1.0;
const ATTACK_COOLDOWN = 20;
const PICKUP_RANGE = 0.5;

const WALL_SHADES = ["█", "▓", "▒", "░", " "];
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const BLUE = "\x1b[34m";

// Level data: #=wall .=floor E=exit P=player Z=zombie I=imp D=demon H=health A=ammo
const LEVELS = [
	[ // Level 1 - Introduction
		"####################",
		"#..................#",
		"#.H................#",
		"#......####........#",
		"#......#..#...Z....#",
		"#......#..#........#",
		"#......####........#",
		"#..Z..........A....#",
		"#............###...#",
		"#...H........#E#...#",
		"#..P.........###...#",
		"#..................#",
		"#.........Z....A...#",
		"####################",
	],
	[ // Level 2 - Corridors
		"########################",
		"#....#.....#...........#",
		"#.P..#..Z..#....####...#",
		"#....#.....#....#..#...#",
		"###..###.###....#..#...#",
		"#.......H#......#..#...#",
		"#..Z.....#..I...####...#",
		"#........#.............#",
		"####.#####..####.####..#",
		"#....#......#.......#..#",
		"#.A..#..D...#...H...#..#",
		"#....#......#.......#..#",
		"#....###.####.####.##..#",
		"#..............Z.......#",
		"#.....A................#",
		"#...............###.####",
		"#...Z...........#E#....#",
		"#...............###....#",
		"########################",
	],
	[ // Level 3 - Arena
		"############################",
		"#..........................#",
		"#..################........#",
		"#..#..............#..D.....#",
		"#..#..H...####....#........#",
		"#..#......#..#....####..####",
		"#..#..Z...#..#.........H...#",
		"#..#......####.....I.......#",
		"#..#...............A.......#",
		"#..########.########..######",
		"#..........H..........#E#..#",
		"#..I...................###..#",
		"#.....D........Z...........#",
		"#..A.......................#",
		"#..........................#",
		"#.P........................#",
		"############################",
	],
];

// Types
type Screen = "title" | "game" | "paused" | "help" | "gameover" | "victory";

interface Player { x: number; y: number; angle: number; health: number; ammo: number; }

interface Enemy {
	x: number; y: number;
	health: number; maxHealth: number;
	speed: number; damage: number;
	attackCooldown: number;
	type: "zombie" | "imp" | "demon";
	dead: boolean;
}

interface Pickup {
	x: number; y: number;
	type: "health" | "ammo";
	amount: number;
	collected: boolean;
}

interface State {
	screen: Screen; prevScreen: Screen;
	player: Player;
	enemies: Enemy[];
	pickups: Pickup[];
	map: string[];
	level: number; kills: number; totalEnemies: number;
	itemsCollected: number; totalItems: number;
	startTime: number;
	damageFlash: number; muzzleFlash: number;
}

// Entity definitions
const ENEMY_DEFS: Record<string, Omit<Enemy, "x" | "y" | "attackCooldown" | "dead">> = {
	Z: { type: "zombie", health: 30, maxHealth: 30, speed: 0.015, damage: 8 },
	I: { type: "imp", health: 50, maxHealth: 50, speed: 0.025, damage: 15 },
	D: { type: "demon", health: 80, maxHealth: 80, speed: 0.04, damage: 25 },
};

const PICKUP_DEFS: Record<string, { type: "health" | "ammo"; amount: number }> = {
	H: { type: "health", amount: 25 },
	A: { type: "ammo", amount: 15 },
};

// Map parsing
function parseMap(level: string[]): { map: string[]; px: number; py: number; enemies: Enemy[]; pickups: Pickup[] } {
	let px = 1.5, py = 1.5;
	const enemies: Enemy[] = [];
	const pickups: Pickup[] = [];
	
	const map = level.map((row, y) => {
		let newRow = "";
		for (let x = 0; x < row.length; x++) {
			const c = row[x];
			if (c === "P") { px = x + 0.5; py = y + 0.5; newRow += "."; }
			else if (ENEMY_DEFS[c]) {
				enemies.push({ ...ENEMY_DEFS[c], x: x + 0.5, y: y + 0.5, attackCooldown: 0, dead: false });
				newRow += ".";
			} else if (PICKUP_DEFS[c]) {
				pickups.push({ ...PICKUP_DEFS[c], x: x + 0.5, y: y + 0.5, collected: false });
				newRow += ".";
			} else {
				newRow += c;
			}
		}
		return newRow;
	});
	return { map, px, py, enemies, pickups };
}

function getCell(map: string[], x: number, y: number): string {
	const my = Math.floor(y), mx = Math.floor(x);
	if (my < 0 || my >= map.length || mx < 0 || mx >= map[my].length) return "#";
	return map[my][mx];
}

function isWall(map: string[], x: number, y: number): boolean { return getCell(map, x, y) === "#"; }

function dist(x1: number, y1: number, x2: number, y2: number): number {
	return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

// Player
function movePlayer(s: State, fwd: number, strafe: number): void {
	const { player: p, map, pickups } = s;
	const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
	
	let dx = cos * fwd - sin * strafe, dy = sin * fwd + cos * strafe;
	const len = Math.sqrt(dx * dx + dy * dy);
	if (len > 0) { dx = dx / len * MOVE_SPEED; dy = dy / len * MOVE_SPEED; }

	const nx = p.x + dx, ny = p.y + dy;
	if (!isWall(map, nx, ny)) { p.x = nx; p.y = ny; }
	else {
		if (!isWall(map, nx, p.y)) p.x = nx;
		if (!isWall(map, p.x, ny)) p.y = ny;
	}

	// Collect pickups (doom-011)
	for (const pk of pickups) {
		if (pk.collected) continue;
		if (dist(p.x, p.y, pk.x, pk.y) < PICKUP_RANGE) {
			if (pk.type === "health" && p.health < 100) {
				p.health = Math.min(100, p.health + pk.amount);
				pk.collected = true;
				s.itemsCollected++;
			} else if (pk.type === "ammo") {
				p.ammo += pk.amount;
				pk.collected = true;
				s.itemsCollected++;
			}
		}
	}

	// Check exit
	if (getCell(map, p.x, p.y) === "E") {
		if (s.level < LEVELS.length) {
			s.screen = "victory";
		} else {
			s.screen = "victory"; // Final victory
		}
	}
}

// Enemy AI (doom-008b)
function updateEnemies(s: State): void {
	const { player: p, map, enemies } = s;
	
	for (const e of enemies) {
		if (e.dead) continue;
		
		const dx = p.x - e.x, dy = p.y - e.y;
		const d = Math.sqrt(dx * dx + dy * dy);
		
		if (d > 0.5) {
			const mx = (dx / d) * e.speed, my = (dy / d) * e.speed;
			const nx = e.x + mx, ny = e.y + my;
			if (!isWall(map, nx, ny)) { e.x = nx; e.y = ny; }
			else {
				if (!isWall(map, nx, e.y)) e.x = nx;
				else if (!isWall(map, e.x, ny)) e.y = ny;
			}
		}
		
		// Attack (doom-010)
		if (d < ATTACK_RANGE && e.attackCooldown <= 0) {
			p.health -= e.damage;
			s.damageFlash = 5;
			e.attackCooldown = ATTACK_COOLDOWN;
			if (p.health <= 0) { p.health = 0; s.screen = "gameover"; }
		}
		if (e.attackCooldown > 0) e.attackCooldown--;
	}
}

// Shooting (doom-009)
function shoot(s: State): boolean {
	const { player: p, enemies, map } = s;
	const dx = Math.cos(p.angle), dy = Math.sin(p.angle);
	
	let closestHit: Enemy | null = null, closestDist = MAX_DEPTH;
	
	for (const e of enemies) {
		if (e.dead) continue;
		const ex = e.x - p.x, ey = e.y - p.y;
		const proj = ex * dx + ey * dy;
		if (proj < 0.1 || proj > closestDist) continue;
		
		const perpDist = Math.abs(ex * dy - ey * dx);
		if (perpDist < 0.4) {
			const { dist: wallDist } = castRay(map, p.x, p.y, p.angle);
			if (proj < wallDist) { closestHit = e; closestDist = proj; }
		}
	}
	
	if (closestHit) {
		closestHit.health -= 25;
		if (closestHit.health <= 0) { closestHit.dead = true; s.kills++; }
		return true;
	}
	return false;
}

// Raycasting
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

// Sprite rendering (doom-018)
interface Sprite { screenX: number; dist: number; height: number; type: "enemy" | "pickup"; color: string; char: string }

function getSprites(s: State, w: number, h: number): Sprite[] {
	const { player: p, enemies, pickups } = s;
	const sprites: Sprite[] = [];
	
	// Enemies
	for (const e of enemies) {
		if (e.dead) continue;
		const dx = e.x - p.x, dy = e.y - p.y, d = Math.sqrt(dx * dx + dy * dy);
		if (d > MAX_DEPTH || d < 0.1) continue;
		
		let relAngle = Math.atan2(dy, dx) - p.angle;
		while (relAngle > Math.PI) relAngle -= Math.PI * 2;
		while (relAngle < -Math.PI) relAngle += Math.PI * 2;
		if (Math.abs(relAngle) > FOV / 2 + 0.2) continue;
		
		const hpPct = e.health / e.maxHealth;
		const color = e.type === "zombie" ? GREEN : e.type === "imp" ? MAGENTA : RED;
		const char = hpPct > 0.5 ? "█" : hpPct > 0.25 ? "▓" : "░";
		sprites.push({ screenX: Math.floor((0.5 + relAngle / FOV) * w), dist: d, height: Math.floor(h / d), type: "enemy", color, char });
	}
	
	// Pickups
	for (const pk of pickups) {
		if (pk.collected) continue;
		const dx = pk.x - p.x, dy = pk.y - p.y, d = Math.sqrt(dx * dx + dy * dy);
		if (d > MAX_DEPTH || d < 0.1) continue;
		
		let relAngle = Math.atan2(dy, dx) - p.angle;
		while (relAngle > Math.PI) relAngle -= Math.PI * 2;
		while (relAngle < -Math.PI) relAngle += Math.PI * 2;
		if (Math.abs(relAngle) > FOV / 2 + 0.2) continue;
		
		const color = pk.type === "health" ? CYAN : YELLOW;
		const char = pk.type === "health" ? "+" : "*";
		sprites.push({ screenX: Math.floor((0.5 + relAngle / FOV) * w), dist: d, height: Math.floor(h / d * 0.5), type: "pickup", color, char });
	}
	
	sprites.sort((a, b) => b.dist - a.dist);
	return sprites;
}

// Rendering
function render3DView(s: State, w: number, h: number): string[] {
	const { player: p, map, damageFlash, muzzleFlash } = s;
	const half = Math.floor(h / 2);
	
	// Wall distances per column
	const wallDists: number[] = [];
	const wallSides: number[] = [];
	for (let x = 0; x < w; x++) {
		const rayAngle = p.angle - FOV / 2 + (x / w) * FOV;
		const { dist, side } = castRay(map, p.x, p.y, rayAngle);
		wallDists.push(dist);
		wallSides.push(side);
	}
	
	// Frame buffer
	const buf: { char: string; color: string }[][] = [];
	for (let y = 0; y < h; y++) {
		buf[y] = [];
		for (let x = 0; x < w; x++) {
			const dist = wallDists[x];
			const wallH = Math.floor(h / (dist + 0.0001));
			const wallTop = half - Math.floor(wallH / 2);
			const wallBot = half + Math.floor(wallH / 2);

			let char: string, color = "";
			if (y < wallTop) { char = " "; }
			else if (y >= wallBot) { char = "."; color = DIM; }
			else {
				const shade = Math.min(Math.floor(dist / (MAX_DEPTH / WALL_SHADES.length)), WALL_SHADES.length - 1);
				char = WALL_SHADES[shade];
				color = wallSides[x] === 1 ? DIM : "";
			}
			buf[y][x] = { char, color };
		}
	}
	
	// Sprites
	const sprites = getSprites(s, w, h);
	for (const spr of sprites) {
		const sprH = spr.height, sprW = Math.max(1, Math.floor(sprH * (spr.type === "pickup" ? 0.4 : 0.6)));
		const startX = spr.screenX - Math.floor(sprW / 2);
		const startY = half - Math.floor(sprH / 2);
		
		for (let sy = 0; sy < sprH; sy++) {
			const y = startY + sy;
			if (y < 0 || y >= h) continue;
			for (let sx = 0; sx < sprW; sx++) {
				const x = startX + sx;
				if (x < 0 || x >= w || spr.dist > wallDists[x]) continue;
				const relY = sy / sprH, relX = sx / sprW;
				if ((relX < 0.2 || relX > 0.8) && (relY < 0.2 || relY > 0.8)) continue;
				buf[y][x] = { char: spr.char, color: spr.color };
			}
		}
	}
	
	// Crosshair
	const cx = Math.floor(w / 2), cy = half;
	const chColor = muzzleFlash > 0 ? YELLOW : GREEN;
	if (cy > 0 && cy < h - 1 && cx > 0 && cx < w - 1) {
		buf[cy][cx - 1] = { char: "-", color: chColor };
		buf[cy][cx + 1] = { char: "-", color: chColor };
		buf[cy - 1][cx] = { char: "|", color: chColor };
		buf[cy + 1][cx] = { char: "|", color: chColor };
		buf[cy][cx] = { char: muzzleFlash > 0 ? "*" : "+", color: chColor + BOLD };
	}
	
	// Output
	const lines: string[] = [];
	for (let y = 0; y < h; y++) {
		let line = "";
		for (let x = 0; x < w; x++) {
			let { char, color } = buf[y][x];
			if (damageFlash > 0 && char !== " ") color = RED;
			line += color + char + RESET;
		}
		lines.push(line);
	}
	return lines;
}

function renderMinimap(s: State): string[] {
	const { player: p, map, enemies, pickups } = s;
	const lines: string[] = [], size = 3;
	const arrows = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"];

	for (let dy = -size; dy <= size; dy++) {
		let line = "";
		for (let dx = -size; dx <= size; dx++) {
			const mx = Math.floor(p.x) + dx, my = Math.floor(p.y) + dy;
			if (dx === 0 && dy === 0) {
				line += CYAN + arrows[Math.round((p.angle / (Math.PI * 2)) * 8 + 8) % 8] + RESET;
			} else {
				const enemy = enemies.find(e => !e.dead && Math.floor(e.x) === mx && Math.floor(e.y) === my);
				const pickup = pickups.find(pk => !pk.collected && Math.floor(pk.x) === mx && Math.floor(pk.y) === my);
				if (enemy) line += RED + "!" + RESET;
				else if (pickup) line += (pickup.type === "health" ? CYAN : YELLOW) + "·" + RESET;
				else {
					const cell = getCell(map, mx, my);
					line += cell === "#" ? DIM + "█" + RESET : cell === "E" ? GREEN + "E" + RESET : DIM + "·" + RESET;
				}
			}
		}
		lines.push(line);
	}
	return lines;
}

function renderHUD(s: State): string {
	const { player: p, level, kills, totalEnemies, itemsCollected, totalItems } = s;
	const pct = p.health / 100;
	const hpColor = pct > 0.6 ? GREEN : pct > 0.3 ? YELLOW : RED;
	const bar = hpColor + "█".repeat(Math.round(pct * 10)) + DIM + "░".repeat(10 - Math.round(pct * 10)) + RESET;
	return `${RED}HP${RESET}[${bar}]${p.health}  ${YELLOW}AMMO${RESET}:${p.ammo}  ${RED}K${RESET}:${kills}/${totalEnemies}  ${CYAN}I${RESET}:${itemsCollected}/${totalItems}  ${MAGENTA}L${level}${RESET}`;
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
		pad(Math.floor(h / 2) - 6);
		lines.push(center(CYAN + BOLD + "═══ CONTROLS ═══" + RESET, w), "");
		lines.push(center("W/S - Move   A/D - Strafe   Q/E - Turn", w));
		lines.push(center("SPACE - Shoot   P - Pause", w));
		lines.push("", center(CYAN + "+" + RESET + " Health   " + YELLOW + "*" + RESET + " Ammo   " + GREEN + "E" + RESET + " Exit", w));
		lines.push("", center(DIM + "Press any key" + RESET, w));
	} else if (s.screen === "paused") {
		pad(Math.floor(h / 2) - 2);
		lines.push(center(YELLOW + BOLD + "══ PAUSED ══" + RESET, w), "");
		lines.push(center("P/ESC Resume   H Help   Q Quit", w));
	} else if (s.screen === "gameover") {
		pad(Math.floor(h / 2) - 3);
		lines.push(center(RED + BOLD + "YOU DIED" + RESET, w), "");
		lines.push(center(`Level ${s.level} - Kills: ${s.kills}/${s.totalEnemies}`, w));
		lines.push("", center("ENTER Restart   ESC Title", w));
	} else if (s.screen === "victory") {
		pad(Math.floor(h / 2) - 5);
		const t = Math.floor((Date.now() - s.startTime) / 1000);
		const isGameComplete = s.level >= LEVELS.length;
		lines.push(center(GREEN + BOLD + (isGameComplete ? "══ GAME COMPLETE ══" : "══ LEVEL COMPLETE ══") + RESET, w), "");
		lines.push(center(`Time: ${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, "0")}`, w));
		lines.push(center(`Kills: ${s.kills}/${s.totalEnemies}`, w));
		lines.push(center(`Items: ${s.itemsCollected}/${s.totalItems}`, w));
		lines.push("", center(GREEN + (isGameComplete ? "ENTER to play again" : "ENTER for next level") + RESET, w));
	} else {
		const viewH = h - 2;
		lines.push(...render3DView(s, w, viewH));
		lines.push(DIM + "─".repeat(w) + RESET);
		lines.push(renderHUD(s));

		const mm = renderMinimap(s);
		for (let i = 0; i < mm.length && i < lines.length; i++) {
			const stripped = lines[i].replace(/\x1b\[[0-9;]*m/g, "");
			if (stripped.length >= w - 9) lines[i] = lines[i].substring(0, (w - 9) * 3) + " " + mm[i];
		}
	}

	pad(h);
	return lines.slice(0, h);
}

// State management
function createState(levelNum: number = 1): State {
	const levelData = LEVELS[Math.min(levelNum - 1, LEVELS.length - 1)];
	const { map, px, py, enemies, pickups } = parseMap(levelData);
	return {
		screen: "title", prevScreen: "title",
		player: { x: px, y: py, angle: 0, health: 100, ammo: 50 },
		enemies, pickups, map,
		level: levelNum, kills: 0, totalEnemies: enemies.length,
		itemsCollected: 0, totalItems: pickups.length,
		startTime: Date.now(), damageFlash: 0, muzzleFlash: 0,
	};
}

function loadLevel(s: State, levelNum: number): void {
	const levelData = LEVELS[Math.min(levelNum - 1, LEVELS.length - 1)];
	const { map, px, py, enemies, pickups } = parseMap(levelData);
	s.map = map;
	s.player = { x: px, y: py, angle: 0, health: s.player.health, ammo: s.player.ammo }; // Keep health/ammo
	s.enemies = enemies;
	s.pickups = pickups;
	s.level = levelNum;
	s.kills = 0;
	s.totalEnemies = enemies.length;
	s.itemsCollected = 0;
	s.totalItems = pickups.length;
	s.screen = "game";
	s.startTime = Date.now();
	s.damageFlash = s.muzzleFlash = 0;
}

function resetGame(s: State): void {
	loadLevel(s, 1);
	s.player.health = 100;
	s.player.ammo = 50;
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
					layout(x: number, y: number, w: number, h: number) { this.x = x; this.y = y; this.width = w; this.height = h; },
					render(w: number): string[] { return renderScreen(s, w, this.height || 24); },
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
							if (enter) {
								if (s.level < LEVELS.length) loadLevel(s, s.level + 1);
								else resetGame(s);
							} else if (esc) s.screen = "title";
						} else if (s.screen === "game") {
							if (key === "w" || data === "\x1b[A") movePlayer(s, 1, 0);
							else if (key === "s" || data === "\x1b[B") movePlayer(s, -1, 0);
							else if (key === "a") movePlayer(s, 0, -1);
							else if (key === "d") movePlayer(s, 0, 1);
							else if (key === "q" || data === "\x1b[D") s.player.angle -= ROT_SPEED;
							else if (key === "e" || data === "\x1b[C") s.player.angle += ROT_SPEED;
							else if (key === "p" || esc) s.screen = "paused";
							else if (data === " " && s.player.ammo > 0) { s.player.ammo--; s.muzzleFlash = 3; shoot(s); }
						}
						tui.invalidate();
						return true;
					},
				};
			});
		},
	});
}
