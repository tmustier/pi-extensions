import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, constants as fsConstants, openSync } from "node:fs";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

const WEATHER_COLUMNS = 100;
const WEATHER_ROWS = 30;
const WEATHER_STATUS_KEY = "weather-widget";
const WEATHER_CONFIG_HOME = path.join(os.homedir(), ".pi", "weather-widget");

const DEFAULT_WEATHER_CONFIG = `hide_hud = false

[location]
latitude = 52.5200
longitude = 13.4050
auto = true # set false to force the latitude/longitude above
hide = false

[units]
temperature = "celsius"
wind_speed = "kmh"
precipitation = "mm"
`;

const WEATHER_SIMULATION_CONDITIONS = new Set([
	"clear",
	"partly-cloudy",
	"cloudy",
	"overcast",
	"fog",
	"drizzle",
	"rain",
	"freezing-rain",
	"rain-showers",
	"snow",
	"snow-grains",
	"snow-showers",
	"thunderstorm",
	"thunderstorm-hail",
]);

type ParserMode = "normal" | "escape" | "csi" | "osc" | "osc_escape";

interface ParsedWeatherArgs {
	forwardedArgs: string[];
	ignoredTokens: string[];
}

interface WeatherWidgetOptions {
	tui: { requestRender: () => void };
	onClose: () => void;
	scriptPath: string;
	weathrPath: string;
	weathrArgs: string[];
	configHome: string;
	columns: number;
	rows: number;
}

interface NativeWeatherSnapshot {
	stdout: string;
	stderr: string;
	exited: boolean;
	exitCode?: number;
	exitSignal?: string;
}

interface NativeWeatherProcess {
	poll(): NativeWeatherSnapshot;
	writeInput(input: string): boolean;
	stop(): void;
}

interface NativeWeatherBridgeModule {
	NativeWeatherProcess: new (
		scriptPath: string,
		weathrPath: string,
		args: string[],
		configHome: string,
		columns: number,
		rows: number,
	) => NativeWeatherProcess;
}

const NATIVE_POLL_INTERVAL_MS = 33;
const NATIVE_STARTUP_TIMEOUT_MS = 1500;
const require = createRequire(import.meta.url);
let nativeWeatherBridgeModule: NativeWeatherBridgeModule | null | undefined;
let nativeWeatherBridgeLoadError: unknown | null = null;

function isNativeWeatherBridgeModule(value: unknown): value is NativeWeatherBridgeModule {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const constructorValue = Reflect.get(value, "NativeWeatherProcess");
	return typeof constructorValue === "function";
}

function getNativeWeatherBridgeModule(): NativeWeatherBridgeModule | null {
	if (nativeWeatherBridgeModule !== undefined) {
		return nativeWeatherBridgeModule;
	}

	try {
		const loaded: unknown = require("./native/weathr-bridge/index.js");
		if (!isNativeWeatherBridgeModule(loaded)) {
			nativeWeatherBridgeLoadError = new Error("Invalid native weather bridge module shape");
			nativeWeatherBridgeModule = null;
			return nativeWeatherBridgeModule;
		}
		nativeWeatherBridgeLoadError = null;
		nativeWeatherBridgeModule = loaded;
	} catch (error) {
		nativeWeatherBridgeLoadError = error;
		nativeWeatherBridgeModule = null;
	}

	return nativeWeatherBridgeModule;
}

interface ScreenCell {
	character: string;
	style: string;
}

function createBlankCell(): ScreenCell {
	return {
		character: " ",
		style: "",
	};
}

class AnsiScreenBuffer {
	private readonly cells: ScreenCell[][];
	private row = 0;
	private col = 0;
	private mode: ParserMode = "normal";
	private csiBuffer = "";
	private currentStyle = "";
	private readonly formatTokens = new Set<string>();
	private foregroundToken: string | null = null;
	private backgroundToken: string | null = null;

	constructor(
		private readonly columns: number,
		private readonly rows: number,
	) {
		this.cells = Array.from({ length: rows }, () =>
			Array.from({ length: columns }, () => createBlankCell()),
		);
	}

