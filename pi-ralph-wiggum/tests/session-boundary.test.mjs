import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ralphExtension from "../index.ts";

function makeCtx(cwd, sessionId = "fresh-session") {
	return {
		cwd,
		sessionManager: { getSessionId: () => sessionId },
		hasUI: true,
		ui: {
			notify() {},
			setStatus() {},
			setWidget() {},
			confirm: async () => false,
			theme: {
				fg(_name, text) {
					return text;
				},
				bold(text) {
					return text;
				},
			},
		},
		isIdle: () => true,
		hasPendingMessages: () => false,
	};
}

function makePi() {
	const events = new Map();
	return {
		events,
		sentUserMessages: [],
		commands: new Map(),
		tools: new Map(),
		on(name, handler) {
			events.set(name, handler);
		},
		registerCommand(name, command) {
			this.commands.set(name, command);
		},
		registerTool(tool) {
			this.tools.set(tool.name, tool);
		},
		sendUserMessage(message, options) {
			this.sentUserMessages.push({ message, options });
		},
	};
}

const tempDirs = [];

function makeTempDir(name) {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), name));
	tempDirs.push(cwd);
	fs.mkdirSync(path.join(cwd, ".ralph"), { recursive: true });
	return cwd;
}

function writeLoop(cwd, state) {
	fs.writeFileSync(path.join(cwd, ".ralph", `${state.name}.md`), `# ${state.name}\n`, "utf8");
	fs.writeFileSync(
		path.join(cwd, ".ralph", `${state.name}.state.json`),
		JSON.stringify(state, null, 2),
		"utf8",
	);
}

function readLoop(cwd, name) {
	return JSON.parse(fs.readFileSync(path.join(cwd, ".ralph", `${name}.state.json`), "utf8"));
}

const baseState = {
	iteration: 1,
	maxIterations: 50,
	itemsPerIteration: 1,
	reflectEvery: 0,
	reflectInstructions: "reflect",
	active: true,
	status: "active",
	startedAt: "2026-07-08T11:54:18.989Z",
	lastReflectionAt: 0,
};

try {
	const legacyCwd = makeTempDir("ralph-session-boundary-");
	writeLoop(legacyCwd, {
		...baseState,
		name: "old-loop",
		taskFile: ".ralph/old-loop.md",
		iteration: 12,
		maxIterations: 1000,
		itemsPerIteration: 3,
		reflectEvery: 10,
	});

	const legacyPi = makePi();
	ralphExtension(legacyPi);
	const legacyCtx = makeCtx(legacyCwd);
	await legacyPi.events.get("session_start")({}, legacyCtx);
	const legacyResult = await legacyPi.events
		.get("before_agent_start")({ systemPrompt: "base prompt" }, legacyCtx);
	assert.equal(
		legacyResult,
		undefined,
		"a fresh unrelated session must not bind legacy repo-local state before explicit resume",
	);

	const ownedCwd = makeTempDir("ralph-session-owned-");
	writeLoop(ownedCwd, {
		...baseState,
		name: "owned-loop",
		taskFile: ".ralph/owned-loop.md",
		iteration: 4,
		ownerSessionId: "same-session",
	});

	const ownerPi = makePi();
	ralphExtension(ownerPi);
	const ownerCtx = makeCtx(ownedCwd, "same-session");
	await ownerPi.events.get("session_start")({}, ownerCtx);
	const ownedResult = await ownerPi.events
		.get("before_agent_start")({ systemPrompt: "base prompt" }, ownerCtx);
	assert.match(
		ownedResult?.systemPrompt ?? "",
		/RALPH LOOP - owned-loop - Iteration 4\/50/,
		"the owning session should rehydrate its active loop after reload or compaction",
	);

	const claimantPi = makePi();
	ralphExtension(claimantPi);
	const claimantCtx = makeCtx(ownedCwd, "claimant-session");
	await claimantPi.events.get("session_start")({}, claimantCtx);
	await claimantPi.commands.get("ralph").handler("resume owned-loop", claimantCtx);

	assert.equal(readLoop(ownedCwd, "owned-loop").ownerSessionId, "claimant-session");
	assert.equal(readLoop(ownedCwd, "owned-loop").iteration, 5);

	const formerOwnerResult = await ownerPi.events
		.get("before_agent_start")({ systemPrompt: "base prompt" }, ownerCtx);
	assert.equal(
		formerOwnerResult,
		undefined,
		"the former owner must stop injecting prompts immediately after ownership transfers",
	);

	const formerOwnerDone = await ownerPi.tools.get("ralph_done").execute("call", {}, undefined, undefined, ownerCtx);
	assert.match(formerOwnerDone.content[0].text, /No active Ralph loop owned by this session/);
	await ownerPi.commands.get("ralph-stop").handler("", ownerCtx);
	assert.equal(readLoop(ownedCwd, "owned-loop").status, "active");
	assert.equal(readLoop(ownedCwd, "owned-loop").iteration, 5);

	const claimantResult = await claimantPi.events
		.get("before_agent_start")({ systemPrompt: "base prompt" }, claimantCtx);
	assert.match(claimantResult?.systemPrompt ?? "", /RALPH LOOP - owned-loop - Iteration 5\/50/);
	await claimantPi.tools.get("ralph_done").execute("call", {}, undefined, undefined, claimantCtx);
	assert.equal(readLoop(ownedCwd, "owned-loop").iteration, 6);

	const startedCwd = makeTempDir("ralph-session-start-");
	const startedPi = makePi();
	ralphExtension(startedPi);
	const startedCtx = makeCtx(startedCwd, "starter-session");
	await startedPi.tools.get("ralph_start").execute(
		"call",
		{ name: "started-loop", taskContent: "# Task\n", maxIterations: 3 },
		undefined,
		undefined,
		startedCtx,
	);
	assert.equal(readLoop(startedCwd, "started-loop").ownerSessionId, "starter-session");

	console.log("session boundary test passed");
} finally {
	for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
}
