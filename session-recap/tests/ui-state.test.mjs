import assert from "node:assert/strict";
import test from "node:test";
import { clearOwnedStatus } from "../ui-state.ts";

test("cancellation clears the request-owned status key after config key changes", () => {
	const cleared = [];
	const rendered = clearOwnedStatus((key, value) => cleared.push([key, value]), "old-status", "new-status");
	assert.deepEqual(cleared, [["old-status", undefined]]);
	assert.equal(rendered, "new-status");
});

test("clearing the currently rendered owner resets tracked status state", () => {
	const cleared = [];
	const rendered = clearOwnedStatus((key, value) => cleared.push([key, value]), "session-recap", "session-recap");
	assert.deepEqual(cleared, [["session-recap", undefined]]);
	assert.equal(rendered, undefined);
});
