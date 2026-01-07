/**
 * Ralph Wiggum - Long-running agent loops for iterative development.
 * Port of Geoffrey Huntley's approach.
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

type LoopStatus = "active" | "paused" | "completed";

interface LoopState {
	name: string;
	taskFile: string;
	iteration: number;
	maxIterations: number;
	itemsPerIteration: number;
	reflectEveryItems: number;
	itemsProcessed: number;
	reflectInstructions: string;
	active: boolean; // Backwards compat, derived from status
	status: LoopStatus;
	startedAt: string;
	completedAt?: string;
	lastReflectionAtItems: number;
}

const STATUS_ICONS: Record<LoopStatus, string> = { active: "▶", paused: "⏸", completed: "✓" };

export default function (pi: ExtensionAPI) {
	let currentLoop: string | null = null;

	// --- File helpers ---

	const ralphDir = (ctx: ExtensionContext) => path.resolve(ctx.cwd, RALPH_DIR);
	const archiveDir = (ctx: ExtensionContext) => path.join(ralphDir(ctx), "archive");
	const sanitize = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_");

	function getPath(ctx: ExtensionContext, name: string, ext: string, archived = false): string {
		const dir = archived ? archiveDir(ctx) : ralphDir(ctx);
		return path.join(dir, `${sanitize(name)}${ext}`);
	}

	function ensureDir(filePath: string): void {
		const dir = path.dirname(filePath);
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	}

	function tryDelete(filePath: string): void {
		try {
			if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
		} catch {
			/* ignore */
		}
	}

	function tryRead(filePath: string): string | null {
		try {
			return fs.readFileSync(filePath, "utf-8");
		} catch {
			return null;
		}
	}

	// --- State management ---

	function migrateState(raw: Partial<LoopState> & { name: string }): LoopState {
		if (!raw.status) raw.status = raw.active ? "active" : "paused";
		raw.active = raw.status === "active";
		return raw as LoopState;
	}

	function loadState(ctx: ExtensionContext, name: string, archived = false): LoopState | null {
		const content = tryRead(getPath(ctx, name, ".state.json", archived));
		return content ? migrateState(JSON.parse(content)) : null;
	}

	function saveState(ctx: ExtensionContext, state: LoopState, archived = false): void {
		state.active = state.status === "active";
		const filePath = getPath(ctx, state.name, ".state.json", archived);
		ensureDir(filePath);
		fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
	}

	function listLoops(ctx: ExtensionContext, archived = false): LoopState[] {
		const dir = archived ? archiveDir(ctx) : ralphDir(ctx);
		if (!fs.existsSync(dir)) return [];
		return fs
			.readdirSync(dir)
			.filter((f) => f.endsWith(".state.json"))
			.map((f) => {
				const content = tryRead(path.join(dir, f));
				return content ? migrateState(JSON.parse(content)) : null;
			})
			.filter((s): s is LoopState => s !== null);
	}

	// --- Loop state transitions ---

	function setStatus(ctx: ExtensionContext, state: LoopState, status: LoopStatus): void {
		state.status = status;
		if (status === "completed") state.completedAt = new Date().toISOString();
		saveState(ctx, state);
	}

	function deactivateLoop(ctx: ExtensionContext): void {
		currentLoop = null;
		updateUI(ctx);
	}

	function pauseLoop(ctx: ExtensionContext, state: LoopState, message?: string): void {
		setStatus(ctx, state, "paused");
		deactivateLoop(ctx);
		if (message) ctx.ui.notify(message, "info");
	}

	function completeLoop(ctx: ExtensionContext, state: LoopState, banner: string): void {
		setStatus(ctx, state, "completed");
		deactivateLoop(ctx);
		pi.sendUserMessage(banner);
	}

	// --- UI ---

	function formatLoop(l: LoopState, showCompleted = false): string {
		const status = `${STATUS_ICONS[l.status]} ${l.status}`;
		const iter = l.maxIterations > 0 ? `${l.iteration}/${l.maxIterations}` : `${l.iteration}`;
		const items = l.itemsPerIteration > 0 ? `, ${l.itemsProcessed} items` : "";
		const completed =
			showCompleted && l.completedAt ? ` - completed ${new Date(l.completedAt).toLocaleDateString()}` : "";
		return `${l.name}: ${status} (iteration ${iter}${items})${completed}`;
	}

	function updateUI(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;

		const state = currentLoop ? loadState(ctx, currentLoop) : null;
		if (!state) {
			ctx.ui.setStatus("ralph", undefined);
			ctx.ui.setWidget("ralph", undefined);
			return;
		}

		const { theme } = ctx.ui;
		const maxStr = state.maxIterations > 0 ? `/${state.maxIterations}` : "";
		const itemsStr = state.itemsPerIteration > 0 ? ` | ${state.itemsProcessed} items` : "";

		ctx.ui.setStatus("ralph", theme.fg("accent", `🔄 ${state.name} (${state.iteration}${maxStr}${itemsStr})`));

		const lines = [
			theme.fg("accent", theme.bold("Ralph Wiggum")),
			theme.fg("muted", `Loop: ${state.name}`),
			theme.fg("dim", `Status: ${STATUS_ICONS[state.status]} ${state.status}`),
			theme.fg("dim", `Iteration: ${state.iteration}${maxStr}`),
			theme.fg("dim", `Task: ${state.taskFile}`),
		];
		if (state.itemsPerIteration > 0) {
			lines.push(theme.fg("dim", `Items processed: ${state.itemsProcessed}`));
		}
		if (state.reflectEveryItems > 0) {
			const next = state.reflectEveryItems - (state.itemsProcessed % state.reflectEveryItems);
			lines.push(theme.fg("dim", `Next reflection in: ${next} items`));
		}
		ctx.ui.setWidget("ralph", lines);
	}

	// --- Prompt building ---

	function buildPrompt(state: LoopState, taskContent: string, isReflection: boolean): string {
		const maxStr = state.maxIterations > 0 ? `/${state.maxIterations}` : "";
		const itemsStr = state.itemsPerIteration > 0 ? ` | Items: ${state.itemsProcessed}` : "";
		const header = `───────────────────────────────────────────────────────────────────────
🔄 RALPH LOOP: ${state.name} | Iteration ${state.iteration}${maxStr}${itemsStr}${isReflection ? " | 🪞 REFLECTION" : ""}
───────────────────────────────────────────────────────────────────────`;

		const parts = [header, ""];
		if (isReflection) parts.push(state.reflectInstructions, "\n---\n");

		parts.push(`## Current Task (from ${state.taskFile})\n\n${taskContent}\n\n---`);
		parts.push(`\n## Instructions\n`);
		parts.push(
			`You are in a Ralph loop (iteration ${state.iteration}${state.maxIterations > 0 ? ` of ${state.maxIterations}` : ""}).\n`,
		);

		if (state.itemsPerIteration > 0) {
			const start = state.itemsProcessed + 1;
			const end = state.itemsProcessed + state.itemsPerIteration;
			parts.push(`**THIS ITERATION: Process items ${start}-${end} only, then STOP.**\n`);
			parts.push(`1. Process the next ${state.itemsPerIteration} items from your checklist`);
			parts.push(`2. Update the task file (${state.taskFile}) with your progress`);
			parts.push(`3. After completing ${state.itemsPerIteration} items, STOP and wait for the next iteration`);
			parts.push(`4. If ALL items are done, respond with: ${COMPLETE_MARKER}`);
		} else {
			parts.push(`1. Read the task file above and continue working on it`);
			parts.push(`2. Update the task file (${state.taskFile}) as you make progress`);
			parts.push(`3. When the task is FULLY COMPLETE, respond with: ${COMPLETE_MARKER}`);
			parts.push(`4. Do NOT output ${COMPLETE_MARKER} unless the task is genuinely done`);
		}

		return parts.join("\n");
	}

	// --- Arg parsing ---

	function parseArgs(argsStr: string) {
		const tokens = argsStr.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
		const result = {
			name: "",
			maxIterations: 0,
			itemsPerIteration: 0,
			reflectEveryItems: 0,
			reflectInstructions: DEFAULT_REFLECT_INSTRUCTIONS,
		};

		for (let i = 0; i < tokens.length; i++) {
			const tok = tokens[i];
			const next = tokens[i + 1];
			if (tok === "--max-iterations" && next) {
				result.maxIterations = parseInt(next, 10) || 0;
				i++;
			} else if (tok === "--items-per-iteration" && next) {
				result.itemsPerIteration = parseInt(next, 10) || 0;
				i++;
			} else if (tok === "--reflect-every" && next) {
				result.reflectEveryItems = parseInt(next, 10) || 0;
				i++;
			} else if (tok === "--reflect-instructions" && next) {
				result.reflectInstructions = next.replace(/^"|"$/g, "");
				i++;
			} else if (!tok.startsWith("--")) {
				result.name = tok;
			}
		}
		return result;
	}

	// --- Commands ---

	const commands: Record<string, (rest: string, ctx: ExtensionContext) => void> = {
		start(rest, ctx) {
			const args = parseArgs(rest);
			if (!args.name) {
				ctx.ui.notify(
					"Usage: /ralph start <name|path> [--items-per-iteration N] [--reflect-every N] [--max-iterations N]",
					"warning",
				);
				return;
			}

			const isPath = args.name.includes("/") || args.name.includes("\\");
			const loopName = isPath ? sanitize(path.basename(args.name, path.extname(args.name))) : args.name;
			const taskFile = isPath ? args.name : path.join(RALPH_DIR, `${loopName}.md`);

			const existing = loadState(ctx, loopName);
			if (existing?.status === "active") {
				ctx.ui.notify(`Loop "${loopName}" is already active. Use /ralph resume ${loopName}`, "warning");
				return;
			}

			const fullPath = path.resolve(ctx.cwd, taskFile);
			if (!fs.existsSync(fullPath)) {
				ensureDir(fullPath);
				fs.writeFileSync(fullPath, DEFAULT_TEMPLATE, "utf-8");
				ctx.ui.notify(`Created task file: ${taskFile}`, "info");
			}

			const state: LoopState = {
				name: loopName,
				taskFile,
				iteration: 1,
				maxIterations: args.maxIterations,
				itemsPerIteration: args.itemsPerIteration,
				reflectEveryItems: args.reflectEveryItems,
				itemsProcessed: existing?.itemsProcessed || 0,
				reflectInstructions: args.reflectInstructions,
				active: true,
				status: "active",
				startedAt: existing?.startedAt || new Date().toISOString(),
				lastReflectionAtItems: existing?.lastReflectionAtItems || 0,
			};

			saveState(ctx, state);
			currentLoop = loopName;
			updateUI(ctx);

			const content = tryRead(fullPath);
			if (!content) {
				ctx.ui.notify(`Could not read task file: ${taskFile}`, "error");
				return;
			}
			pi.sendUserMessage(buildPrompt(state, content, false));
		},

		stop(_rest, ctx) {
			if (!currentLoop) {
				ctx.ui.notify("No active Ralph loop", "warning");
				return;
			}
			const state = loadState(ctx, currentLoop);
			if (state) {
				pauseLoop(ctx, state, `Paused Ralph loop: ${currentLoop} (iteration ${state.iteration})`);
			}
		},

		resume(rest, ctx) {
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
			if (state.status === "completed") {
				ctx.ui.notify(`Loop "${loopName}" is completed. Use /ralph start ${loopName} to restart`, "warning");
				return;
			}

			// Pause current loop if different
			if (currentLoop && currentLoop !== loopName) {
				const curr = loadState(ctx, currentLoop);
				if (curr) setStatus(ctx, curr, "paused");
			}

			state.status = "active";
			state.iteration++;
			saveState(ctx, state);
			currentLoop = loopName;
			updateUI(ctx);

			const itemsStr = state.itemsPerIteration > 0 ? `, ${state.itemsProcessed} items` : "";
			ctx.ui.notify(`Resumed: ${loopName} (iteration ${state.iteration}${itemsStr})`, "info");

			const content = tryRead(path.resolve(ctx.cwd, state.taskFile));
			if (!content) {
				ctx.ui.notify(`Could not read task file: ${state.taskFile}`, "error");
				return;
			}

			const needsReflection =
				state.reflectEveryItems > 0 &&
				state.itemsProcessed > 0 &&
				state.itemsProcessed - state.lastReflectionAtItems >= state.reflectEveryItems;
			pi.sendUserMessage(buildPrompt(state, content, needsReflection));
		},

		status(_rest, ctx) {
			const loops = listLoops(ctx);
			if (loops.length === 0) {
				ctx.ui.notify("No Ralph loops found. Use /ralph list --archived for archived.", "info");
				return;
			}
			ctx.ui.notify(`Ralph loops:\n${loops.map((l) => formatLoop(l)).join("\n")}`, "info");
		},

		cancel(rest, ctx) {
			const loopName = rest.trim();
			if (!loopName) {
				ctx.ui.notify("Usage: /ralph cancel <name>", "warning");
				return;
			}
			if (!loadState(ctx, loopName)) {
				ctx.ui.notify(`Loop "${loopName}" not found`, "error");
				return;
			}
			if (currentLoop === loopName) currentLoop = null;
			tryDelete(getPath(ctx, loopName, ".state.json"));
			ctx.ui.notify(`Cancelled: ${loopName}`, "info");
			updateUI(ctx);
		},

		archive(rest, ctx) {
			const loopName = rest.trim();
			if (!loopName) {
				ctx.ui.notify("Usage: /ralph archive <name>", "warning");
				return;
			}
			const state = loadState(ctx, loopName);
			if (!state) {
				ctx.ui.notify(`Loop "${loopName}" not found`, "error");
				return;
			}
			if (state.status === "active") {
				ctx.ui.notify(`Cannot archive active loop. Stop it first.`, "warning");
				return;
			}

			if (currentLoop === loopName) currentLoop = null;

			// Move files to archive
			const srcState = getPath(ctx, loopName, ".state.json");
			const dstState = getPath(ctx, loopName, ".state.json", true);
			ensureDir(dstState);
			if (fs.existsSync(srcState)) fs.renameSync(srcState, dstState);

			const srcTask = path.resolve(ctx.cwd, state.taskFile);
			if (srcTask.startsWith(ralphDir(ctx)) && !srcTask.startsWith(archiveDir(ctx))) {
				const dstTask = getPath(ctx, loopName, ".md", true);
				if (fs.existsSync(srcTask)) fs.renameSync(srcTask, dstTask);
			}

			ctx.ui.notify(`Archived: ${loopName}`, "info");
			updateUI(ctx);
		},

		clean(rest, ctx) {
			const all = rest.trim() === "--all";
			const completed = listLoops(ctx).filter((l) => l.status === "completed");

			if (completed.length === 0) {
				ctx.ui.notify("No completed loops to clean", "info");
				return;
			}

			for (const loop of completed) {
				tryDelete(getPath(ctx, loop.name, ".state.json"));
				if (all) tryDelete(getPath(ctx, loop.name, ".md"));
				if (currentLoop === loop.name) currentLoop = null;
			}

			const suffix = all ? " (all files)" : " (state only)";
			ctx.ui.notify(
				`Cleaned ${completed.length} loop(s)${suffix}:\n${completed.map((l) => `  • ${l.name}`).join("\n")}`,
				"info",
			);
			updateUI(ctx);
		},

		list(rest, ctx) {
			const archived = rest.trim() === "--archived";
			const loops = listLoops(ctx, archived);

			if (loops.length === 0) {
				ctx.ui.notify(
					archived ? "No archived loops" : "No loops found. Use /ralph list --archived for archived.",
					"info",
				);
				return;
			}

			const label = archived ? "Archived loops" : "Ralph loops";
			ctx.ui.notify(`${label}:\n${loops.map((l) => formatLoop(l, archived)).join("\n")}`, "info");
		},
	};

	const HELP = `Ralph Wiggum - Long-running development loops

Commands:
  /ralph start <name|path> [options]  Start a new loop
  /ralph stop                         Pause current loop
  /ralph resume <name>                Resume a paused loop
  /ralph status                       Show all loops
  /ralph cancel <name>                Delete loop state
  /ralph archive <name>               Move to archive
  /ralph clean [--all]                Clean completed loops
  /ralph list --archived              Show archived loops

Options:
  --items-per-iteration N  Process N items per turn
  --reflect-every N        Reflect every N items
  --max-iterations N       Stop after N iterations

To stop during streaming: type "stop"

Examples:
  /ralph start my-feature
  /ralph start review --items-per-iteration 5 --reflect-every 50`;

	pi.registerCommand("ralph", {
		description: "Ralph Wiggum - long-running development loops",
		handler: async (args, ctx) => {
			const [cmd, ...rest] = args.trim().split(/\s+/);
			const handler = commands[cmd];
			if (handler) {
				handler(args.slice(cmd.length).trim(), ctx);
			} else {
				ctx.ui.notify(HELP, "info");
			}
		},
	});

	// --- Tool for agent self-invocation ---

	pi.registerTool({
		name: "ralph_start",
		label: "Start Ralph Loop",
		description: "Start a long-running development loop. Use for complex multi-iteration tasks.",
		parameters: Type.Object({
			name: Type.String({ description: "Loop name (e.g., 'refactor-auth')" }),
			taskContent: Type.String({ description: "Task in markdown with goals and checklist" }),
			itemsPerIteration: Type.Optional(Type.Number({ description: "Items per iteration (0 = no limit)" })),
			reflectEveryItems: Type.Optional(Type.Number({ description: "Reflect every N items" })),
			maxIterations: Type.Optional(Type.Number({ description: "Max iterations (default: 50)", default: 50 })),
		}),
		async execute(_toolCallId, params, _onUpdate, ctx) {
			const loopName = sanitize(params.name);
			const taskFile = path.join(RALPH_DIR, `${loopName}.md`);

			if (loadState(ctx, loopName)?.status === "active") {
				return { content: [{ type: "text", text: `Loop "${loopName}" already active.` }], details: {} };
			}

			const fullPath = path.resolve(ctx.cwd, taskFile);
			ensureDir(fullPath);
			fs.writeFileSync(fullPath, params.taskContent, "utf-8");

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
				status: "active",
				startedAt: new Date().toISOString(),
				lastReflectionAtItems: 0,
			};

			saveState(ctx, state);
			currentLoop = loopName;
			updateUI(ctx);

			pi.sendUserMessage(buildPrompt(state, params.taskContent, false), { deliverAs: "followUp" });

			return {
				content: [{ type: "text", text: `Started loop "${loopName}" (max ${state.maxIterations} iterations).` }],
				details: {},
			};
		},
	});

	// --- Event handlers ---

	pi.on("before_agent_start", async (event, ctx) => {
		// Handle stop command - check even if currentLoop is null (may be stale after restart)
		const prompt = event.prompt.toLowerCase().trim();
		if (prompt === "stop" || prompt === "/ralph stop" || prompt === "ralph stop") {
			// Find any active loop to stop
			const activeLoop = currentLoop 
				? loadState(ctx, currentLoop) 
				: listLoops(ctx).find(l => l.status === "active");
			if (activeLoop && activeLoop.status === "active") {
				pauseLoop(ctx, activeLoop, `Ralph loop "${activeLoop.name}" stopped.`);
				return;
			}
		}

		if (!currentLoop) return;
		const state = loadState(ctx, currentLoop);
		if (!state || state.status !== "active") return;

		const iterStr = `${state.iteration}${state.maxIterations > 0 ? `/${state.maxIterations}` : ""}`;
		const itemsStr = state.itemsPerIteration > 0 ? ` | ${state.itemsProcessed} items done` : "";

		let instructions = `You are in a Ralph loop working on: ${state.taskFile}\n`;
		if (state.itemsPerIteration > 0) {
			instructions += `- Process ${state.itemsPerIteration} items this iteration, then STOP\n`;
		}
		instructions += `- Update the task file as you progress\n`;
		instructions += `- When FULLY COMPLETE: ${COMPLETE_MARKER}\n`;
		instructions += `- Do NOT output completion marker unless genuinely done`;

		return {
			systemPromptAppend: `\n[RALPH LOOP - ${state.name} - Iteration ${iterStr}${itemsStr}]\n\n${instructions}`,
		};
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!currentLoop) return;
		const state = loadState(ctx, currentLoop);
		if (!state || state.status !== "active") return;

		// Pause if user has pending input
		if (ctx.hasPendingMessages()) {
			pauseLoop(ctx, state, `Ralph loop "${state.name}" paused. Use /ralph resume ${state.name} to continue.`);
			return;
		}

		// Check for completion marker
		const lastAssistant = [...event.messages].reverse().find((m) => m.role === "assistant");
		const text =
			lastAssistant && Array.isArray(lastAssistant.content)
				? lastAssistant.content
						.filter((c): c is { type: "text"; text: string } => c.type === "text")
						.map((c) => c.text)
						.join("\n")
				: "";

		if (text.includes(COMPLETE_MARKER)) {
			completeLoop(
				ctx,
				state,
				`───────────────────────────────────────────────────────────────────────
✅ RALPH LOOP COMPLETE: ${state.name} | ${state.iteration} iterations
───────────────────────────────────────────────────────────────────────`,
			);
			return;
		}

		// Check max iterations
		if (state.maxIterations > 0 && state.iteration >= state.maxIterations) {
			completeLoop(
				ctx,
				state,
				`───────────────────────────────────────────────────────────────────────
⚠️ RALPH LOOP STOPPED: ${state.name} | Max iterations (${state.maxIterations}) reached
───────────────────────────────────────────────────────────────────────`,
			);
			return;
		}

		// Continue to next iteration
		state.iteration++;
		if (state.itemsPerIteration > 0) state.itemsProcessed += state.itemsPerIteration;

		const needsReflection =
			state.reflectEveryItems > 0 &&
			state.itemsProcessed > 0 &&
			state.itemsProcessed - state.lastReflectionAtItems >= state.reflectEveryItems;
		if (needsReflection) state.lastReflectionAtItems = state.itemsProcessed;

		saveState(ctx, state);
		updateUI(ctx);

		const content = tryRead(path.resolve(ctx.cwd, state.taskFile));
		if (!content) {
			pauseLoop(ctx, state);
			pi.sendUserMessage(`───────────────────────────────────────────────────────────────────────
❌ RALPH LOOP ERROR: ${state.name} | Could not read task file: ${state.taskFile}
───────────────────────────────────────────────────────────────────────`);
			return;
		}

		pi.sendUserMessage(buildPrompt(state, content, needsReflection));
	});

	pi.on("session_start", async (_event, ctx) => {
		const active = listLoops(ctx).filter((l) => l.status === "active");
		if (active.length > 0 && ctx.hasUI) {
			const lines = active.map(
				(l) => `  • ${l.name} (iteration ${l.iteration}${l.maxIterations > 0 ? `/${l.maxIterations}` : ""})`,
			);
			ctx.ui.notify(`Active Ralph loops:\n${lines.join("\n")}\n\nUse /ralph resume <name> to continue`, "info");
		}
		updateUI(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (currentLoop) {
			const state = loadState(ctx, currentLoop);
			if (state) saveState(ctx, state);
		}
	});
}
