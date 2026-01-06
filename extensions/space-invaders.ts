/**
 * Space Invaders game extension - play with /space-invaders
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

const GAME_WIDTH = 24;
const GAME_HEIGHT = 16;
const PLAYER_Y = GAME_HEIGHT - 1;
const TICK_MS = 100;

const INVADER_ROWS = 4;
const INVADER_COLS = 8;
const INVADER_START_X = 1;
const INVADER_START_Y = 1;
const INVADER_SPACING_X = 2;
const INVADER_SPACING_Y = 1;
const INITIAL_INVADER_COUNT = INVADER_ROWS * INVADER_COLS;

const INITIAL_LIVES = 3;
const BASE_INVADER_DELAY = 6;
const PLAYER_SHOT_DELAY = 4;
const INVADER_FIRE_DELAY = 6;
const MAX_INVADER_BULLETS = 2;
const INVADER_SCORE = 10;

const CELL_WIDTH = 2;
const MIN_RENDER_CELLS = 10;

const SPACE_INVADERS_SAVE_TYPE = "space-invaders-save";

type Direction = -1 | 1;
type Point = { x: number; y: number };

type BulletSource = "player" | "invader";

interface Bullet {
	x: number;
	y: number;
	from: BulletSource;
}

interface GameState {
	invaders: Point[];
	invaderDir: Direction;
	invaderFrame: 0 | 1;
	invaderMoveDelay: number;
	invaderMoveCounter: number;
	playerX: number;
	playerBullet: Bullet | null;
	invaderBullets: Bullet[];
	playerCooldown: number;
	invaderCooldown: number;
	score: number;
	highScore: number;
	lives: number;
	level: number;
	gameOver: boolean;
}

const createInvaders = (): Point[] => {
	const invaders: Point[] = [];
	for (let row = 0; row < INVADER_ROWS; row++) {
		for (let col = 0; col < INVADER_COLS; col++) {
			const x = INVADER_START_X + col * (1 + INVADER_SPACING_X);
			const y = INVADER_START_Y + row * (1 + INVADER_SPACING_Y);
			invaders.push({ x, y });
		}
	}
	return invaders;
};

const invaderDelayFor = (level: number, remaining: number): number => {
	const cleared = Math.max(0, INITIAL_INVADER_COUNT - remaining);
	const speedUp = Math.floor(cleared / 4);
	const levelBoost = Math.floor((level - 1) / 2);
	return Math.max(2, BASE_INVADER_DELAY - speedUp - levelBoost);
};

const createInitialState = (highScore = 0): GameState => {
	const invaders = createInvaders();
	return {
		invaders,
		invaderDir: 1,
		invaderFrame: 0,
		invaderMoveDelay: invaderDelayFor(1, invaders.length),
		invaderMoveCounter: 0,
		playerX: Math.floor(GAME_WIDTH / 2),
		playerBullet: null,
		invaderBullets: [],
		playerCooldown: 0,
		invaderCooldown: INVADER_FIRE_DELAY,
		score: 0,
		highScore,
		lives: INITIAL_LIVES,
		level: 1,
		gameOver: false,
	};
};

const cloneState = (state: GameState): GameState => ({
	...state,
	invaders: state.invaders.map((invader) => ({ ...invader })),
	playerBullet: state.playerBullet ? { ...state.playerBullet } : null,
	invaderBullets: state.invaderBullets.map((bullet) => ({ ...bullet })),
});

class SpaceInvadersComponent {
	private state: GameState;
	private interval: ReturnType<typeof setInterval> | null = null;
	private onClose: () => void;
	private onSave: (state: GameState | null) => void;
	private tui: { requestRender: () => void };
	private cachedLines: string[] = [];
	private cachedWidth = 0;
	private version = 0;
	private cachedVersion = -1;
	private paused: boolean;

	constructor(
		tui: { requestRender: () => void },
		onClose: () => void,
		onSave: (state: GameState | null) => void,
		savedState?: GameState,
	) {
		this.tui = tui;
		this.onClose = onClose;
		this.onSave = onSave;

		if (savedState && !savedState.gameOver) {
			this.state = savedState;
			this.paused = true;
		} else {
			const highScore = savedState?.highScore ?? 0;
			this.state = createInitialState(highScore);
			this.paused = false;
			this.startLoop();
		}
	}

	private startLoop(): void {
		if (this.interval) return;
		this.interval = setInterval(() => {
			if (this.paused || this.state.gameOver) return;
			this.tick();
			this.version++;
			this.tui.requestRender();
		}, TICK_MS);
	}

	private stopLoop(): void {
		if (!this.interval) return;
		clearInterval(this.interval);
		this.interval = null;
	}

	private tick(): void {
		if (this.state.playerCooldown > 0) this.state.playerCooldown--;
		if (this.state.invaderCooldown > 0) this.state.invaderCooldown--;

		this.moveBullets();
		this.resolveBulletCollisions();
		if (this.state.gameOver) {
			this.stopLoop();
			return;
		}
		this.moveInvaders();
		if (this.state.gameOver) {
			this.stopLoop();
			return;
		}
		this.maybeFireInvaderBullet();
		this.maybeAdvanceWave();
	}

	private moveBullets(): void {
		if (this.state.playerBullet) {
			this.state.playerBullet = {
				...this.state.playerBullet,
				y: this.state.playerBullet.y - 1,
			};
			if (this.state.playerBullet.y < 0) {
				this.state.playerBullet = null;
			}
		}

		const nextInvaderBullets: Bullet[] = [];
		for (const bullet of this.state.invaderBullets) {
			const moved = { ...bullet, y: bullet.y + 1 };
			if (moved.y <= PLAYER_Y) {
				nextInvaderBullets.push(moved);
			}
		}
		this.state.invaderBullets = nextInvaderBullets;
	}

	private resolveBulletCollisions(): void {
		const playerBullet = this.state.playerBullet;
		if (playerBullet) {
			const bulletIndex = this.state.invaderBullets.findIndex(
				(bullet) => bullet.x === playerBullet.x && bullet.y === playerBullet.y,
			);
			if (bulletIndex >= 0) {
				this.state.invaderBullets.splice(bulletIndex, 1);
				this.state.playerBullet = null;
			}
		}

		const currentPlayerBullet = this.state.playerBullet;
		if (currentPlayerBullet) {
			const invaderIndex = this.state.invaders.findIndex(
				(invader) => invader.x === currentPlayerBullet.x && invader.y === currentPlayerBullet.y,
			);
			if (invaderIndex >= 0) {
				this.state.invaders.splice(invaderIndex, 1);
				this.state.playerBullet = null;
				this.state.score += INVADER_SCORE;
				if (this.state.score > this.state.highScore) {
					this.state.highScore = this.state.score;
				}
				this.state.invaderMoveDelay = invaderDelayFor(this.state.level, this.state.invaders.length);
			}
		}

		const remainingBullets: Bullet[] = [];
		for (const bullet of this.state.invaderBullets) {
			if (bullet.x === this.state.playerX && bullet.y === PLAYER_Y) {
				this.state.lives -= 1;
				if (this.state.lives <= 0) {
					this.state.gameOver = true;
				}
				continue;
			}
			remainingBullets.push(bullet);
		}
		this.state.invaderBullets = remainingBullets;
	}

	private moveInvaders(): void {
		this.state.invaderMoveCounter += 1;
		if (this.state.invaderMoveCounter < this.state.invaderMoveDelay) return;
		this.state.invaderMoveCounter = 0;

		const dir = this.state.invaderDir;
		let hitEdge = false;
		for (const invader of this.state.invaders) {
			const nextX = invader.x + dir;
			if (nextX < 0 || nextX >= GAME_WIDTH) {
				hitEdge = true;
				break;
			}
		}

		if (hitEdge) {
			this.state.invaderDir = (dir === 1 ? -1 : 1) as Direction;
			for (const invader of this.state.invaders) {
				invader.y += 1;
				if (invader.y >= PLAYER_Y) {
					this.state.gameOver = true;
				}
			}
		} else {
			for (const invader of this.state.invaders) {
				invader.x += dir;
			}
		}

		this.state.invaderFrame = this.state.invaderFrame === 0 ? 1 : 0;
	}

	private maybeFireInvaderBullet(): void {
		if (this.state.invaderCooldown > 0) return;
		if (this.state.invaderBullets.length >= MAX_INVADER_BULLETS) return;
		if (this.state.invaders.length === 0) return;

		if (Math.random() > 0.6) {
			this.state.invaderCooldown = 1;
			return;
		}

		const shooters = new Map<number, Point>();
		for (const invader of this.state.invaders) {
			const existing = shooters.get(invader.x);
			if (!existing || invader.y > existing.y) {
				shooters.set(invader.x, invader);
			}
		}

		const shooterList = Array.from(shooters.values());
		if (shooterList.length === 0) return;
		const shooter = shooterList[Math.floor(Math.random() * shooterList.length)];

		this.state.invaderBullets.push({ x: shooter.x, y: shooter.y + 1, from: "invader" });
		this.state.invaderCooldown = INVADER_FIRE_DELAY;
	}

	private maybeAdvanceWave(): void {
		if (this.state.invaders.length > 0) return;
		this.state.level += 1;
		this.state.invaders = createInvaders();
		this.state.invaderDir = 1;
		this.state.invaderFrame = 0;
		this.state.invaderMoveDelay = invaderDelayFor(this.state.level, this.state.invaders.length);
		this.state.invaderMoveCounter = 0;
		this.state.playerBullet = null;
		this.state.invaderBullets = [];
		this.state.playerCooldown = 0;
		this.state.invaderCooldown = INVADER_FIRE_DELAY;
		this.state.playerX = Math.floor(GAME_WIDTH / 2);
	}

	private togglePause(): void {
		this.paused = !this.paused;
		if (this.paused) {
			this.stopLoop();
		} else {
			this.startLoop();
		}
		this.version++;
		this.tui.requestRender();
	}

	private restartGame(): void {
		const highScore = this.state.highScore;
		this.state = createInitialState(highScore);
		this.paused = false;
		this.stopLoop();
		this.startLoop();
		this.onSave(null);
		this.version++;
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		if (this.paused) {
			if (matchesKey(data, "escape") || data === "q" || data === "Q") {
				this.dispose();
				this.onClose();
				return;
			}
			this.paused = false;
			this.startLoop();
			this.version++;
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "escape")) {
			this.dispose();
			this.onSave(cloneState(this.state));
			this.onClose();
			return;
		}

		if (data === "q" || data === "Q") {
			this.dispose();
			this.onSave(null);
			this.onClose();
			return;
		}

		if (this.state.gameOver && (data === "r" || data === "R" || data === " ")) {
			this.restartGame();
			return;
		}

		if (data === "p" || data === "P") {
			this.togglePause();
			return;
		}

		if (matchesKey(data, "left") || data === "a" || data === "A") {
			this.state.playerX = Math.max(0, this.state.playerX - 1);
			this.version++;
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "right") || data === "d" || data === "D") {
			this.state.playerX = Math.min(GAME_WIDTH - 1, this.state.playerX + 1);
			this.version++;
			this.tui.requestRender();
			return;
		}

		if (data === " " && !this.state.gameOver) {
			if (this.state.playerCooldown === 0 && !this.state.playerBullet) {
				this.state.playerBullet = { x: this.state.playerX, y: PLAYER_Y - 1, from: "player" };
				this.state.playerCooldown = PLAYER_SHOT_DELAY;
				this.version++;
				this.tui.requestRender();
			}
		}
	}

	invalidate(): void {
		this.cachedWidth = 0;
	}

	render(width: number): string[] {
		if (width === this.cachedWidth && this.cachedVersion === this.version) {
			return this.cachedLines;
		}

		const maxCells = Math.floor((width - 2) / CELL_WIDTH);
		if (maxCells < MIN_RENDER_CELLS) {
			const message = "Space Invaders needs a wider terminal";
			const line = truncateToWidth(message, width);
			this.cachedLines = [line];
			this.cachedWidth = width;
			this.cachedVersion = this.version;
			return this.cachedLines;
		}

		const renderWidth = Math.min(GAME_WIDTH, maxCells);
		const boxWidth = renderWidth * CELL_WIDTH;

		const lines: string[] = [];
		const topBorder = `+${"-".repeat(boxWidth)}+`;

		lines.push(this.padLine(topBorder, width));

		const header = `SPACE INVADERS | Score: ${this.state.score} | Lives: ${this.state.lives} | Level: ${this.state.level} | High: ${this.state.highScore}`;
		lines.push(this.padLine(this.boxLine(header, boxWidth), width));
		lines.push(this.padLine(this.boxLine("-".repeat(boxWidth), boxWidth), width));

		const invaderMap = new Set(this.state.invaders.map((invader) => `${invader.x},${invader.y}`));
		const invaderBulletMap = new Set(this.state.invaderBullets.map((bullet) => `${bullet.x},${bullet.y}`));
		const playerBulletKey = this.state.playerBullet ? `${this.state.playerBullet.x},${this.state.playerBullet.y}` : null;

		const invaderGlyph = this.state.invaderFrame === 0 ? "MM" : "WW";
		const playerGlyph = "^^";
		const playerBulletGlyph = "||";
		const invaderBulletGlyph = "!!";

		for (let y = 0; y < GAME_HEIGHT; y++) {
			let row = "";
			for (let x = 0; x < renderWidth; x++) {
				const key = `${x},${y}`;
				if (playerBulletKey === key) {
					row += playerBulletGlyph;
					continue;
				}
				if (invaderBulletMap.has(key)) {
					row += invaderBulletGlyph;
					continue;
				}
				if (y === PLAYER_Y && x === this.state.playerX) {
					row += playerGlyph;
					continue;
				}
				if (invaderMap.has(key)) {
					row += invaderGlyph;
					continue;
				}
				row += "  ";
			}
			lines.push(this.padLine(`|${row}|`, width));
		}

		lines.push(this.padLine(this.boxLine("-".repeat(boxWidth), boxWidth), width));

		let footer: string;
		if (this.paused) {
			footer = "PAUSED - Press any key to resume, Q to quit";
		} else if (this.state.gameOver) {
			footer = "GAME OVER - Press R to restart, Q to quit";
		} else {
			footer = "Left/Right or A/D move, Space fire, P pause, ESC save, Q quit";
		}
		lines.push(this.padLine(this.boxLine(footer, boxWidth), width));
		lines.push(this.padLine(topBorder, width));

		this.cachedLines = lines;
		this.cachedWidth = width;
		this.cachedVersion = this.version;

		return lines;
	}

	private boxLine(content: string, width: number): string {
		const truncated = truncateToWidth(content, width);
		const padding = Math.max(0, width - visibleWidth(truncated));
		return `|${truncated}${" ".repeat(padding)}|`;
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
	pi.registerCommand("space-invaders", {
		description: "Play Space Invaders!",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Space Invaders requires interactive mode", "error");
				return;
			}

			const entries = ctx.sessionManager.getEntries();
			let savedState: GameState | undefined;
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i];
				if (entry.type === "custom" && entry.customType === SPACE_INVADERS_SAVE_TYPE) {
					savedState = entry.data as GameState;
					break;
				}
			}

			await ctx.ui.custom((tui, _theme, done) => {
				return new SpaceInvadersComponent(
					tui,
					() => done(undefined),
					(state) => {
						pi.appendEntry(SPACE_INVADERS_SAVE_TYPE, state);
					},
					savedState,
				);
			});
		},
	});
}