	clear(): void {
		for (let row = 0; row < this.rows; row += 1) {
			const currentRow = this.cells[row];
			if (!currentRow) continue;
			for (let col = 0; col < this.columns; col += 1) {
				const cell = currentRow[col];
				if (!cell) continue;
				cell.character = " ";
				cell.style = "";
			}
		}
		this.row = 0;
		this.col = 0;
		this.mode = "normal";
		this.csiBuffer = "";
		this.resetStyleState();
	}

	feed(chunk: string): void {
		for (const character of chunk) {
			this.consume(character);
		}
	}

	getLines(): string[] {
		return this.cells.map((line) => this.renderLine(line));
	}

	private renderLine(line: ScreenCell[]): string {
		let lastVisibleIndex = -1;
		for (let index = line.length - 1; index >= 0; index -= 1) {
			const cell = line[index];
			if (cell && cell.character !== " ") {
				lastVisibleIndex = index;
				break;
			}
		}
		if (lastVisibleIndex < 0) {
			return "";
		}

		let output = "";
		let activeStyle = "";
		for (let index = 0; index <= lastVisibleIndex; index += 1) {
			const cell = line[index];
			if (!cell) {
				continue;
			}
			if (cell.style !== activeStyle) {
				if (cell.style.length === 0) {
					if (activeStyle.length > 0) {
						output += "\u001b[0m";
					}
				} else {
					output += cell.style;
				}
				activeStyle = cell.style;
			}
			output += cell.character;
		}

		if (activeStyle.length > 0) {
			output += "\u001b[0m";
		}
		return output;
	}

	private consume(character: string): void {
		switch (this.mode) {
			case "normal":
				this.consumeNormal(character);
				return;
			case "escape":
				this.consumeEscape(character);
				return;
			case "csi":
				this.consumeCsi(character);
				return;
			case "osc":
				this.consumeOsc(character);
				return;
			case "osc_escape":
				this.consumeOscEscape(character);
				return;
		}
	}

	private consumeNormal(character: string): void {
		if (character === "\u001b") {
			this.mode = "escape";
			return;
		}

		if (character === "\n") {
			this.row = Math.min(this.rows - 1, this.row + 1);
			return;
		}

		if (character === "\r") {
			this.col = 0;
			return;
		}

		if (character === "\b") {
			this.col = Math.max(0, this.col - 1);
			return;
		}

		if (character === "\t") {
			const tabWidth = 4;
			const targetCol = Math.min(this.columns - 1, this.col + (tabWidth - (this.col % tabWidth)));
			while (this.col < targetCol) {
				this.writeChar(" ");
			}
			return;
		}

		const codePoint = character.codePointAt(0);
		if (codePoint === undefined || codePoint < 0x20) {
			return;
		}

		this.writeChar(character);
	}

	private consumeEscape(character: string): void {
		if (character === "[") {
			this.mode = "csi";
			this.csiBuffer = "";
			return;
		}

		if (character === "]") {
			this.mode = "osc";
			return;
		}

		this.mode = "normal";
	}

	private consumeCsi(character: string): void {
		if (!this.isFinalCsiCharacter(character)) {
			this.csiBuffer += character;
			return;
		}

		this.applyCsi(this.csiBuffer, character);
		this.mode = "normal";
		this.csiBuffer = "";
	}

	private consumeOsc(character: string): void {
		if (character === "\u0007") {
			this.mode = "normal";
			return;
		}

		if (character === "\u001b") {
			this.mode = "osc_escape";
		}
	}

	private consumeOscEscape(character: string): void {
		if (character === "\\") {
			this.mode = "normal";
			return;
		}
		this.mode = "osc";
	}

