import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import ralphExtension from "../index.ts";

function harness(t) {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-lifecycle-"));
	t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
	fs.mkdirSync(path.join(cwd, ".ralph"));
	const events = new Map();
	const commands = new Map();
	const tools = new Map();
	const messages = [];
	const notifications = [];
	const pi = {
		on: (name, handler) => events.set(name, handler),
		registerCommand: (name, command) => commands.set(name, command),
		registerTool: (tool) => tools.set(tool.name, tool),
		sendUserMessage: (message) => messages.push(message),
	};
	ralphExtension(pi);
	const ctx = {
		cwd,
		sessionManager: { getSessionId: () => "owner" },
		hasUI: true,
		ui: {
			notify: (message) => notifications.push(message),
			setStatus() {},
			setWidget() {},
			theme: { fg: (_name, text) => text, bold: (text) => text },
		},
		isIdle: () => true,
		hasPendingMessages: () => false,
	};
	return {
		cwd, ctx, messages, notifications,
		command: (args) => commands.get("ralph").handler(args, ctx),
		stop: () => commands.get("ralph-stop").handler("", ctx),
		tool: (name, params = {}) => tools.get(name).execute("call", params, undefined, undefined, ctx),
		event: (name, event = {}) => events.get(name)(event, ctx),
		deliver: (prompt = messages.at(-1)) => events.get("message_start")?.({
			message: { role: "user", content: [{ type: "text", text: prompt }] },
		}, ctx),
		begin: () => events.get("before_agent_start")({ systemPrompt: "base" }, ctx),
		// One attempt; Pi emits agent_end again if it retries a failed attempt.
		attempt: (text = "Progress made") => events.get("agent_end")({
			messages: [{ role: "assistant", content: [{ type: "text", text }] }],
		}, ctx),
		// The user aborts the run (Esc): Pi still settles it.
		abort: async () => {
			await events.get("agent_end")({ messages: [{ role: "assistant", stopReason: "aborted", content: [] }] }, ctx);
			await events.get("agent_settled")?.({}, ctx);
		},
		// A whole run: its final attempt, then settlement.
		end: async (text = "Progress made") => {
			await events.get("agent_end")({ messages: [{ role: "assistant", content: [{ type: "text", text }] }] }, ctx);
			await events.get("agent_settled")?.({}, ctx);
		},
		read: (name) => JSON.parse(fs.readFileSync(path.join(cwd, ".ralph", `${name}.state.json`), "utf8")),
		taskPath: (name) => path.join(cwd, ".ralph", `${name}.md`),
		statePath: (name) => path.join(cwd, ".ralph", `${name}.state.json`),
	};
}

for (const finishWithDone of [true, false]) {
	test(`maxIterations=2 executes the queued final iteration (ralph_done=${finishWithDone})`, async (t) => {
		const h = harness(t);
		await h.command("start task --max-iterations 2");
		await h.begin();
		await h.tool("ralph_done");
		assert.equal(h.read("task").iteration, 2);
		await h.end();
		assert.equal(h.read("task").status, "active", "ending iteration 1 must not complete queued iteration 2");
		assert.equal(h.messages.length, 2, "no stop banner before the final iteration runs");
		assert.match((await h.begin()).systemPrompt, /Iteration 2\/2/);
		if (finishWithDone) await h.tool("ralph_done");
		await h.end();
		assert.equal(h.read("task").status, "completed");
		assert.equal(h.read("task").iteration, 2, "do not persist an iteration that never ran");
		assert.equal(h.messages.length, 3, "only one stop banner");
	});
}

for (const finishWithDone of [true, false]) {
	test(`follow-ups delivered within one Pi run execute both iterations (ralph_done=${finishWithDone})`, async (t) => {
		const h = harness(t);
		await h.begin(); // No loop yet: the agent starts it with a tool.
		await h.tool("ralph_start", { name: "task", taskContent: "# Task", maxIterations: 2 });
		await h.deliver();
		await h.tool("ralph_done");
		assert.equal(h.read("task").iteration, 2);
		assert.equal(h.read("task").status, "active");
		await h.deliver(); // Pi 0.87 drains follow-ups without another before_agent_start.
		if (finishWithDone) await h.tool("ralph_done");
		await h.end();
		assert.equal(h.read("task").status, "completed");
		assert.equal(h.read("task").iteration, 2);
		assert.equal(h.messages.length, 3);
	});
}

