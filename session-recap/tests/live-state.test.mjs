import assert from "node:assert/strict";
import test from "node:test";
import { consumePendingAway, DeferredTriggerState, LiveActivityBuffer, LiveRecapState } from "../live-state.ts";

const FIRST = 120_000;
const INTERVAL = 90_000;

test("pending away work drains once after its owning live request is cancelled", () => {
	assert.deepEqual(consumePendingAway(true, true, true, true), {
		pending: false,
		shouldSchedule: true,
	});
	assert.equal(consumePendingAway(false, true, true, true).shouldSchedule, false, "consumed work does not duplicate");
	assert.equal(consumePendingAway(true, false, true, true).shouldSchedule, false, "refocus suppresses work");
	assert.equal(consumePendingAway(true, true, false, true).shouldSchedule, false, "automatic config is respected");
	assert.equal(consumePendingAway(true, true, true, false).shouldSchedule, false, "away config is respected");
});

test("deferred triggers invalidate duplicates and cancellation prevents stale work", () => {
	const state = new DeferredTriggerState();
	const first = state.arm();
	const second = state.arm();
	assert.equal(state.consume(first), false, "new work invalidates the older callback");
	assert.equal(state.consume(second), true);
	assert.equal(state.consume(second), false, "one generation fires once");
	const cancelled = state.arm();
	state.cancel();
	assert.equal(state.consume(cancelled), false);
});

test("first live snapshot waits 120 seconds and requires dirty activity", () => {
	const state = new LiveRecapState();
	state.start(1_000);
	assert.equal(state.beginLive(121_000, FIRST, INTERVAL), undefined);
	state.activity();
	assert.equal(state.beginLive(120_999, FIRST, INTERVAL), undefined);
	assert.equal(state.beginLive(121_000, FIRST, INTERVAL)?.version, 1);
});

test("live snapshots throttle, require new activity, and allow slightly stale completion", () => {
	const state = new LiveRecapState();
	state.start(0);
	state.activity();
	const first = state.beginLive(FIRST, FIRST, INTERVAL);
	assert.ok(first);
	state.activity();
	assert.equal(state.complete(first.id, FIRST, true), true, "activity during generation does not invalidate its snapshot");
	assert.equal(state.beginLive(FIRST + INTERVAL - 1, FIRST, INTERVAL), undefined);
	const second = state.beginLive(FIRST + INTERVAL, FIRST, INTERVAL);
	assert.equal(second.version, 2);
	state.complete(second.id, FIRST + INTERVAL, true);
	assert.equal(state.beginLive(FIRST + INTERVAL * 2, FIRST, INTERVAL), undefined, "clean state does not call again");
});

test("a slow request throttles from visible completion instead of request start", () => {
	const state = new LiveRecapState();
	state.start(0);
	state.activity();
	const first = state.beginLive(FIRST, FIRST, INTERVAL);
	state.activity();
	const slowCompletion = FIRST + INTERVAL + 10_000;
	assert.equal(state.complete(first.id, slowCompletion, true), true);
	assert.equal(state.beginLive(slowCompletion + 1, FIRST, INTERVAL), undefined);
	assert.equal(state.beginLive(slowCompletion + INTERVAL - 1, FIRST, INTERVAL), undefined);
	assert.ok(state.beginLive(slowCompletion + INTERVAL, FIRST, INTERVAL));
});

test("one long-running tool makes the first snapshot eligible", () => {
	const state = new LiveRecapState();
	const buffer = new LiveActivityBuffer({
		assistantCharsPerVersion: 80,
		toolUpdateCharsPerVersion: 200,
		maxEvents: 40,
		maxEventChars: 1200,
		liveAssistantChars: 2400,
	});
	state.start(0);
	if (buffer.toolStart("one", "bash", { command: "long job" })) state.activity();
	const request = state.beginLive(FIRST, FIRST, INTERVAL);
	assert.ok(request);
	assert.match(buffer.lines().join("\n"), /Tool running: bash/);
});

