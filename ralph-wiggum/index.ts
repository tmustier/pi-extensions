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
import { Type } from "@sinclair/typebox";

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
	itemsPerIteration: number; // How many items to process per iteration (0 = no limit)
	reflectEveryItems: number; // Reflect every N items (not iterations)
	itemsProcessed: number; // Total items processed so far
	reflectInstructions: string;
	active: boolean;
	startedAt: string;
	lastReflectionAtItems: number;
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
		const itemsStr = state.itemsPerIteration > 0 ? ` | ${state.itemsProcessed} items` : "";
		ctx.ui.setStatus("ralph", ctx.ui.theme.fg("accent", `🔄 ${state.name} (${state.iteration}${maxStr}${itemsStr})`));

		const lines: string[] = [
			ctx.ui.theme.fg("accent", ctx.ui.theme.bold("Ralph Wiggum")),
			ctx.ui.theme.fg("muted", `Loop: ${state.name}`),
			ctx.ui.theme.fg("dim", `Iteration: ${state.iteration}${maxStr}`),
			ctx.ui.theme.fg("dim", `Task: ${state.taskFile}`),
		];
		if (state.itemsPerIteration > 0) {
			lines.push(ctx.ui.theme.fg("dim", `Items processed: ${state.itemsProcessed}`));
		}
		if (state.reflectEveryItems > 0) {
			const nextReflect = state.reflectEveryItems - (state.itemsProcessed % state.reflectEveryItems);
			lines.push(ctx.ui.theme.fg("dim", `Next reflection in: ${nextReflect} items`));
		}
		ctx.ui.setWidget("ralph", lines);
	}

	function buildPrompt(state: LoopState, taskContent: string, isReflection: boolean): string {
		const maxStr = state.maxIterations > 0 ? `/${state.maxIterations}` : "";
		const itemsStr = state.itemsPerIteration > 0 ? ` | Items: ${state.itemsProcessed}` : "";
		let prompt = `───────────────────────────────────────────────────────────────────────
🔄 RALPH LOOP: ${state.name} | Iteration ${state.iteration}${maxStr}${itemsStr}${isReflection ? " | 🪞 REFLECTION" : ""}
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

		if (state.itemsPerIteration > 0) {
			const startItem = state.itemsProcessed + 1;
			const endItem = state.itemsProcessed + state.itemsPerIteration;
			prompt += `**THIS ITERATION: Process items ${startItem}-${endItem} only, then STOP.**\n\n`;
			prompt += `1. Process the next ${state.itemsPerIteration} items from your checklist\n`;
			prompt += `2. Update the task file (${state.taskFile}) with your progress\n`;
			prompt += `3. After completing ${state.itemsPerIteration} items, STOP and wait for the next iteration\n`;
			prompt += `4. If ALL items are done before reaching ${state.itemsPerIteration}, respond with: ${COMPLETE_MARKER}\n`;
		} else {
			prompt += `1. Read the task file above and continue working on it\n`;
			prompt += `2. Update the task file (${state.taskFile}) as you make progress\n`;
			prompt += `3. When the task is FULLY COMPLETE, respond with: ${COMPLETE_MARKER}\n`;
			prompt += `4. Do NOT output ${COMPLETE_MARKER} unless the task is genuinely done\n`;
		}

		return prompt;
	}

	function parseArgs(argsStr: string): {
		name: string;
		maxIterations: number;
		itemsPerIteration: number;
		reflectEveryItems: number;
		reflectInstructions: string;
	} {
		const args = argsStr.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
		let name = "";
		let maxIterations = 0;
		let itemsPerIteration = 0;
		let reflectEveryItems = 0;
		let reflectInstructions = DEFAULT_REFLECT_INSTRUCTIONS;

		let i = 0;
		while (i < args.length) {
			const arg = args[i];
			if (arg === "--max-iterations" && i + 1 < args.length) {
				maxIterations = parseInt(args[i + 1], 10) || 0;
				i += 2;
			} else if (arg === "--items-per-iteration" && i + 1 < args.length) {
				itemsPerIteration = parseInt(args[i + 1], 10) || 0;
				i += 2;
			} else if (arg === "--reflect-every" && i + 1 < args.length) {
				reflectEveryItems = parseInt(args[i + 1], 10) || 0;
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

		return { name, maxIterations, itemsPerIteration, reflectEveryItems, reflectInstructions };
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
						ctx.ui.notify(
							"Usage: /ralph start <name|path> [--items-per-iteration N] [--reflect-every N] [--max-iterations N]",
							"warning",
						);
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
						itemsPerIteration: parsed.itemsPerIteration,
						reflectEveryItems: parsed.reflectEveryItems,
						itemsProcessed: existingState?.itemsProcessed || 0,
						reflectInstructions: parsed.reflectInstructions,
						active: true,
						startedAt: existingState?.startedAt || new Date().toISOString(),
						lastReflectionAtItems: existingState?.lastReflectionAtItems || 0,
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

					const itemsStr = state.itemsPerIteration > 0 ? `, ${state.itemsProcessed} items` : "";
					ctx.ui.notify(`Resumed Ralph loop: ${loopName} (iteration ${state.iteration}${itemsStr})`, "info");

					const taskContent = readTaskFile(ctx, state.taskFile);
					if (!taskContent) {
						ctx.ui.notify(`Could not read task file: ${state.taskFile}`, "error");
						return;
					}

					const isReflection =
						state.reflectEveryItems > 0 &&
						state.itemsProcessed > 0 &&
						state.itemsProcessed - state.lastReflectionAtItems >= state.reflectEveryItems;
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
						const itemsStr = l.itemsPerIteration > 0 ? `, ${l.itemsProcessed} items` : "";
						return `${l.name}: ${status} (iteration ${l.iteration}${maxStr}${itemsStr})`;
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
  --items-per-iteration N  Process N items per iteration (default: unlimited)
  --reflect-every N        Reflect every N items (not iterations)
  --max-iterations N       Stop after N iterations (default: unlimited)
  --reflect-instructions   Custom reflection prompt

Examples:
  /ralph start my-feature
  /ralph start review --items-per-iteration 5 --reflect-every 50
  /ralph start ./tasks.md --max-iterations 100`,
						"info",
					);
			}
		},
	});

	// Tool for agent to start a loop
	pi.registerTool({
		name: "ralph_start",
		label: "Start Ralph Loop",
		description:
			"Start a long-running development loop on yourself. Use this when you have a complex task that requires multiple iterations. Write the task content, then this tool will set up the loop and you'll work through it iteratively.",
		parameters: Type.Object({
			name: Type.String({ description: "Loop name (e.g., 'refactor-auth', 'add-tests')" }),
			taskContent: Type.String({
				description: "The task description in markdown format. Include goals, checklist, and any relevant context.",
			}),
			itemsPerIteration: Type.Optional(
				Type.Number({ description: "Process N items per iteration (default: 0 = no limit)" }),
			),
			reflectEveryItems: Type.Optional(
				Type.Number({ description: "Reflect every N items (default: 0 = no reflection)" }),
			),
			maxIterations: Type.Optional(
				Type.Number({ description: "Maximum iterations before stopping (default: 50)", default: 50 }),
			),
		}),
		async execute(_toolCallId, params, _onUpdate, ctx) {
			const loopName = sanitizeName(params.name);
			const taskFile = path.join(RALPH_DIR, `${loopName}.md`);

			const existingState = loadState(ctx, loopName);
			if (existingState?.active) {
				return {
					content: [{ type: "text", text: `Loop "${loopName}" is already active. Complete it first or cancel it.` }],
					details: {},
				};
			}

			// Create task file with provided content
			const fullTaskPath = path.resolve(ctx.cwd, taskFile);
			const dir = path.dirname(fullTaskPath);
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(fullTaskPath, params.taskContent, "utf-8");

			const state: LoopState = {
				name: loopName,
				taskFile,
				iteration: 1,
				maxIterations: params.maxIterations ?? 50,
				itemsPerIteration: params.itemsPerIteration ?? 0,
				reflectEveryItems: params.reflectEveryItems ?? 0,
				itemsProcessed: 0,
				reflectInstructions: DEFAULT_REFLECT_INSTRUCTIONS,
				active: true,
				startedAt: new Date().toISOString(),
				lastReflectionAtItems: 0,
			};

			saveState(ctx, state);
			runtime.currentLoop = loopName;
			updateStatus(ctx);

			// Queue the first iteration prompt using buildPrompt for consistency
			// Use followUp since agent is still processing the tool call
			pi.sendUserMessage(buildPrompt(state, params.taskContent, false), { deliverAs: "followUp" });

			return {
				content: [
					{
						type: "text",
						text: `Started Ralph loop "${loopName}" with max ${state.maxIterations} iterations. The loop will begin on the next turn.`,
					},
				],
				details: {},
			};
		},
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		if (!runtime.currentLoop) return;
		const state = loadState(ctx, runtime.currentLoop);
		if (!state?.active) return;

		const iterStr = `${state.iteration}${state.maxIterations > 0 ? `/${state.maxIterations}` : ""}`;
		const itemsStr = state.itemsPerIteration > 0 ? ` | ${state.itemsProcessed} items done` : "";

		let instructions = `You are in a Ralph loop working on: ${state.taskFile}\n`;
		if (state.itemsPerIteration > 0) {
			instructions += `- Process ${state.itemsPerIteration} items this iteration, then STOP\n`;
		}
		instructions += `- Update the task file as you make progress\n`;
		instructions += `- When FULLY COMPLETE, respond with: ${COMPLETE_MARKER}\n`;
		instructions += `- Do NOT output the completion marker unless genuinely done`;

		return {
			systemPromptAppend: `
[RALPH WIGGUM LOOP - ${state.name} - Iteration ${iterStr}${itemsStr}]

${instructions}`,
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
		// Track items processed
		if (state.itemsPerIteration > 0) {
			state.itemsProcessed += state.itemsPerIteration;
		}
		// Check if reflection is due (based on items, not iterations)
		const isReflection =
			state.reflectEveryItems > 0 &&
			state.itemsProcessed > 0 &&
			state.itemsProcessed - state.lastReflectionAtItems >= state.reflectEveryItems;
		if (isReflection) state.lastReflectionAtItems = state.itemsProcessed;
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

	// Keyboard shortcut to stop loop (works during streaming)
	pi.registerShortcut("ctrl+shift+r", {
		description: "Stop Ralph loop",
		handler: async (ctx) => {
			if (!runtime.currentLoop) {
				ctx.ui.notify("No active Ralph loop", "warning");
				return;
			}
			const state = loadState(ctx, runtime.currentLoop);
			if (state) {
				state.active = false;
				saveState(ctx, state);
			}
			const loopName = runtime.currentLoop;
			runtime.currentLoop = null;
			updateStatus(ctx);
			ctx.abort(); // Stop the current agent turn
			ctx.ui.notify(`Stopped Ralph loop: ${loopName}`, "info");
		},
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