test("undelivered or lookalike queued prompts cannot exhaust the limit", async (t) => {
	const h = harness(t);
	await h.command("start task --max-iterations 2");
	await h.begin();
	await h.tool("ralph_done");
	await h.end();
	const queued = h.messages.at(-1);
	await h.deliver(queued.replace(/<!-- ralph-prompt:.* -->/, ""));
	await h.tool("ralph_done");
	assert.equal(h.read("task").status, "active");
	assert.equal(h.messages.length, 2);
	await h.deliver(queued);
	await h.end();
	assert.equal(h.read("task").status, "completed");
});

test("a queued prompt with context appended by an input handler still counts as delivered", async (t) => {
	const h = harness(t);
	await h.begin();
	await h.tool("ralph_start", { name: "task", taskContent: "# Task", maxIterations: 3 });
	await h.deliver(`${h.messages.at(-1)}\n\n[context appended by another extension]`);
	await h.tool("ralph_done");
	assert.equal(h.read("task").iteration, 2);
	await h.deliver(h.messages.at(-1).replace(/ralph-prompt:[^ ]+/, "ralph-prompt:wrong-uuid"));
	await h.tool("ralph_done");
	assert.equal(h.read("task").iteration, 2, "a different marker must not advance the loop");
});

test("ralph_done still works after a retryable error ends the run and Pi continues it", async (t) => {
	const h = harness(t);
	await h.command("start task --max-iterations 3");
	await h.begin();
	await h.attempt("API error, retrying"); // Pi 0.87 emits agent_end, then agent.continue() without before_agent_start.
	await h.tool("ralph_done");
	assert.equal(h.read("task").iteration, 2);
	assert.equal(h.messages.length, 2);
});

test("a retried final iteration completes only after the retry, not on the failed attempt", async (t) => {
	const h = harness(t);
	await h.command("start task --max-iterations 1");
	await h.begin();
	await h.attempt("API error, retrying"); // Retryable failure: Pi continues the same run.
	assert.equal(h.read("task").status, "active", "the final iteration has not finished yet");
	assert.equal(h.messages.length, 1, "no stop banner while Pi is retrying");
	await h.end("Work done on retry");
	assert.equal(h.read("task").status, "completed");
	assert.equal(h.messages.length, 2, "exactly one stop banner");
});

test("aborting the final iteration completes the loop without prompting the model again", async (t) => {
	const h = harness(t);
	await h.command("start task --max-iterations 1");
	await h.begin();
	await h.abort();
	assert.equal(h.read("task").status, "completed");
	assert.equal(h.messages.length, 1, "no banner prompt that would restart the aborted model");
	assert.match(h.notifications.at(-1), /Max iterations \(1\) reached/);
});

test("ralph_done cannot advance the same executing iteration twice", async (t) => {
	const h = harness(t);
	await h.command("start task --max-iterations 2");
	await h.begin();
	await h.tool("ralph_done");
	await h.tool("ralph_done");
	assert.equal(h.read("task").status, "active");
	assert.equal(h.read("task").iteration, 2);
	assert.equal(h.messages.length, 2);
});

test("the executing final iteration completes without ralph_done", async (t) => {
	const h = harness(t);
	await h.command("start task --max-iterations 1");
	await h.begin();
	await h.end();
	assert.equal(h.read("task").status, "completed");
});

test("a completion marker still completes a run that queued another iteration", async (t) => {
	const h = harness(t);
	await h.command("start task --max-iterations 2");
	await h.begin();
	await h.tool("ralph_done");
	await h.end("<promise>COMPLETE</promise>");
	assert.equal(h.read("task").status, "completed");
});

test("agent_end does not complete a different loop queued during the run", async (t) => {
	const h = harness(t);
	await h.command("start first --max-iterations 1");
	await h.begin();
	await h.tool("ralph_start", { name: "second", taskContent: "# Task", maxIterations: 1 });
	await h.end("<promise>COMPLETE</promise>");
	assert.equal(h.read("second").status, "active");
	await h.begin();
	await h.end();
	assert.equal(h.read("second").status, "completed");
});

