/**
 * Ralph Wiggum Extension
 *
 * Long-running agent loop for iterative development.
 * A Pi port of Geoffrey Huntley's Ralph Wiggum approach.
 *
 * The loop:
 * 1. Read a task file (markdown, json, whatever)
 * 2. Send it to the agent with instructions
 * 3. Agent works, updates the file as needed
 * 4. Agent says <promise>COMPLETE</promise> when done
 * 5. Repeat until complete or max iterations
 *
 * Usage:
 *   /ralph start my-feature                    # Creates .ralph/my-feature.md
 *   /ralph start ./path/to/tasks.md            # Uses existing file
 *   /ralph start my-feature --max-iterations 50 --reflect-every 10
 *   /ralph stop                                # Pause current loop
 *   /ralph resume my-feature                   # Resume a paused loop
 *   /ralph status                              # Show all loops
 *   /ralph cancel my-feature                   # Delete loop entirely
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const RALPH_DIR = ".ralph";
const COMPLETE_MARKER = "<promise>COMPLETE</promise>";

const DEFAULT_TEMPLATE = `# Task

Describe your task here.

## Goals
- Goal 1
- Goal 2

## Checklist
- [ ] Item 1
- [ ] Item 2

## Notes
(Update this as you work)
`;

const DEFAULT_REFLECT_INSTRUCTIONS = `REFLECTION CHECKPOINT

Pause and reflect on your progress:
1. What has been accomplished so far?
2. What's working well?
3. What's not working or blocking progress?
4. Should the approach be adjusted?
5. What are the next priorities?

Update the task file with your reflection, then continue working.`;

interface LoopState {
	name: string;
	taskFile: string;
	iteration: number;
	maxIterations: number;
	reflectEvery: number;
	reflectInstructions: string;
	active: boolean;
	startedAt: string;
	lastReflection: number;
}

interface RuntimeState {
	currentLoop: string | null;
}

export default function (pi: ExtensionAPI) {
	const runtime: RuntimeState = {
		currentLoop: null,
	};

	function getRalphDir(ctx: ExtensionContext): string {
		return path.resolve(ctx.cwd, RALPH_DIR);
	}

	function sanitizeName(name: string): string {
		return name.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_");
	}

	function getStateFile(ctx: ExtensionContext, name: string): string {
		return path.join(getRalphDir(ctx), `${sanitizeName(name)}.state.json`);
	}

	function loadState(ctx: ExtensionContext, name: string): LoopState | null {
		const stateFile = getStateFile(ctx, name);
		try {
			if (fs.existsSync(stateFile)) {
				return JSON.parse(fs.readFileSync(stateFile, "utf-8"));
			}
		} catch {
			// Ignore
		}
		return null;
	}

	function saveState(ctx: ExtensionContext, state: LoopState): void {
		const ralphDir = getRalphDir(ctx);
		if (!fs.existsSync(ralphDir)) {
			fs.mkdirSync(ralphDir, { recursive: true });
		}
		fs.writeFileSync(getStateFile(ctx, state.name), JSON.stringify(state, null, 2), "utf-8");
	}

	function deleteState(ctx: ExtensionContext, name: string): void {
		try {
			const stateFile = getStateFile(ctx, name);
			if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
		} catch {
			// Ignore
		}
	}

	function listLoops(ctx: ExtensionContext): LoopState[] {
		const ralphDir = getRalphDir(ctx);
		const loops: LoopState[] = [];
		try {
			if (fs.existsSync(ralphDir)) {
				for (const file of fs.readdirSync(ralphDir)) {
					if (file.endsWith(".state.json")) {
						loops.push(JSON.parse(fs.readFileSync(path.join(ralphDir, file), "utf-8")));
					}
				}
			}
		} catch {
			// Ignore
		}
		return loops;
	}

	function readTaskFile(ctx: ExtensionContext, taskFile: string): string | null {
		try {
			return fs.readFileSync(path.resolve(ctx.cwd, taskFile), "utf-8");
		} catch {
			return null;
		}
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;

		if (!runtime.currentLoop) {
			ctx.ui.setStatus("ralph", undefined);
			ctx.ui.setWidget("ralph", undefined);
			return;
		}

		const state = loadState(ctx, runtime.currentLoop);
		if (!state) {
			ctx.ui.setStatus("ralph", undefined);
			ctx.ui.setWidget("ralph", undefined);
			return;
		}

		const maxStr = state.maxIterations > 0 ? `/${state.maxIterations}` : "";
		ctx.ui.setStatus("ralph", ctx.ui.theme.fg("accent", `🔄 ${state.name} (${state.iteration}${maxStr})`));

		const lines: string[] = [
			ctx.ui.theme.fg("accent", ctx.ui.theme.bold("Ralph Wiggum")),
			ctx.ui.theme.fg("muted", `Loop: ${state.name}`),
			ctx.ui.theme.fg("dim", `Iteration: ${state.iteration}${maxStr}`),
			ctx.ui.theme.fg("dim", `Task: ${state.taskFile}`),
		];
		if (state.reflectEvery > 0) {
			const nextReflect = state.reflectEvery - (state.iteration % state.reflectEvery);
			lines.push(ctx.ui.theme.fg("dim", `Next reflection in: ${nextReflect} iterations`));
		}
		ctx.ui.setWidget("ralph", lines);
	}

	function buildPrompt(state: LoopState, taskContent: string, isReflection: boolean): string {
		const maxStr = state.maxIterations > 0 ? `/${state.maxIterations}` : "";
		let prompt = `───────────────────────────────────────────────────────────────────────
🔄 RALPH LOOP: ${state.name} | Iteration ${state.iteration}${maxStr}${isReflection ? " | 🪞 REFLECTION" : ""}
───────────────────────────────────────────────────────────────────────

`;

		if (isReflection) {
			prompt += `${state.reflectInstructions}\n\n---\n\n`;
		}

		prompt += `## Current Task (from ${state.taskFile})\n\n${taskContent}\n\n---\n\n`;
		prompt += `## Instructions\n\n`;
		prompt += `You are in a Ralph loop (iteration ${state.iteration}`;
		if (state.maxIterations > 0) prompt += ` of ${state.maxIterations}`;
		prompt += `).\n\n`;
		prompt += `1. Read the task file above and continue working on it\n`;
		prompt += `2. Update the task file (${state.taskFile}) as you make progress\n`;
		prompt += `3. When the task is FULLY COMPLETE, respond with: ${COMPLETE_MARKER}\n`;
		prompt += `4. Do NOT output ${COMPLETE_MARKER} unless the task is genuinely done\n`;

		return prompt;
	}

	function parseArgs(argsStr: string): {
		name: string;
		maxIterations: number;
		reflectEvery: number;
		reflectInstructions: string;
	} {
		const args = argsStr.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
		let name = "";
		let maxIterations = 0;
		let reflectEvery = 0;
		let reflectInstructions = DEFAULT_REFLECT_INSTRUCTIONS;

		let i = 0;
		while (i < args.length) {
			const arg = args[i];
			if (arg === "--max-iterations" && i + 1 < args.length) {
				maxIterations = parseInt(args[i + 1], 10) || 0;
				i += 2;
			} else if (arg === "--reflect-every" && i + 1 < args.length) {
				reflectEvery = parseInt(args[i + 1], 10) || 0;
				i += 2;
			} else if (arg === "--reflect-instructions" && i + 1 < args.length) {
				reflectInstructions = args[i + 1].replace(/^"|"$/g, "");
				i += 2;
			} else if (!arg.startsWith("--")) {
				name = arg;
				i++;
			} else {
				i++;
			}
		}

		return { name, maxIterations, reflectEvery, reflectInstructions };
	}

	pi.registerCommand("ralph", {
		description: "Ralph Wiggum - long-running development loops",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/);
			const subcommand = parts[0];
			const rest = args.slice(subcommand.length).trim();

			switch (subcommand) {
				case "start": {
					const parsed = parseArgs(rest);
					if (!parsed.name) {
						ctx.ui.notify("Usage: /ralph start <name|path> [--max-iterations N] [--reflect-every N]", "warning");
						return;
					}

					const isPath = parsed.name.includes("/") || parsed.name.includes("\\");
					let taskFile: string;
					let loopName: string;

					if (isPath) {
						taskFile = parsed.name;
						loopName = sanitizeName(path.basename(parsed.name, path.extname(parsed.name)));
					} else {
						loopName = parsed.name;
						taskFile = path.join(RALPH_DIR, `${loopName}.md`);
					}

					const existingState = loadState(ctx, loopName);
					if (existingState?.active) {
						ctx.ui.notify(`Loop "${loopName}" is already active. Use /ralph resume ${loopName}`, "warning");
						return;
					}

					const fullTaskPath = path.resolve(ctx.cwd, taskFile);
					if (!fs.existsSync(fullTaskPath)) {
						const dir = path.dirname(fullTaskPath);
						if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
						fs.writeFileSync(fullTaskPath, DEFAULT_TEMPLATE, "utf-8");
						ctx.ui.notify(`Created task file: ${taskFile}`, "info");
					}

					const state: LoopState = {
						name: loopName,
						taskFile,
						iteration: existingState?.iteration || 0,
						maxIterations: parsed.maxIterations,
						reflectEvery: parsed.reflectEvery,
						reflectInstructions: parsed.reflectInstructions,
						active: true,
						startedAt: existingState?.startedAt || new Date().toISOString(),
						lastReflection: existingState?.lastReflection || 0,
					};

					saveState(ctx, state);
					runtime.currentLoop = loopName;
					updateStatus(ctx);

					const taskContent = readTaskFile(ctx, taskFile);
					if (!taskContent) {
						ctx.ui.notify(`Could not read task file: ${taskFile}`, "error");
						return;
					}

					state.iteration = 1;
					saveState(ctx, state);
					pi.sendUserMessage(buildPrompt(state, taskContent, false));
					break;
				}

				case "stop": {
					if (!runtime.currentLoop) {
						ctx.ui.notify("No active Ralph loop", "warning");
						return;
					}
					const state = loadState(ctx, runtime.currentLoop);
					if (state) {
						state.active = false;
						saveState(ctx, state);
					}
					ctx.ui.notify(`Paused Ralph loop: ${runtime.currentLoop} (iteration ${state?.iteration || 0})`, "info");
					runtime.currentLoop = null;
					updateStatus(ctx);
					break;
				}

				case "resume": {
					const loopName = rest.trim();
					if (!loopName) {
						ctx.ui.notify("Usage: /ralph resume <name>", "warning");
						return;
					}

					const state = loadState(ctx, loopName);
					if (!state) {
						ctx.ui.notify(`Loop "${loopName}" not found`, "error");
						return;
					}

					if (runtime.currentLoop && runtime.currentLoop !== loopName) {
						const currentState = loadState(ctx, runtime.currentLoop);
						if (currentState) {
							currentState.active = false;
							saveState(ctx, currentState);
						}
					}

					state.active = true;
					state.iteration++;
					saveState(ctx, state);
					runtime.currentLoop = loopName;
					updateStatus(ctx);

					ctx.ui.notify(`Resumed Ralph loop: ${loopName} (iteration ${state.iteration})`, "info");

					const taskContent = readTaskFile(ctx, state.taskFile);
					if (!taskContent) {
						ctx.ui.notify(`Could not read task file: ${state.taskFile}`, "error");
						return;
					}

					const isReflection = state.reflectEvery > 0 && state.iteration % state.reflectEvery === 0;
					pi.sendUserMessage(buildPrompt(state, taskContent, isReflection));
					break;
				}

				case "status": {
					const loops = listLoops(ctx);
					if (loops.length === 0) {
						ctx.ui.notify("No Ralph loops found", "info");
						return;
					}
					const lines = loops.map((l) => {
						const status = l.active ? "▶ active" : "⏸ paused";
						const maxStr = l.maxIterations > 0 ? `/${l.maxIterations}` : "";
						return `${l.name}: ${status} (iteration ${l.iteration}${maxStr})`;
					});
					ctx.ui.notify(`Ralph loops:\n${lines.join("\n")}`, "info");
					break;
				}

				case "cancel": {
					const loopName = rest.trim();
					if (!loopName) {
						ctx.ui.notify("Usage: /ralph cancel <name>", "warning");
						return;
					}
					const state = loadState(ctx, loopName);
					if (!state) {
						ctx.ui.notify(`Loop "${loopName}" not found`, "error");
						return;
					}
					if (runtime.currentLoop === loopName) runtime.currentLoop = null;
					deleteState(ctx, loopName);
					ctx.ui.notify(`Cancelled Ralph loop: ${loopName}`, "info");
					updateStatus(ctx);
					break;
				}

				default:
					ctx.ui.notify(
						`Ralph Wiggum - Long-running development loops

Commands:
  /ralph start <name|path> [options]  Start a new loop
  /ralph stop                         Pause current loop
  /ralph resume <name>                Resume a paused loop
  /ralph status                       Show all loops
  /ralph cancel <name>                Delete a loop

Options for start:
  --max-iterations N      Stop after N iterations (default: unlimited)
  --reflect-every N       Reflection checkpoint every N iterations
  --reflect-instructions  Custom reflection prompt

Examples:
  /ralph start my-feature
  /ralph start ./tasks.md --max-iterations 50
  /ralph start refactor --reflect-every 10`,
						"info",
					);
			}
		},
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		if (!runtime.currentLoop) return;
		const state = loadState(ctx, runtime.currentLoop);
		if (!state?.active) return;

		return {
			systemPromptAppend: `
[RALPH WIGGUM LOOP - ${state.name} - Iteration ${state.iteration}${state.maxIterations > 0 ? `/${state.maxIterations}` : ""}]

You are in a Ralph loop working on: ${state.taskFile}
- Update the task file as you make progress
- When FULLY COMPLETE, respond with: ${COMPLETE_MARKER}
- Do NOT output the completion marker unless genuinely done`,
		};
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!runtime.currentLoop) return;

		const state = loadState(ctx, runtime.currentLoop);
		if (!state?.active) return;

		const lastAssistant = [...event.messages].reverse().find((m) => m.role === "assistant");
		let hasCompleteMarker = false;
		if (lastAssistant && Array.isArray(lastAssistant.content)) {
			const text = lastAssistant.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n");
			hasCompleteMarker = text.includes(COMPLETE_MARKER);
		}

		if (hasCompleteMarker) {
			state.active = false;
			saveState(ctx, state);
			runtime.currentLoop = null;
			updateStatus(ctx);
			pi.sendUserMessage(`───────────────────────────────────────────────────────────────────────
✅ RALPH LOOP COMPLETE: ${state.name} | ${state.iteration} iterations
───────────────────────────────────────────────────────────────────────`);
			return;
		}

		if (state.maxIterations > 0 && state.iteration >= state.maxIterations) {
			state.active = false;
			saveState(ctx, state);
			runtime.currentLoop = null;
			updateStatus(ctx);
			pi.sendUserMessage(`───────────────────────────────────────────────────────────────────────
⚠️ RALPH LOOP STOPPED: ${state.name} | Max iterations (${state.maxIterations}) reached
───────────────────────────────────────────────────────────────────────`);
			return;
		}

		state.iteration++;
		const isReflection = state.reflectEvery > 0 && state.iteration % state.reflectEvery === 0;
		if (isReflection) state.lastReflection = state.iteration;
		saveState(ctx, state);
		updateStatus(ctx);

		const taskContent = readTaskFile(ctx, state.taskFile);
		if (!taskContent) {
			state.active = false;
			saveState(ctx, state);
			runtime.currentLoop = null;
			updateStatus(ctx);
			pi.sendUserMessage(`───────────────────────────────────────────────────────────────────────
❌ RALPH LOOP ERROR: ${state.name} | Could not read task file: ${state.taskFile}
───────────────────────────────────────────────────────────────────────`);
			return;
		}

		pi.sendUserMessage(buildPrompt(state, taskContent, isReflection));
	});

	pi.on("session_start", async (_event, ctx) => {
		const loops = listLoops(ctx);
		const activeLoops = loops.filter((l) => l.active);

		if (activeLoops.length > 0 && ctx.hasUI) {
			const lines = activeLoops.map((l) => {
				const maxStr = l.maxIterations > 0 ? `/${l.maxIterations}` : "";
				return `  • ${l.name} (iteration ${l.iteration}${maxStr})`;
			});
			ctx.ui.notify(
				`Active Ralph loops detected:\n${lines.join("\n")}\n\nUse /ralph resume <name> to continue`,
				"info",
			);
		}
		updateStatus(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (runtime.currentLoop) {
			const state = loadState(ctx, runtime.currentLoop);
			if (state) saveState(ctx, state);
		}
	});
}
