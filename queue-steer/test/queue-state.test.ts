import assert from "node:assert/strict";
import test from "node:test";
import { FollowUpQueue } from "../queue-state.ts";

test("dispatches follow-ups in FIFO order", () => {
	const queue = new FollowUpQueue<string>();
	queue.enqueue("first", ["one.png"]);
	queue.enqueue("second");

	assert.deepEqual(queue.shift(), {
		id: "follow-up-1",
		text: "first",
		images: ["one.png"],
	});
	assert.equal(queue.shift()?.text, "second");
	assert.equal(queue.length, 0);
});

test("edits one item without changing its position", () => {
	const queue = new FollowUpQueue();
	const first = queue.enqueue("first");
	queue.enqueue("second");

	assert.equal(queue.update(first.id, "first, edited"), true);
	assert.deepEqual(queue.snapshot().map((item) => item.text), ["first, edited", "second"]);
});

test("cycles upward from the item nearest the editor", () => {
	const queue = new FollowUpQueue();
	const first = queue.enqueue("first");
	const second = queue.enqueue("second");
	const third = queue.enqueue("third");

	assert.equal(queue.previousId(), third.id);
	assert.equal(queue.previousId(third.id), second.id);
	assert.equal(queue.previousId(second.id), first.id);
	assert.equal(queue.previousId(first.id), third.id);
});

test("restores a failed dispatch at the front", () => {
	const queue = new FollowUpQueue();
	queue.enqueue("first");
	queue.enqueue("second");
	const first = queue.shift();
	assert.ok(first);
	queue.prepend(first);

	assert.deepEqual(queue.snapshot().map((item) => item.text), ["first", "second"]);
});