	private applyCsi(sequence: string, finalChar: string): void {
		switch (finalChar) {
			case "H":
			case "f": {
				const [rowRaw, colRaw] = sequence.split(";");
				const targetRow = this.parseCsiNumber(rowRaw, 1) - 1;
				const targetCol = this.parseCsiNumber(colRaw, 1) - 1;
				this.row = this.clamp(targetRow, 0, this.rows - 1);
				this.col = this.clamp(targetCol, 0, this.columns - 1);
				return;
			}
			case "A": {
				const amount = this.parseCsiNumber(sequence, 1);
				this.row = this.clamp(this.row - amount, 0, this.rows - 1);
				return;
			}
			case "B": {
				const amount = this.parseCsiNumber(sequence, 1);
				this.row = this.clamp(this.row + amount, 0, this.rows - 1);
				return;
			}
			case "C": {
				const amount = this.parseCsiNumber(sequence, 1);
				this.col = this.clamp(this.col + amount, 0, this.columns - 1);
				return;
			}
			case "D": {
				const amount = this.parseCsiNumber(sequence, 1);
				this.col = this.clamp(this.col - amount, 0, this.columns - 1);
				return;
			}
			case "J": {
				this.eraseDisplay(this.parseCsiNumber(sequence, 0));
				return;
			}
			case "K": {
				this.eraseLine(this.parseCsiNumber(sequence, 0));
				return;
			}
			case "h": {
				if (sequence === "?1049") {
					this.clear();
				}
				return;
			}
			case "l": {
				if (sequence === "?1049") {
					this.clear();
				}
				return;
			}
			case "m": {
				this.applySgr(sequence);
				return;
			}
			default:
				return;
		}
	}

	private applySgr(sequence: string): void {
		const tokens = sequence.length === 0
			? ["0"]
			: sequence
				.split(";")
				.map((token) => token.trim())
				.filter((token) => token.length > 0);
		if (tokens.length === 0) {
			this.resetStyleState();
			return;
		}

		for (let index = 0; index < tokens.length; index += 1) {
			const token = tokens[index];
			const code = Number.parseInt(token, 10);
			if (Number.isNaN(code)) {
				continue;
			}

			if (code === 0) {
				this.resetStyleState();
				continue;
			}
			if (code >= 1 && code <= 9) {
				this.formatTokens.add(String(code));
				continue;
			}
			if (code === 22) {
				this.formatTokens.delete("1");
				this.formatTokens.delete("2");
				continue;
			}
			if (code === 23) {
				this.formatTokens.delete("3");
				continue;
			}
			if (code === 24) {
				this.formatTokens.delete("4");
				continue;
			}
			if (code === 25) {
				this.formatTokens.delete("5");
				continue;
			}
			if (code === 27) {
				this.formatTokens.delete("7");
				continue;
			}
			if (code === 28) {
				this.formatTokens.delete("8");
				continue;
			}
			if (code === 29) {
				this.formatTokens.delete("9");
				continue;
			}
			if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
				this.foregroundToken = String(code);
				continue;
			}
			if (code === 39) {
				this.foregroundToken = null;
				continue;
			}
			if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
				this.backgroundToken = String(code);
				continue;
			}
			if (code === 49) {
				this.backgroundToken = null;
				continue;
			}
			if (code === 38 || code === 48) {
				const mode = tokens[index + 1];
				if (mode === "5") {
					const value = tokens[index + 2];
					if (value) {
						const tokenValue = `${code};5;${value}`;
						if (code === 38) {
							this.foregroundToken = tokenValue;
						} else {
							this.backgroundToken = tokenValue;
						}
						index += 2;
					}
					continue;
				}
				if (mode === "2") {
					const r = tokens[index + 2];
					const g = tokens[index + 3];
					const b = tokens[index + 4];
					if (r && g && b) {
						const tokenValue = `${code};2;${r};${g};${b}`;
						if (code === 38) {
							this.foregroundToken = tokenValue;
						} else {
							this.backgroundToken = tokenValue;
						}
						index += 4;
					}
				}
			}
		}

		this.rebuildCurrentStyle();
	}

	private resetStyleState(): void {
		this.formatTokens.clear();
		this.foregroundToken = null;
		this.backgroundToken = null;
		this.currentStyle = "";
	}

	private rebuildCurrentStyle(): void {
		const orderedFormats = ["1", "2", "3", "4", "5", "7", "8", "9"]
			.filter((token) => this.formatTokens.has(token));
		const tokens = [...orderedFormats];
		if (this.foregroundToken) {
			tokens.push(this.foregroundToken);
		}
		if (this.backgroundToken) {
			tokens.push(this.backgroundToken);
		}
		this.currentStyle = tokens.length === 0 ? "" : `\u001b[${tokens.join(";")}m`;
	}

	private eraseDisplay(mode: number): void {
		if (mode === 2 || mode === 3) {
			this.clear();
			return;
		}

		if (mode === 0) {
			for (let row = this.row; row < this.rows; row += 1) {
				const currentRow = this.cells[row];
				if (!currentRow) continue;
				const startCol = row === this.row ? this.col : 0;
				for (let col = startCol; col < this.columns; col += 1) {
					const cell = currentRow[col];
					if (!cell) continue;
					cell.character = " ";
					cell.style = "";
				}
			}
			return;
		}

		if (mode === 1) {
			for (let row = 0; row <= this.row; row += 1) {
				const currentRow = this.cells[row];
				if (!currentRow) continue;
				const endCol = row === this.row ? this.col : this.columns - 1;
				for (let col = 0; col <= endCol; col += 1) {
					const cell = currentRow[col];
					if (!cell) continue;
					cell.character = " ";
					cell.style = "";
				}
			}
		}
	}

	private eraseLine(mode: number): void {
		const currentRow = this.cells[this.row];
		if (!currentRow) return;

		if (mode === 2) {
			for (let col = 0; col < this.columns; col += 1) {
				const cell = currentRow[col];
				if (!cell) continue;
				cell.character = " ";
				cell.style = "";
			}
			return;
		}

		if (mode === 1) {
			for (let col = 0; col <= this.col; col += 1) {
				const cell = currentRow[col];
				if (!cell) continue;
				cell.character = " ";
				cell.style = "";
			}
			return;
		}

		for (let col = this.col; col < this.columns; col += 1) {
			const cell = currentRow[col];
			if (!cell) continue;
			cell.character = " ";
			cell.style = "";
		}
	}

	private writeChar(character: string): void {
		const currentRow = this.cells[this.row];
		if (!currentRow) return;
		const cell = currentRow[this.col];
		if (!cell) return;
		cell.character = character;
		cell.style = this.currentStyle;
		this.col += 1;
		if (this.col >= this.columns) {
			this.col = 0;
			if (this.row < this.rows - 1) {
				this.row += 1;
			}
		}
	}

	private parseCsiNumber(raw: string | undefined, fallback: number): number {
		if (!raw || raw.length === 0) {
			return fallback;
		}
		const normalized = raw.replace(/^\?/u, "");
		const parsed = Number.parseInt(normalized, 10);
		if (Number.isNaN(parsed)) {
			return fallback;
		}
		return parsed;
	}

	private isFinalCsiCharacter(character: string): boolean {
		const codePoint = character.codePointAt(0);
		if (codePoint === undefined) {
			return false;
		}
		return codePoint >= 0x40 && codePoint <= 0x7e;
	}

	private clamp(value: number, min: number, max: number): number {
		return Math.max(min, Math.min(max, value));
	}
}

