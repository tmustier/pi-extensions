/**
 * ASCII Doom - First-person raycasting shooter. Play with /pi-doom
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

// Config
const TICK_MS = 50, FOV = Math.PI / 3, MAX_DEPTH = 16;
const MOVE_SPEED = 0.08, ROT_SPEED = 0.05; // ~3° per step for precise aiming
const ATTACK_RANGE = 1.0, ATTACK_COOLDOWN = 20, PICKUP_RANGE = 0.5, DOOR_TIME = 60;

// ANSI
const R = "\x1b[0m", D = "\x1b[2m", B = "\x1b[1m";
const RED = "\x1b[31m", GRN = "\x1b[32m", YEL = "\x1b[33m", CYN = "\x1b[36m", MAG = "\x1b[35m";
const SHADES = ["█", "▓", "▒", "░", " "];

// Levels: #=wall .=floor ==door E=exit P=player Z/I/D=enemies H/A=items
const LEVELS = [
	["####################","#..................#","#.H................#","#......####........#",
	 "#......#..#...Z....#","#......=..=........#","#......####........#","#..Z..........A....#",
	 "#............###...#","#...H........=E=...#","#..P.........###...#","#..................#",
	 "#.........Z....A...#","####################"],
	["########################","#....#.....#...........#","#.P..=..Z..=....####...#","#....#.....#....#..#...#",
	 "###..###=###....=..=...#","#.......H#......#..#...#","#..Z.....#..I...####...#","#........#.............#",
	 "####=#####..####=####..#","#....#......#.......#..#","#.A..#..D...#...H...#..#","#....#......#.......#..#",
	 "#....###=####=####=##..#","#..............Z.......#","#.....A................#","#...............###=####",
	 "#...Z...........=E=....#","#...............###....#","########################"],
	["############################","#..........................#","#..################........#","#..=..............=..D.....#",
	 "#..#..H...####....#........#","#..#......=..=....####..####","#..#..Z...#..#.........H...#","#..#......####.....I.......#",
	 "#..#...............A.......#","#..########=########..######","#..........H..........=E=..#","#..I...................###..#",
	 "#.....D........Z...........#","#..A.......................#","#..........................#","#.P........................#",
	 "############################"],
];

// Types
type Screen = "title" | "game" | "paused" | "help" | "gameover" | "victory";
interface Player { x: number; y: number; angle: number; health: number; ammo: number }
interface Enemy { x: number; y: number; hp: number; maxHp: number; spd: number; dmg: number; cd: number; type: string; dead: boolean }
interface Pickup { x: number; y: number; type: string; amt: number; got: boolean }
interface Door { x: number; y: number; open: boolean; timer: number }
interface State {
	screen: Screen; prev: Screen; player: Player;
	enemies: Enemy[]; pickups: Pickup[]; doors: Door[]; map: string[];
	level: number; kills: number; items: number; totalE: number; totalI: number;
	start: number; dmgFlash: number; gunFlash: number;
}

// Defs
const ENEMIES: Record<string, { type: string; hp: number; spd: number; dmg: number }> = {
	Z: { type: "zombie", hp: 30, spd: 0.015, dmg: 8 },
	I: { type: "imp", hp: 50, spd: 0.025, dmg: 15 },
	D: { type: "demon", hp: 80, spd: 0.04, dmg: 25 },
};
const ITEMS: Record<string, { type: string; amt: number }> = { H: { type: "health", amt: 25 }, A: { type: "ammo", amt: 15 } };

// Parse level
function parse(lvl: string[]) {
	let px = 1.5, py = 1.5;
	const enemies: Enemy[] = [], pickups: Pickup[] = [], doors: Door[] = [];
	const map = lvl.map((row, y) => {
		let r = "";
		for (let x = 0; x < row.length; x++) {
			const c = row[x];
			if (c === "P") { px = x + 0.5; py = y + 0.5; r += "."; }
			else if (ENEMIES[c]) { enemies.push({ ...ENEMIES[c], x: x + 0.5, y: y + 0.5, maxHp: ENEMIES[c].hp, cd: 0, dead: false }); r += "."; }
			else if (ITEMS[c]) { pickups.push({ ...ITEMS[c], x: x + 0.5, y: y + 0.5, got: false }); r += "."; }
			else if (c === "=") { doors.push({ x, y, open: false, timer: 0 }); r += "="; }
			else r += c;
		}
		return r;
	});
	return { map, px, py, enemies, pickups, doors };
}

// Helpers
const cell = (m: string[], x: number, y: number) => {
	const r = m[Math.floor(y)];
	return r ? r[Math.floor(x)] ?? "#" : "#";
};
const getDoor = (s: State, x: number, y: number) => s.doors.find(d => d.x === Math.floor(x) && d.y === Math.floor(y));
const blocked = (s: State, x: number, y: number) => {
	const c = cell(s.map, x, y);
	if (c === "#") return true;
	if (c === "=") { const d = getDoor(s, x, y); return d ? !d.open : true; }
	return false;
};
const dist = (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1);

// Update
function tick(s: State) {
	const p = s.player;
	// Doors
	for (const d of s.doors) {
		const dd = dist(d.x + 0.5, d.y + 0.5, p.x, p.y);
		if (dd < 1.5 && !d.open) { d.open = true; d.timer = DOOR_TIME; }
		if (d.open) { d.timer--; if (d.timer <= 0 && dd > 1.5) d.open = false; else if (dd < 1.5) d.timer = DOOR_TIME; }
	}
	// Enemies
	for (const e of s.enemies) {
		if (e.dead) continue;
		const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy);
		if (d > 0.5) {
			const nx = e.x + (dx / d) * e.spd, ny = e.y + (dy / d) * e.spd;
			if (!blocked(s, nx, ny)) { e.x = nx; e.y = ny; }
			else if (!blocked(s, nx, e.y)) e.x = nx;
			else if (!blocked(s, e.x, ny)) e.y = ny;
		}
		if (d < ATTACK_RANGE && e.cd <= 0) { p.health -= e.dmg; s.dmgFlash = 5; e.cd = ATTACK_COOLDOWN; if (p.health <= 0) { p.health = 0; s.screen = "gameover"; } }
		if (e.cd > 0) e.cd--;
	}
	if (s.dmgFlash > 0) s.dmgFlash--;
	if (s.gunFlash > 0) s.gunFlash--;
}

function move(s: State, fwd: number, str: number) {
	const p = s.player, cos = Math.cos(p.angle), sin = Math.sin(p.angle);
	let dx = cos * fwd - sin * str, dy = sin * fwd + cos * str;
	const len = Math.hypot(dx, dy);
	if (len > 0) { dx = dx / len * MOVE_SPEED; dy = dy / len * MOVE_SPEED; }
	if (!blocked(s, p.x + dx, p.y + dy)) { p.x += dx; p.y += dy; }
	else { if (!blocked(s, p.x + dx, p.y)) p.x += dx; if (!blocked(s, p.x, p.y + dy)) p.y += dy; }
	// Pickups
	for (const pk of s.pickups) {
		if (pk.got || dist(p.x, p.y, pk.x, pk.y) >= PICKUP_RANGE) continue;
		if (pk.type === "health" && p.health < 100) { p.health = Math.min(100, p.health + pk.amt); pk.got = true; s.items++; }
		else if (pk.type === "ammo") { p.ammo += pk.amt; pk.got = true; s.items++; }
	}
	if (cell(s.map, p.x, p.y) === "E") s.screen = "victory";
}

function shoot(s: State) {
	const p = s.player, dx = Math.cos(p.angle), dy = Math.sin(p.angle);
	let hit: Enemy | null = null, hd = MAX_DEPTH;
	for (const e of s.enemies) {
		if (e.dead) continue;
		const ex = e.x - p.x, ey = e.y - p.y, proj = ex * dx + ey * dy;
		if (proj < 0.1 || proj > hd) continue;
		if (Math.abs(ex * dy - ey * dx) < 0.4) {
			const wd = castRay(s, p.x, p.y, p.angle).d;
			if (proj < wd) { hit = e; hd = proj; }
		}
	}
	if (hit) { hit.hp -= 25; if (hit.hp <= 0) { hit.dead = true; s.kills++; } }
}

// Raycast
function castRay(s: State, px: number, py: number, a: number) {
	const dx = Math.cos(a), dy = Math.sin(a);
	let mx = Math.floor(px), my = Math.floor(py);
	const ddx = dx === 0 ? 1e10 : Math.abs(1 / dx), ddy = dy === 0 ? 1e10 : Math.abs(1 / dy);
	const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
	let sdx = dx < 0 ? (px - mx) * ddx : (mx + 1 - px) * ddx;
	let sdy = dy < 0 ? (py - my) * ddy : (my + 1 - py) * ddy;
	let side = 0;
	for (let i = 0; i < MAX_DEPTH * 2; i++) {
		if (sdx < sdy) { sdx += ddx; mx += sx; side = 0; } else { sdy += ddy; my += sy; side = 1; }
		const c = cell(s.map, mx, my);
		if (c === "#") return { d: side === 0 ? sdx - ddx : sdy - ddy, side, door: false };
		if (c === "=") { const dr = getDoor(s, mx, my); if (dr && !dr.open) return { d: side === 0 ? sdx - ddx : sdy - ddy, side, door: true }; }
	}
	return { d: MAX_DEPTH, side: 0, door: false };
}

// Render
function render(s: State, W: number, H: number): string[] {
	if (s.screen !== "game") return renderMenu(s, W, H);
	
	const p = s.player, viewH = H - 2, half = Math.floor(viewH / 2);
	const buf: string[][] = Array.from({ length: viewH }, () => Array(W).fill(" "));
	const zbuf: number[] = Array(W).fill(MAX_DEPTH);
	
	// Walls
	for (let x = 0; x < W; x++) {
		const ray = castRay(s, p.x, p.y, p.angle - FOV / 2 + (x / W) * FOV);
		zbuf[x] = ray.d;
		const wh = Math.floor(viewH / (ray.d + 0.001)), wt = half - Math.floor(wh / 2), wb = half + Math.floor(wh / 2);
		const sh = Math.min(Math.floor(ray.d / (MAX_DEPTH / SHADES.length)), SHADES.length - 1);
		const col = ray.door ? YEL : (ray.side ? D : "");
		for (let y = wt; y < wb && y < viewH; y++) if (y >= 0) buf[y][x] = col + SHADES[sh] + R;
		for (let y = wb; y < viewH; y++) buf[y][x] = D + "." + R;
	}
	
	// Sprites (enemies + pickups)
	const sprites: { sx: number; d: number; h: number; col: string; ch: string }[] = [];
	for (const e of s.enemies) {
		if (e.dead) continue;
		const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy);
		if (d > MAX_DEPTH || d < 0.1) continue;
		let ra = Math.atan2(dy, dx) - p.angle;
		while (ra > Math.PI) ra -= Math.PI * 2; while (ra < -Math.PI) ra += Math.PI * 2;
		if (Math.abs(ra) > FOV / 2 + 0.2) continue;
		const hp = e.hp / e.maxHp;
		sprites.push({ sx: Math.floor((0.5 + ra / FOV) * W), d, h: Math.floor(viewH / d), col: e.type === "zombie" ? GRN : e.type === "imp" ? MAG : RED, ch: hp > 0.5 ? "█" : hp > 0.25 ? "▓" : "░" });
	}
	for (const pk of s.pickups) {
		if (pk.got) continue;
		const dx = pk.x - p.x, dy = pk.y - p.y, d = Math.hypot(dx, dy);
		if (d > MAX_DEPTH || d < 0.1) continue;
		let ra = Math.atan2(dy, dx) - p.angle;
		while (ra > Math.PI) ra -= Math.PI * 2; while (ra < -Math.PI) ra += Math.PI * 2;
		if (Math.abs(ra) > FOV / 2 + 0.2) continue;
		sprites.push({ sx: Math.floor((0.5 + ra / FOV) * W), d, h: Math.floor(viewH / d * 0.5), col: pk.type === "health" ? CYN : YEL, ch: pk.type === "health" ? "+" : "*" });
	}
	sprites.sort((a, b) => b.d - a.d);
	for (const sp of sprites) {
		const sw = Math.max(1, Math.floor(sp.h * 0.5)), startX = sp.sx - Math.floor(sw / 2), startY = half - Math.floor(sp.h / 2);
		for (let sy = 0; sy < sp.h; sy++) {
			const y = startY + sy; if (y < 0 || y >= viewH) continue;
			for (let sx = 0; sx < sw; sx++) {
				const x = startX + sx; if (x < 0 || x >= W || sp.d > zbuf[x]) continue;
				buf[y][x] = sp.col + sp.ch + R;
			}
		}
	}
	
	// Crosshair
	const cx = Math.floor(W / 2), cy = half, cc = s.gunFlash > 0 ? YEL : GRN;
	if (cy > 0 && cy < viewH - 1 && cx > 0 && cx < W - 1) {
		buf[cy][cx - 1] = cc + "-" + R; buf[cy][cx + 1] = cc + "-" + R;
		buf[cy - 1][cx] = cc + "|" + R; buf[cy + 1][cx] = cc + "|" + R;
		buf[cy][cx] = cc + B + (s.gunFlash > 0 ? "*" : "+") + R;
	}
	
	// Minimap (render into buffer directly, top-right corner)
	const mmSize = 3, mmX = W - 8, mmY = 1;
	const arrows = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"];
	for (let dy = -mmSize; dy <= mmSize; dy++) {
		for (let dx = -mmSize; dx <= mmSize; dx++) {
			const bx = mmX + dx + mmSize, by = mmY + dy + mmSize;
			if (bx < 0 || bx >= W || by < 0 || by >= viewH) continue;
			if (dx === 0 && dy === 0) { buf[by][bx] = CYN + arrows[Math.round((p.angle / (Math.PI * 2)) * 8 + 8) % 8] + R; continue; }
			const mx = Math.floor(p.x) + dx, my = Math.floor(p.y) + dy;
			const en = s.enemies.find(e => !e.dead && Math.floor(e.x) === mx && Math.floor(e.y) === my);
			const pk = s.pickups.find(p => !p.got && Math.floor(p.x) === mx && Math.floor(p.y) === my);
			const dr = s.doors.find(d => d.x === mx && d.y === my);
			if (en) buf[by][bx] = RED + "!" + R;
			else if (pk) buf[by][bx] = (pk.type === "health" ? CYN : YEL) + "·" + R;
			else if (dr) buf[by][bx] = (dr.open ? D : YEL) + "=" + R;
			else { const c = cell(s.map, mx, my); buf[by][bx] = c === "#" ? D + "█" + R : c === "E" ? GRN + "E" + R : D + "·" + R; }
		}
	}
	
	// Apply damage flash
	const lines: string[] = [];
	for (let y = 0; y < viewH; y++) {
		let line = "";
		for (let x = 0; x < W; x++) {
			let ch = buf[y][x];
			if (s.dmgFlash > 0 && ch !== " " && !ch.startsWith(RED)) ch = RED + ch.replace(/\x1b\[[0-9;]*m/g, "") + R;
			line += ch;
		}
		lines.push(line);
	}
	
	// HUD
	lines.push(D + "─".repeat(W) + R);
	const hp = s.player.health / 100, hc = hp > 0.6 ? GRN : hp > 0.3 ? YEL : RED;
	const bar = hc + "█".repeat(Math.round(hp * 10)) + D + "░".repeat(10 - Math.round(hp * 10)) + R;
	lines.push(`${RED}HP${R}[${bar}]${s.player.health} ${YEL}AMMO${R}:${s.player.ammo} ${RED}K${R}:${s.kills}/${s.totalE} ${CYN}I${R}:${s.items}/${s.totalI} ${MAG}L${s.level}${R}`);
	
	while (lines.length < H) lines.push("");
	return lines.slice(0, H);
}

function renderMenu(s: State, W: number, H: number): string[] {
	const lines: string[] = [], pad = (n: number) => { while (lines.length < n) lines.push(""); };
	const ctr = (t: string) => { const c = t.replace(/\x1b\[[0-9;]*m/g, ""); return " ".repeat(Math.max(0, Math.floor((W - c.length) / 2))) + t; };
	
	if (s.screen === "title") {
		const logo = ["██████╗  ██████╗  ██████╗ ███╗   ███╗","██╔══██╗██╔═══██╗██╔═══██╗████╗ ████║",
			"██║  ██║██║   ██║██║   ██║██╔████╔██║","██║  ██║██║   ██║██║   ██║██║╚██╔╝██║",
			"██████╔╝╚██████╔╝╚██████╔╝██║ ╚═╝ ██║","╚═════╝  ╚═════╝  ╚═════╝ ╚═╝     ╚═╝"];
		pad(Math.floor(H / 2) - 6);
		for (const l of logo) lines.push(ctr(RED + l + R));
		lines.push("", ctr(D + "ASCII TERMINAL EDITION" + R), "", ctr(GRN + "ENTER" + R + " Start  " + D + "H" + R + " Help  " + D + "ESC" + R + " Quit"));
	} else if (s.screen === "help") {
		pad(Math.floor(H / 2) - 5);
		lines.push(ctr(CYN + B + "═══ CONTROLS ═══" + R), "", ctr("W/S Move  A/D Strafe  Q/E Turn"), ctr("SPACE Shoot  P Pause"), "",
			ctr(CYN + "+" + R + " Health  " + YEL + "*" + R + " Ammo  " + YEL + "=" + R + " Door  " + GRN + "E" + R + " Exit"), "", ctr(D + "Press any key" + R));
	} else if (s.screen === "paused") {
		pad(Math.floor(H / 2) - 2);
		lines.push(ctr(YEL + B + "══ PAUSED ══" + R), "", ctr("P Resume  H Help  Q Quit"));
	} else if (s.screen === "gameover") {
		pad(Math.floor(H / 2) - 3);
		lines.push(ctr(RED + B + "YOU DIED" + R), "", ctr(`Level ${s.level} - Kills: ${s.kills}/${s.totalE}`), "", ctr("ENTER Restart  ESC Title"));
	} else if (s.screen === "victory") {
		pad(Math.floor(H / 2) - 5);
		const t = Math.floor((Date.now() - s.start) / 1000), done = s.level >= LEVELS.length;
		lines.push(ctr(GRN + B + (done ? "══ GAME COMPLETE ══" : "══ LEVEL COMPLETE ══") + R), "",
			ctr(`Time: ${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, "0")}`),
			ctr(`Kills: ${s.kills}/${s.totalE}`), ctr(`Items: ${s.items}/${s.totalI}`), "",
			ctr(GRN + (done ? "ENTER Play Again" : "ENTER Next Level") + R));
	}
	pad(H);
	return lines.slice(0, H);
}

// State
function init(lvl = 1): State {
	const d = LEVELS[Math.min(lvl - 1, LEVELS.length - 1)], { map, px, py, enemies, pickups, doors } = parse(d);
	return { screen: "title", prev: "title", player: { x: px, y: py, angle: 0, health: 100, ammo: 50 },
		enemies, pickups, doors, map, level: lvl, kills: 0, items: 0, totalE: enemies.length, totalI: pickups.length,
		start: Date.now(), dmgFlash: 0, gunFlash: 0 };
}

function load(s: State, lvl: number) {
	const d = LEVELS[Math.min(lvl - 1, LEVELS.length - 1)], { map, px, py, enemies, pickups, doors } = parse(d);
	Object.assign(s, { map, enemies, pickups, doors, level: lvl, kills: 0, items: 0, totalE: enemies.length, totalI: pickups.length,
		screen: "game", start: Date.now(), dmgFlash: 0, gunFlash: 0 });
	s.player.x = px; s.player.y = py; s.player.angle = 0;
}

function reset(s: State) { load(s, 1); s.player.health = 100; s.player.ammo = 50; }

// Extension
export default function (pi: ExtensionAPI) {
	pi.registerCommand("pi-doom", {
		description: "Play ASCII Doom - first-person shooter",
		handler: async (_, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) { ctx.ui.notify("Requires interactive mode", "error"); return; }
			await ctx.waitForIdle();
			const s = init();
			await ctx.ui.custom<void>((tui, _, done) => {
				const timer = setInterval(() => { if (s.screen === "game") { tick(s); tui.invalidate(); } }, TICK_MS);
				return {
					x: 0, y: 0, width: 0, height: 0, visible: true, parent: null as any,
					layout(x, y, w, h) { this.x = x; this.y = y; this.width = w; this.height = h; },
					render(w) { return render(s, w, this.height || 24); },
					handleInput(data) {
						const k = data.toLowerCase(), esc = data === "\x1b" || data === "\x1b\x1b", ent = data === "\r" || data === "\n";
						if (s.screen === "title") {
							if (ent) reset(s); else if (k === "h") { s.prev = "title"; s.screen = "help"; }
							else if (esc) { clearInterval(timer); done(); return true; }
						} else if (s.screen === "help") { s.screen = s.prev; }
						else if (s.screen === "paused") {
							if (k === "p" || esc || ent) s.screen = "game"; else if (k === "h") { s.prev = "paused"; s.screen = "help"; }
							else if (k === "q") s.screen = "title";
						} else if (s.screen === "gameover") { if (ent) reset(s); else if (esc) s.screen = "title"; }
						else if (s.screen === "victory") {
							if (ent) { if (s.level < LEVELS.length) load(s, s.level + 1); else reset(s); }
							else if (esc) s.screen = "title";
						} else if (s.screen === "game") {
							if (k === "w" || data === "\x1b[A") move(s, 1, 0);
							else if (k === "s" || data === "\x1b[B") move(s, -1, 0);
							else if (k === "a") move(s, 0, -1); else if (k === "d") move(s, 0, 1);
							else if (k === "q" || data === "\x1b[D") s.player.angle -= ROT_SPEED;
							else if (k === "e" || data === "\x1b[C") s.player.angle += ROT_SPEED;
							else if (k === "p" || esc) s.screen = "paused";
							else if (data === " " && s.player.ammo > 0) { s.player.ammo--; s.gunFlash = 3; shoot(s); }
						}
						tui.invalidate();
						return true;
					},
				};
			});
		},
	});
}