test("manual recap replaces an in-flight live request and old completion cannot win", () => {
	const state = new LiveRecapState();
	state.start(0);
	state.activity();
	const live = state.beginLive(FIRST, FIRST, INTERVAL);
	const { request: manual, replaced } = state.beginManual();
	assert.equal(replaced.id, live.id);
	assert.equal(state.complete(live.id), false);
	assert.equal(state.complete(manual.id), true);
});

test("stop prevents new live work while allowing the current snapshot to finish", () => {
	const state = new LiveRecapState();
	state.start(0);
	state.activity();
	const request = state.beginLive(FIRST, FIRST, INTERVAL);
	state.stop();
	assert.equal(state.beginLive(FIRST + INTERVAL, FIRST, INTERVAL), undefined);
	assert.equal(state.complete(request.id), true);
});

test("empty or whitespace-only assistant updates do not dirty live state", () => {
	const buffer = new LiveActivityBuffer({
		assistantCharsPerVersion: 4,
		toolUpdateCharsPerVersion: 5,
		maxEvents: 2,
		maxEventChars: 20,
		liveAssistantChars: 10,
	});
	assert.equal(buffer.assistantUpdate(""), false);
	assert.equal(buffer.assistantUpdate("   \n"), false);
	assert.deepEqual(buffer.lines(), []);
});

test("stream and tool updates are capped and only cross configured dirty thresholds", () => {
	const buffer = new LiveActivityBuffer({
		assistantCharsPerVersion: 4,
		toolUpdateCharsPerVersion: 5,
		maxEvents: 2,
		maxEventChars: 20,
		liveAssistantChars: 10,
	});
	assert.equal(buffer.assistantUpdate("a"), true);
	assert.equal(buffer.assistantUpdate("ab"), false);
	assert.equal(buffer.assistantUpdate("abcdefgh"), true);
	buffer.toolStart("t", "bash", {});
	assert.equal(buffer.toolUpdate("t", "bash", "12"), true);
	assert.equal(buffer.toolUpdate("t", "bash", "1234"), false);
	assert.equal(buffer.toolUpdate("t", "bash", "1234567890"), true);
	assert.ok(buffer.lines().length <= 4, "event cap plus active assistant/tool snapshots remains bounded");
});

test("completed and failed tools are removed from running snapshots", () => {
	const buffer = new LiveActivityBuffer({
		assistantCharsPerVersion: 4,
		toolUpdateCharsPerVersion: 5,
		maxEvents: 3,
		maxEventChars: 80,
		liveAssistantChars: 10,
	});
	for (let index = 0; index < 50; index++) {
		const id = `tool-${index}`;
		buffer.toolStart(id, "bash", { index });
		buffer.toolEnd(id, "bash", `result-${index}`, index % 2 === 0);
	}
	assert.equal(buffer.runningToolCount(), 0);
	assert.doesNotMatch(buffer.lines().join("\n"), /Tool running:/);
});

test("running tool records evict the oldest deterministically when end events are missing", () => {
	const buffer = new LiveActivityBuffer({
		assistantCharsPerVersion: 4,
		toolUpdateCharsPerVersion: 5,
		maxEvents: 10,
		maxEventChars: 80,
		maxRunningTools: 2,
		liveAssistantChars: 10,
	});
	buffer.toolStart("one", "first", {});
	buffer.toolStart("two", "second", {});
	buffer.toolStart("three", "third", {});
	assert.equal(buffer.runningToolCount(), 2);
	let running = buffer.lines().filter((line) => line.startsWith("Tool running:"));
	assert.deepEqual(running.map((line) => line.match(/^Tool running: (\w+)/)?.[1]), ["second", "third"]);

	buffer.toolUpdate("four", "fourth", "progress without a start event");
	assert.equal(buffer.runningToolCount(), 2);
	running = buffer.lines().filter((line) => line.startsWith("Tool running:"));
	assert.deepEqual(running.map((line) => line.match(/^Tool running: (\w+)/)?.[1]), ["third", "fourth"]);
});