class WeatherWidgetComponent {
	private readonly screen: AnsiScreenBuffer;
	private process: ChildProcess | null = null;
	private nativeProcess: NativeWeatherProcess | null = null;
	private nativePollHandle: ReturnType<typeof setInterval> | null = null;
	private nativeStartupTimeout: ReturnType<typeof setTimeout> | null = null;
	private hasOutput = false;
	private lastNotice: string | undefined;
	private readonly expectedExitPids = new Set<number>();
	private activeRunId = 0;
	private nativeFallbackWarned = false;

	constructor(private readonly options: WeatherWidgetOptions) {
		this.screen = new AnsiScreenBuffer(options.columns, options.rows);
		this.startProcess();
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || data === "q" || data === "Q") {
			this.dispose();
			this.options.onClose();
			return;
		}

		if (data === "r" || data === "R") {
			this.restart();
		}
	}

	render(width: number): string[] {
		if (!this.hasOutput) {
			if (this.lastNotice) {
				return [truncateToWidth(this.lastNotice, width)];
			}
			return [truncateToWidth("Starting weather widget...", width)];
		}

		const lines = this.screen.getLines().map((line) => truncateToWidth(line, width));
		if (this.lastNotice) {
			lines.push(truncateToWidth(this.lastNotice, width));
		}
		return lines;
	}

	invalidate(): void {}

	private consumeStdout(output: string): boolean {
		if (output.length === 0) {
			return false;
		}
		this.clearNativeStartupTimeout();
		this.screen.feed(output);
		this.hasOutput = true;
		return true;
	}

	private consumeStderr(output: string): boolean {
		const message = output.trim();
		if (message.length === 0) {
			return false;
		}
		this.lastNotice = message;
		return true;
	}

	private setExitNotice(reason: string): void {
		this.lastNotice = `weathr exited (${reason}). Press R to restart.`;
	}

	dispose(): void {
		this.activeRunId += 1;
		this.stopNativeProcess();
		this.stopScriptProcess();
	}

	private restart(): void {
		this.dispose();
		this.screen.clear();
		this.hasOutput = false;
		this.lastNotice = undefined;
		this.startProcess();
		this.options.tui.requestRender();
	}

	private shouldUseNativeBridge(): boolean {
		return process.env.PI_WEATHER_NATIVE !== "0";
	}

	private startProcess(): void {
		const runId = this.activeRunId + 1;
		this.activeRunId = runId;

		const nativeModule = getNativeWeatherBridgeModule();
		if (this.shouldUseNativeBridge() && nativeModule && this.startNativeProcess(nativeModule, runId)) {
			return;
		}

		if (!this.nativeFallbackWarned && nativeWeatherBridgeLoadError) {
			this.nativeFallbackWarned = true;
			this.lastNotice = "Native weather bridge unavailable. Using shell fallback.";
		}

		this.startScriptProcess(runId);
	}

	private startNativeProcess(nativeModule: NativeWeatherBridgeModule, runId: number): boolean {
		try {
			this.nativeProcess = new nativeModule.NativeWeatherProcess(
				this.options.scriptPath,
				this.options.weathrPath,
				this.options.weathrArgs,
				this.options.configHome,
				this.options.columns,
				this.options.rows,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.lastNotice = `Native weather bridge failed: ${message}. Using shell fallback.`;
			this.nativeProcess = null;
			return false;
		}

		this.clearNativePollHandle();
		this.nativePollHandle = setInterval(() => {
			this.pollNativeProcess(runId);
		}, NATIVE_POLL_INTERVAL_MS);
		this.scheduleNativeStartupFallback(runId);
		return true;
	}

	private pollNativeProcess(runId: number): void {
		if (runId !== this.activeRunId) {
			return;
		}
		const process = this.nativeProcess;
		if (!process) {
			return;
		}

		let snapshot: NativeWeatherSnapshot;
		try {
			snapshot = process.poll();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.clearNativePollHandle();
			this.clearNativeStartupTimeout();
			this.nativeProcess = null;
			this.lastNotice = `Native weather bridge crashed: ${message}. Press R to restart.`;
			this.options.tui.requestRender();
			return;
		}

		const renderedStdout = this.consumeStdout(snapshot.stdout);
		const renderedStderr = this.consumeStderr(snapshot.stderr);
		let renderedExit = false;
		if (snapshot.exited) {
			this.clearNativePollHandle();
			this.clearNativeStartupTimeout();
			this.nativeProcess = null;
			const reason = this.formatNativeExitReason(snapshot);
			this.setExitNotice(reason);
			renderedExit = true;
		}

		if (renderedStdout || renderedStderr || renderedExit) {
			this.options.tui.requestRender();
		}
	}

	private formatNativeExitReason(snapshot: NativeWeatherSnapshot): string {
		if (typeof snapshot.exitCode === "number") {
			return `code ${snapshot.exitCode}`;
		}
		if (snapshot.exitSignal && snapshot.exitSignal.length > 0) {
			return `signal ${snapshot.exitSignal}`;
		}
		return "unknown";
	}

	private clearNativePollHandle(): void {
		if (!this.nativePollHandle) {
			return;
		}
		clearInterval(this.nativePollHandle);
		this.nativePollHandle = null;
	}

	private scheduleNativeStartupFallback(runId: number): void {
		this.clearNativeStartupTimeout();
		this.nativeStartupTimeout = setTimeout(() => {
			if (runId !== this.activeRunId) {
				return;
			}
			if (this.hasOutput) {
				return;
			}
			if (!this.nativeProcess) {
				return;
			}
			this.stopNativeProcess();
			this.lastNotice = "Native weather bridge produced no output. Falling back to shell bridge.";
			this.startScriptProcess(runId);
			this.options.tui.requestRender();
		}, NATIVE_STARTUP_TIMEOUT_MS);
	}

	private clearNativeStartupTimeout(): void {
		if (!this.nativeStartupTimeout) {
			return;
		}
		clearTimeout(this.nativeStartupTimeout);
		this.nativeStartupTimeout = null;
	}

	private stopNativeProcess(): void {
		this.clearNativePollHandle();
		this.clearNativeStartupTimeout();
		const nativeProcess = this.nativeProcess;
		this.nativeProcess = null;
		if (!nativeProcess) {
			return;
		}

		try {
			nativeProcess.writeInput("q");
		} catch {
			// Best effort.
		}

		try {
			nativeProcess.stop();
		} catch {
			// Best effort.
		}
	}

	private startScriptProcess(runId: number): void {
		const escapedBinary = shellQuote(this.options.weathrPath);
		const escapedArgs = this.options.weathrArgs.map(shellQuote).join(" ");
		const weatherCommand = escapedArgs.length > 0 ? `${escapedBinary} ${escapedArgs}` : escapedBinary;
		const shellCommand = `stty cols ${this.options.columns} rows ${this.options.rows}; exec ${weatherCommand}`;

		const scriptStdin = resolveScriptStdin();
		let child: ChildProcess;
		try {
			child = spawn(this.options.scriptPath, ["-q", "/dev/null", "sh", "-c", shellCommand], {
				env: createWeatherEnv(this.options.configHome),
				stdio: [scriptStdin, "pipe", "pipe"],
			});
		} catch (error) {
			if (typeof scriptStdin === "number") {
				try {
					closeSync(scriptStdin);
				} catch {
					// Best effort.
				}
			}
			const message = error instanceof Error ? error.message : String(error);
			this.lastNotice = `Failed to start weathr: ${message}`;
			this.options.tui.requestRender();
			return;
		}
		if (typeof scriptStdin === "number") {
			try {
				closeSync(scriptStdin);
			} catch {
				// Best effort.
			}
		}

		if (!child.stdout || !child.stderr) {
			this.lastNotice = "Failed to start weathr: missing stdio streams.";
			this.options.tui.requestRender();
			try {
				child.kill("SIGTERM");
			} catch {
				// Best effort.
			}
			return;
		}

		this.process = child;
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");

		child.stdout.on("data", (chunk: string | Buffer) => {
			if (runId !== this.activeRunId) {
				return;
			}
			const output = typeof chunk === "string" ? chunk : chunk.toString("utf8");
			if (this.consumeStdout(output)) {
				this.options.tui.requestRender();
			}
		});

		child.stderr.on("data", (chunk: string | Buffer) => {
			if (runId !== this.activeRunId) {
				return;
			}
			const output = typeof chunk === "string" ? chunk : chunk.toString("utf8");
			if (this.consumeStderr(output)) {
				this.options.tui.requestRender();
			}
		});

		child.on("error", (error: Error) => {
			if (runId !== this.activeRunId) {
				return;
			}
			this.process = null;
			this.lastNotice = `Failed to start weathr: ${error.message}`;
			this.options.tui.requestRender();
		});

		child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
			if (child.pid !== undefined && this.expectedExitPids.delete(child.pid)) {
				if (runId === this.activeRunId) {
					this.process = null;
				}
				return;
			}
			if (runId !== this.activeRunId) {
				return;
			}
			this.process = null;
			const reason = code !== null ? `code ${code}` : `signal ${signal ?? "unknown"}`;
			this.setExitNotice(reason);
			this.options.tui.requestRender();
		});
	}

	private stopScriptProcess(): void {
		const activeProcess = this.process;
		this.process = null;
		if (!activeProcess) {
			return;
		}

		if (activeProcess.pid !== undefined) {
			this.expectedExitPids.add(activeProcess.pid);
		}

		try {
			if (activeProcess.stdin && activeProcess.stdin.writable) {
				activeProcess.stdin.write("q");
			}
		} catch {
			// Best effort.
		}

		setTimeout(() => {
			if (!activeProcess.killed) {
				activeProcess.kill("SIGTERM");
			}
		}, 100);
	}
}

