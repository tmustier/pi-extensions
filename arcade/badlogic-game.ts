/**
 * Badlogic Game - a Mario-style TUI platformer. Play with /badlogic-game
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

const {
	createGame,
	stepGame,
	renderViewport,
	renderHud,
	saveState,
	loadState,
	setPaused,
	makeLevel,
} = require("../badlogic-game/engine.js") as typeof import("../badlogic-game/engine.js");
const { LEVEL_1_LINES } = require("../badlogic-game/levels.js") as typeof import("../badlogic-game/levels.js");

const TICK_MS = 50;
const VIEWPORT_W = 40;
const VIEWPORT_H = 15;
const HUD_LINES = 2;
const SAVE_TYPE = "badlogic-game-save";

class BadlogicGameComponent {
	private readonly tui: any;
	private readonly onClose: () => void;
	private readonly onSave: (state: any) => void;
	private interval: NodeJS.Timeout | null = null;
	private state: any;
	private version = 0;
	private cache = { lines: [] as string[], width: 0, version: -1 };
	private moveDir = 0;
	private runHeld = false;
	private jumpQueued = false;
	private autosaveTimer = 0;

	constructor(tui: any, onClose: () => void, onSave: (state: any) => void, saved?: any) {
		this.tui = tui;
		this.onClose = onClose;
		this.onSave = onSave;

		const config = { dt: TICK_MS / 1000, viewportWidth: VIEWPORT_W };
		const restored = saved ? loadState(saved, { config }) : null;
		this.state = restored || createGame({ level: makeLevel(LEVEL_1_LINES), startX: 1, startY: 13, config, levelIndex: 1 });

		this.interval = setInterval(() => this.tick(), TICK_MS);
	}

	private tick(): void {
		const input: any = {};
		if (this.moveDir < 0) input.left = true;
		if (this.moveDir > 0) input.right = true;
		if (this.runHeld) input.run = true;
		if (this.jumpQueued) input.jump = true;
		this.jumpQueued = false;

		stepGame(this.state, input);

		if (!this.state.player.dead && !this.state.paused) {
			this.autosaveTimer += TICK_MS / 1000;
			if (this.autosaveTimer >= 5) {
				this.onSave(saveState(this.state));
				this.autosaveTimer = 0;
			}
		}

		this.version += 1;
		this.tui.requestRender();
	}

	handleInput(key: string): boolean {
		if (matchesKey(key, "escape") || key === "q" || key === "Q") {
			this.onSave(saveState(this.state));
			this.onClose();
			return true;
		}
		if (key === "p" || key === "P") {
			setPaused(this.state, !this.state.paused);
			if (this.state.paused) this.onSave(saveState(this.state));
			this.version += 1;
			this.tui.requestRender();
			return true;
		}
		if (key === "x" || key === "X") {
			this.runHeld = !this.runHeld;
			return true;
		}
		if (key === " " || key === "z" || key === "Z") {
			this.jumpQueued = true;
			return true;
		}
		if (matchesKey(key, "left") || key === "a" || key === "h" || key === "A" || key === "H") {
			this.moveDir = -1;
			return true;
		}
		if (matchesKey(key, "right") || key === "d" || key === "l" || key === "D" || key === "L") {
			this.moveDir = 1;
			return true;
		}
		if (key === "s" || key === "S") {
			this.moveDir = 0;
			return true;
		}
		return true;
	}

	render(width: number, height: number): string[] {
		const pad = (line: string) => {
			const truncated = truncateToWidth(line, width);
			const padding = Math.max(0, width - visibleWidth(truncated));
			return truncated + " ".repeat(padding);
		};

		const minWidth = VIEWPORT_W * 2;
		const minHeight = VIEWPORT_H + HUD_LINES + 2;
		if (width < minWidth || height < minHeight) {
			return [
				"",
				pad("BADLOGIC-GAME"),
				"",
				pad("Terminal too small"),
				pad(`Need ${minWidth} cols, ${minHeight} rows`),
				"",
				pad("[Q] Quit"),
			];
		}

		if (this.cache.version === this.version && this.cache.width === width) return this.cache.lines;

		const lines: string[] = [];
		lines.push(...renderHud(this.state, minWidth).split("\n").map(pad));
		lines.push(...renderViewport(this.state, VIEWPORT_W, VIEWPORT_H).split("\n").map(pad));
		lines.push("");
		lines.push(pad("[Arrows/HJKL] Move  [Space] Jump  [X] Run  [P] Pause  [S] Stop  [Q] Quit"));
		if (this.state.player.dead) lines.push(pad("GAME OVER - [Q] Quit"));

		this.cache = { lines, width, version: this.version };
		return lines;
	}

	dispose(): void {
		if (this.interval) clearInterval(this.interval);
	}
}

export default function (api: ExtensionAPI) {
	api.registerCommand("badlogic-game", {
		description: "Play Badlogic Game (Mario-style platformer)!",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Badlogic Game requires interactive mode", "error");
				return;
			}

			const entries = ctx.sessionManager.getEntries();
			const saved = entries.reverse().find((e) => e.type === "custom" && e.customType === SAVE_TYPE)?.data as any | undefined;

			await ctx.ui.custom((tui, _theme, _kb, done) =>
				new BadlogicGameComponent(tui, () => done(undefined), (state) => api.appendEntry(SAVE_TYPE, state), saved)
			);
		},
	});
}
