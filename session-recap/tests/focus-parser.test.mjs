import assert from "node:assert/strict";
import test from "node:test";
import { FocusSequenceParser } from "../focus-parser.ts";

test("focus parser recognizes sequences split across chunks", () => {
	const parser = new FocusSequenceParser("\x1b[I", "\x1b[O", 64);
	assert.deepEqual(parser.push("noise\x1b["), []);
	assert.deepEqual(parser.push("I"), ["in"]);
	assert.deepEqual(parser.push("\x1b"), []);
	assert.deepEqual(parser.push("[O"), ["out"]);
});

test("focus parser handles mixed input and multiple events", () => {
	const parser = new FocusSequenceParser("IN", "OUT", 16);
	assert.deepEqual(parser.push("xINjunkOUTINy"), ["in", "out", "in"]);
});

test("shorter unrelated sequence is recognized without waiting for longer sequence", () => {
	const parser = new FocusSequenceParser("I", "OUTSIDE", 16);
	assert.deepEqual(parser.push("I"), ["in"]);
	assert.deepEqual(parser.push("OUT"), []);
	assert.deepEqual(parser.push("SIDE"), ["out"]);
});

test("focus parser rejects empty or identical sequences", () => {
	assert.throws(() => new FocusSequenceParser("", "OUT", 16), /non-empty/);
	assert.throws(() => new FocusSequenceParser("IN", "", 16), /non-empty/);
	assert.throws(() => new FocusSequenceParser("SAME", "SAME", 16), /distinct/);
	assert.throws(() => new FocusSequenceParser("A", "AB", 16), /prefix-overlapping/);
	assert.throws(() => new FocusSequenceParser("AB", "A", 16), /prefix-overlapping/);
	assert.throws(() => new FocusSequenceParser("IN", "LONG", 2), /cap/);
});