function resolveScriptStdin(): "pipe" | number {
	try {
		return openSync("/dev/null", fsConstants.O_RDONLY);
	} catch {
		return "pipe";
	}
}

function createWeatherEnv(configHome: string): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		XDG_CONFIG_HOME: configHome,
	};
	if ("NO_COLOR" in env) {
		delete env.NO_COLOR;
	}
	if (!env.COLORTERM || env.COLORTERM.length === 0) {
		env.COLORTERM = "truecolor";
	}
	if (!env.TERM || env.TERM.length === 0) {
		env.TERM = "xterm-256color";
	}
	return env;
}

function shellQuote(value: string): string {
	return `'${value.split("'").join(`'"'"'`)}'`;
}

async function ensureWeatherConfig(configHome: string): Promise<string> {
	const configDir = path.join(configHome, "weathr");
	const configPath = path.join(configDir, "config.toml");

	try {
		await fs.access(configPath, fsConstants.F_OK);
		return configPath;
	} catch {
		await fs.mkdir(configDir, { recursive: true });
		await fs.writeFile(configPath, DEFAULT_WEATHER_CONFIG, "utf8");
		return configPath;
	}
}

async function isExecutable(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath, fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function collectPathExecutables(binaryName: string): string[] {
	const pathValue = process.env.PATH;
	if (!pathValue) {
		return [];
	}

	const pathEntries = pathValue
		.split(path.delimiter)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);

	return pathEntries.map((entry) => path.join(entry, binaryName));
}