test("streaming and finalized assistant lines preserve trailing evidence", () => {
	const buffer = new LiveActivityBuffer({
		assistantCharsPerVersion: 4,
		toolUpdateCharsPerVersion: 5,
		maxEvents: 4,
		maxEventChars: 80,
		liveAssistantChars: 60,
	});
	buffer.assistantUpdate(`STREAM_HEAD ${"middle ".repeat(30)} STREAM_TAIL`);
	let lines = buffer.lines();
	assert.match(lines.at(-1), /^Assistant streaming:/);
	assert.match(lines.at(-1), /STREAM_TAIL/);
	assert.ok(lines.every((line) => line.length <= 80));

	buffer.messageEnd(`FINAL_HEAD ${"middle ".repeat(30)} FINAL_TAIL`);
	lines = buffer.lines();
	assert.match(lines.join("\n"), /Assistant finalized:/);
	assert.match(lines.join("\n"), /FINAL_TAIL/);
	assert.ok(lines.every((line) => line.length <= 80));
});

test("running tool formatting keeps latest progress visible after long arguments", () => {
	const buffer = new LiveActivityBuffer({
		assistantCharsPerVersion: 4,
		toolUpdateCharsPerVersion: 5,
		maxEvents: 4,
		maxEventChars: 90,
		liveAssistantChars: 60,
	});
	buffer.toolStart("t", "bash", { command: `build ${"argument ".repeat(40)}` });
	buffer.toolUpdate("t", "bash", `${"old output ".repeat(30)}LATEST_PROGRESS`);
	const running = buffer.lines().find((line) => line.startsWith("Tool running:"));
	assert.match(running, /; latest: /);
	assert.match(running, /LATEST_PROGRESS/);
	assert.ok(running.length <= 90);
});

test("tool end and error lines preserve trailing result evidence", () => {
	const buffer = new LiveActivityBuffer({
		assistantCharsPerVersion: 4,
		toolUpdateCharsPerVersion: 5,
		maxEvents: 6,
		maxEventChars: 80,
		liveAssistantChars: 60,
	});
	buffer.toolEnd("done", "test", `${"passing ".repeat(40)}DONE_TAIL`, false);
	buffer.toolEnd("failed", "test", `${"diagnostic ".repeat(40)}ERROR_TAIL`, true);
	const lines = buffer.lines().join("\n");
	assert.match(lines, /Tool done: test:/);
	assert.match(lines, /DONE_TAIL/);
	assert.match(lines, /Tool error: test:/);
	assert.match(lines, /ERROR_TAIL/);
	assert.ok(buffer.lines().every((line) => line.length <= 80));
});

test("same-length tool progress eventually dirties the run", () => {
	const buffer = new LiveActivityBuffer({
		assistantCharsPerVersion: 4,
		toolUpdateCharsPerVersion: 3,
		maxEvents: 4,
		maxEventChars: 5,
		liveAssistantChars: 10,
	});
	buffer.toolStart("t", "progress", {});
	assert.equal(buffer.toolUpdate("t", "progress", "0%"), true);
	assert.equal(buffer.toolUpdate("t", "progress", "1%"), false);
	assert.equal(buffer.toolUpdate("t", "progress", "2%"), false);
	assert.equal(buffer.toolUpdate("t", "progress", "3%"), true);
});

test("changed tool tails keep dirtying after visible output reaches its cap", () => {
	const buffer = new LiveActivityBuffer({
		assistantCharsPerVersion: 4,
		toolUpdateCharsPerVersion: 4,
		maxEvents: 4,
		maxEventChars: 5,
		liveAssistantChars: 10,
	});
	buffer.toolStart("t", "stream", {});
	assert.equal(buffer.toolUpdate("t", "stream", "aaaaa"), true);
	assert.equal(buffer.toolUpdate("t", "stream", "baaaa"), false);
	assert.equal(buffer.toolUpdate("t", "stream", "bbaaa"), false);
	assert.equal(buffer.toolUpdate("t", "stream", "bbbaa"), false);
	assert.equal(buffer.toolUpdate("t", "stream", "bbbba"), true);
});