for (const starter of ["command", "tool", "resume"]) {
	test(`${starter} activation pauses the previous owned loop`, async (t) => {
		const h = harness(t);
		if (starter === "resume") {
			await h.command("start second");
			await h.command("stop");
		}
		await h.command("start first");
		if (starter === "tool") {
			await h.tool("ralph_start", { name: "second", taskContent: "# Task" });
		} else {
			await h.command(starter === "resume" ? "resume second" : "start second");
		}
		assert.equal(h.read("first").status, "paused");
		assert.equal(h.read("first").active, false);
		assert.equal(h.read("second").status, "active");
		await h.stop();
		await h.event("session_start");
		assert.equal(await h.begin(), undefined, "stopping B must not resurrect A on session reload");
	});
}

for (const operation of ["start", "resume"]) {
	for (const failure of ["empty", "unreadable", "missing"]) {
		if (operation === "start" && failure === "missing") continue; // Start intentionally creates missing tasks.
		test(`${operation} with ${failure} task preserves the current loop and does not activate the target`, async (t) => {
			const h = harness(t);
			let before;
			if (operation === "resume") {
				await h.command("start broken");
				await h.command("stop");
				before = h.read("broken");
			}
			await h.command("start first");
			const taskPath = h.taskPath("broken");
			fs.rmSync(taskPath, { force: true });
			if (failure === "empty") fs.writeFileSync(taskPath, "");
			if (failure === "unreadable") fs.mkdirSync(taskPath); // readFileSync fails even when tests run as root.
			const messageCount = h.messages.length;
			await h.command(`${operation} broken`);
			assert.equal(h.messages.length, messageCount);
			assert.match(h.notifications.at(-1), /Could not read task file/);
			assert.equal(h.read("first").status, "active");
			assert.match((await h.begin()).systemPrompt, /RALPH LOOP - first/);
			if (before) assert.deepEqual(h.read("broken"), before, "failed resume must not change iteration or ownership");
			else assert.equal(fs.existsSync(h.statePath("broken")), false);
		});
	}
}

test("tool start rejects an empty task without replacing the running loop", async (t) => {
	const h = harness(t);
	await h.command("start first");
	const count = h.messages.length;
	const result = await h.tool("ralph_start", { name: "broken", taskContent: "" });
	assert.match(result.content[0].text, /empty/i);
	assert.equal(h.messages.length, count);
	assert.equal(fs.existsSync(h.statePath("broken")), false);
	assert.equal(h.read("first").status, "active");
});

test("switching sessions rehydrates the new owner's loop despite an old selection", async (t) => {
	const h = harness(t);
	await h.command("start first");
	h.ctx.sessionManager.getSessionId = () => "other-owner";
	await h.command("start second");
	assert.equal(h.read("first").status, "active", "do not pause another session's loop");
	h.ctx.sessionManager.getSessionId = () => "owner";
	await h.event("session_start");
	assert.match((await h.begin())?.systemPrompt ?? "", /RALPH LOOP - first/);
});

test("session recovery pauses older duplicate active loops from legacy state", async (t) => {
	const h = harness(t);
	await h.command("start first");
	await h.command("start second");
	const first = h.read("first");
	first.status = "active";
	first.active = true;
	fs.writeFileSync(h.statePath("first"), JSON.stringify(first));
	fs.utimesSync(h.statePath("first"), 1000, 1000);
	fs.utimesSync(h.statePath("second"), 2000, 2000);
	await h.event("session_start");
	assert.equal(h.read("first").status, "paused");
	assert.equal(h.read("second").status, "active");
	assert.match((await h.begin()).systemPrompt, /RALPH LOOP - second/);
});

test("unlimited iterations retain reflection pacing", async (t) => {
	const h = harness(t);
	await h.command("start task --max-iterations 0 --reflect-every 1");
	await h.begin();
	await h.tool("ralph_done");
	await h.deliver();
	await h.tool("ralph_done");
	await h.end();
	assert.equal(h.read("task").status, "active");
	assert.equal(h.read("task").iteration, 3);
	assert.equal(h.read("task").lastReflectionAt, 3);
	assert.match(h.messages.at(-1), /REFLECTION CHECKPOINT/);
});