async function resolveExecutable(binaryName: string, extraCandidates: string[]): Promise<string | null> {
	const candidates = [...collectPathExecutables(binaryName), ...extraCandidates];
	for (const candidate of candidates) {
		if (candidate.length === 0) continue;
		if (await isExecutable(candidate)) {
			return candidate;
		}
	}
	return null;
}

interface WeatherConfigSummary {
	auto: boolean | null;
	latitude: number | null;
	longitude: number | null;
}

function summarizeWeatherConfig(configText: string): WeatherConfigSummary {
	let inLocationSection = false;
	let auto: boolean | null = null;
	let latitude: number | null = null;
	let longitude: number | null = null;

	for (const rawLine of configText.split(/\r?\n/u)) {
		const lineWithoutComment = rawLine.split("#")[0];
		if (!lineWithoutComment) {
			continue;
		}

		const line = lineWithoutComment.trim();
		if (line.length === 0) {
			continue;
		}

		if (line.startsWith("[") && line.endsWith("]")) {
			inLocationSection = line === "[location]";
			continue;
		}

		if (!inLocationSection) {
			continue;
		}

		const separatorIndex = line.indexOf("=");
		if (separatorIndex < 0) {
			continue;
		}

		const key = line.slice(0, separatorIndex).trim();
		const rawValue = line.slice(separatorIndex + 1).trim();

		switch (key) {
			case "auto": {
				if (rawValue === "true") {
					auto = true;
				} else if (rawValue === "false") {
					auto = false;
				}
				break;
			}
			case "latitude": {
				const parsed = Number.parseFloat(rawValue);
				if (!Number.isNaN(parsed)) {
					latitude = parsed;
				}
				break;
			}
			case "longitude": {
				const parsed = Number.parseFloat(rawValue);
				if (!Number.isNaN(parsed)) {
					longitude = parsed;
				}
				break;
			}
			default:
				break;
		}
	}

	return {
		auto,
		latitude,
		longitude,
	};
}

function parseWeatherArgs(rawArgs: string | undefined): ParsedWeatherArgs {
	const trimmed = rawArgs?.trim();
	if (!trimmed || trimmed.length === 0) {
		return { forwardedArgs: [], ignoredTokens: [] };
	}

	const tokens = trimmed
		.split(/\s+/u)
		.map((token) => token.trim().toLowerCase())
		.filter((token) => token.length > 0);

	if (tokens.length === 1) {
		const onlyToken = tokens[0];
		if (onlyToken && WEATHER_SIMULATION_CONDITIONS.has(onlyToken)) {
			return {
				forwardedArgs: ["--simulate", onlyToken],
				ignoredTokens: [],
			};
		}
	}

	const forwardedArgs: string[] = [];
	const ignoredTokens: string[] = [];

	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (!token) continue;

		if (WEATHER_SIMULATION_CONDITIONS.has(token)) {
			forwardedArgs.push("--simulate", token);
			continue;
		}

		switch (token) {
			case "simulate":
			case "--simulate": {
				const condition = tokens[index + 1];
				if (condition && WEATHER_SIMULATION_CONDITIONS.has(condition)) {
					forwardedArgs.push("--simulate", condition);
					index += 1;
				} else {
					ignoredTokens.push(token);
				}
				break;
			}
			case "night":
			case "--night":
				forwardedArgs.push("--night");
				break;
			case "leaves":
			case "--leaves":
				forwardedArgs.push("--leaves");
				break;
			case "auto-location":
			case "--auto-location":
				forwardedArgs.push("--auto-location");
				break;
			case "hide-location":
			case "--hide-location":
				forwardedArgs.push("--hide-location");
				break;
			case "hide-hud":
			case "--hide-hud":
				forwardedArgs.push("--hide-hud");
				break;
			case "imperial":
			case "--imperial":
				forwardedArgs.push("--imperial");
				break;
			case "metric":
			case "--metric":
				forwardedArgs.push("--metric");
				break;
			default:
				ignoredTokens.push(token);
				break;
		}
	}

	return { forwardedArgs, ignoredTokens };
}

async function openWeatherWidget(args: string | undefined, ctx: ExtensionCommandContext): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("/weather requires interactive mode", "error");
		return;
	}

	const scriptPath = await resolveExecutable("script", ["/usr/bin/script"]);
	if (!scriptPath) {
		ctx.ui.notify("Missing `script` command. Install util-linux (Linux) or use macOS default.", "error");
		return;
	}

	const weathrPath = await resolveExecutable("weathr", [
		path.join(os.homedir(), ".cargo", "bin", "weathr"),
		"/opt/homebrew/bin/weathr",
		"/usr/local/bin/weathr",
	]);
	if (!weathrPath) {
		ctx.ui.notify("`weathr` is not installed. Run: cargo install weathr", "error");
		return;
	}

	try {
		await ensureWeatherConfig(WEATHER_CONFIG_HOME);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`Failed to create weather config: ${message}`, "error");
		return;
	}

	const parsed = parseWeatherArgs(args);
	if (parsed.ignoredTokens.length > 0) {
		ctx.ui.notify(`Ignored args: ${parsed.ignoredTokens.join(", ")}`, "warning");
	}

	ctx.ui.setStatus(WEATHER_STATUS_KEY, "ESC/Q close • R restart");

	let component: WeatherWidgetComponent | null = null;
	try {
		await ctx.ui.custom((tui, _theme, _keybindings, done) => {
			component = new WeatherWidgetComponent({
				tui,
				onClose: () => done(undefined),
				scriptPath,
				weathrPath,
				weathrArgs: parsed.forwardedArgs,
				configHome: WEATHER_CONFIG_HOME,
				columns: WEATHER_COLUMNS,
				rows: WEATHER_ROWS,
			});
			return component;
		});
	} finally {
		component?.dispose();
		ctx.ui.setStatus(WEATHER_STATUS_KEY, undefined);
	}
}

async function editWeatherConfig(ctx: ExtensionCommandContext): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("/weather-config requires interactive mode", "error");
		return;
	}

	const configPath = await ensureWeatherConfig(WEATHER_CONFIG_HOME);
	let currentConfig = DEFAULT_WEATHER_CONFIG;
	try {
		currentConfig = await fs.readFile(configPath, "utf8");
	} catch {
		currentConfig = DEFAULT_WEATHER_CONFIG;
	}

	const edited = await ctx.ui.editor("weathr config.toml", currentConfig);
	if (edited === undefined) {
		return;
	}

	await fs.writeFile(configPath, edited, "utf8");
	ctx.ui.notify(`Saved ${configPath}`, "info");

	const summary = summarizeWeatherConfig(edited);
	if (summary.auto === true && summary.latitude !== null && summary.longitude !== null) {
		ctx.ui.notify(
			"location.auto=true overrides latitude/longitude. Set auto=false to use your coordinates.",
			"warning",
		);
	}
}

export default function weatherExtension(pi: ExtensionAPI): void {
	pi.registerCommand("weather", {
		description: "Open live weather widget (Esc/Q close, R restart)",
		handler: async (args, ctx) => {
			await openWeatherWidget(args, ctx);
		},
	});

	pi.registerCommand("weather-config", {
		description: "Edit weather widget config.toml",
		handler: async (_args, ctx) => {
			await editWeatherConfig(ctx);
		},
	});
}
