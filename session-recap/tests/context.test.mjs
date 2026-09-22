import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionProjection } from "@earendil-works/pi-coding-agent";
import { buildRecapContext, hasMeaningfulActivity } from "../index.ts";

const initialTask = `Build a session recap that preserves the user's task framing. ${"context ".repeat(100)}`.trim();
const summary = `The recap extension now works, but its output lacks the original task context. ${"detail ".repeat(120)}`.trim();
const toolResult = `The implementation still flattens and truncates the conversation. ${"output ".repeat(1000)}`;

function completeBranch(entries) {
	let parentId = null;
	return entries.map((entry, index) => {
		const id = entry.id ?? `entry-${index}`;
		const result = {
			...entry,
			id,
			parentId,
			timestamp: entry.timestamp ?? new Date(index * 1000).toISOString(),
		};
		parentId = id;
		return result;
	});
}

function recap(entries) {
	const branch = completeBranch(entries);
	return buildRecapContext(buildSessionProjection(branch).entries, branch);
}

const initialEntry = {
	type: "message",
	message: { role: "user", content: initialTask, timestamp: 1 },
};
const currentEntries = [
	{
		type: "branch_summary",
		fromId: "old-leaf",
		summary,
	},
	{
		type: "message",
		message: { role: "user", content: "Make it match Claude Code more closely.", timestamp: 2 },
	},
	{
		type: "message",
		message: {
			role: "assistant",
			content: [
				{ type: "text", text: "I am comparing the two implementations." },
				{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "src/services/awaySummary.ts" } },
			],
			timestamp: 3,
		},
	},
	{
		type: "message",
		message: {
			role: "toolResult",
			toolCallId: "call-1",
			toolName: "read",
			content: [{ type: "text", text: toolResult }],
			isError: false,
			timestamp: 4,
		},
	},
];

test("recap context keeps broad task framing and recent projected messages", () => {
	const context = recap([initialEntry, ...currentEntries]);

	assert.equal(context.broaderContext, `Session summary:\n${summary}`);
	assert.deepEqual(context.messages.map((message) => message.role), ["user", "user", "assistant", "toolResult"]);
	assert.equal(context.messages[0].content, initialTask);
	assert.equal(
		context.messages[3].content[0].text,
		`${toolResult.slice(0, 2000)}\n… [tool result truncated for recap] …\n${toolResult.slice(-2000)}`,
	);
});

test("recap context uses a 30-message recent window and bounds initial framing", () => {
	const initialRequest = `Start of request. ${"detail ".repeat(1500)}End of request.`;
	const branch = [];
	for (let i = 1; i <= 16; i++) {
		branch.push(
			{ type: "message", message: { role: "user", content: i === 1 ? initialRequest : `User request ${i}` } },
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: `Response ${i}` }] } },
		);
	}

	const context = recap(branch);
	assert.equal(context.messages.length, 30);
	assert.equal(context.messages[0].content, "User request 2");
	assert.ok(context.broaderContext.startsWith("Initial user request:\nStart of request."));
	assert.match(context.broaderContext, /\[middle of initial request omitted for recap\]/);
	assert.ok(context.broaderContext.endsWith("End of request."));
});

test("recap context adds a user boundary before an assistant-led window", () => {
	const branch = [{ type: "message", message: { role: "user", content: "Investigate the failing build." } }];
	for (let i = 1; i <= 16; i++) {
		branch.push(
			{
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "toolCall", id: `call-${i}`, name: "read", arguments: { path: `file-${i}` } }],
				},
			},
			{
				type: "message",
				message: {
					role: "toolResult",
					toolCallId: `call-${i}`,
					toolName: "read",
					content: [{ type: "text", text: `file ${i} contents` }],
				},
			},
		);
	}

	const context = recap(branch);
	assert.equal(context.messages[0].role, "user");
	assert.equal(context.messages[0].content, "(Earlier conversation omitted.)");
	assert.equal(context.messages[1].role, "assistant");
});

test("recap context does not repeat a recent initial request", () => {
	const context = recap([initialEntry]);
	assert.equal(context.broaderContext, undefined);
});

test("recap messages come from the canonical context-edit projection", () => {
	const context = recap([
		{ ...initialEntry, id: "initial" },
		{
			type: "context_edit",
			targetId: "initial",
			replacement: { content: "Build the corrected projected task." },
		},
	]);

	assert.deepEqual(context.messages.map((message) => message.content), ["Build the corrected projected task."]);
	assert.doesNotMatch(JSON.stringify(context), /preserves the user's task framing/);
});

test("canonical projection omits edited messages from initial-task and activity logic", () => {
	const entries = [
		{ type: "message", id: "old-user", message: { role: "user", content: "Discarded task" } },
		{
			type: "message",
			id: "old-assistant",
			message: {
				role: "assistant",
				content: [{ type: "toolCall", id: "call-old", name: "read", arguments: { path: "old.ts" } }],
			},
		},
		{ type: "context_edit", targetId: "old-user", replacement: null },
		{ type: "context_edit", targetId: "old-assistant", replacement: null },
		{ type: "message", message: { role: "user", content: "Current task" } },
	];
	const projection = buildSessionProjection(completeBranch(entries)).entries;
	const context = recap(entries);

	assert.deepEqual(context.messages.map((message) => message.content), ["Current task"]);
	assert.equal(context.broaderContext, undefined);
	assert.equal(hasMeaningfulActivity(projection), false);
});

test("recap context selects the active compaction when older compactions are retained after it", () => {
	const branch = completeBranch([
		{ ...initialEntry, id: "initial" },
		{
			type: "compaction",
			id: "old-compaction",
			summary: "Stale compaction summary",
			firstKeptEntryId: "initial",
			tokensBefore: 100,
		},
		{ type: "message", message: { role: "user", content: "Retained request" } },
		{
			type: "compaction",
			id: "active-compaction",
			summary: "Active compaction summary",
			firstKeptEntryId: "old-compaction",
			tokensBefore: 200,
		},
		{ type: "message", message: { role: "user", content: "Current request" } },
	]);
	const context = recap(branch);
	assert.match(context.broaderContext, /Session summary:\nActive compaction summary/);
	assert.doesNotMatch(context.broaderContext, /Stale compaction summary/);
});

test("compacted recap context retains the edited original request", () => {
	const branch = completeBranch([
		{ ...initialEntry, id: "initial" },
		{
			type: "compaction",
			id: "compaction",
			summary: "Work continues after compaction.",
			firstKeptEntryId: "compaction",
			tokensBefore: 100,
		},
		{
			type: "context_edit",
			targetId: "initial",
			replacement: { content: "Build the corrected original request." },
		},
		{ type: "message", message: { role: "user", content: "Continue from the summary." } },
	]);
	const context = recap(branch);

	assert.match(context.broaderContext, /Initial user request:\nBuild the corrected original request\./);
	assert.doesNotMatch(context.broaderContext, /preserves the user's task framing/);
});

test("compacted recap context does not restore an omitted original request", () => {
	const branch = completeBranch([
		{ ...initialEntry, id: "initial" },
		{ type: "message", message: { role: "user", content: "Use this surviving task instead." } },
		{
			type: "compaction",
			id: "compaction",
			summary: "Work continues after compaction.",
			firstKeptEntryId: "compaction",
			tokensBefore: 100,
		},
		{ type: "context_edit", targetId: "initial", replacement: null },
		{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "Continuing." }] } },
	]);
	const context = recap(branch);

	assert.match(context.broaderContext, /Initial user request:\nUse this surviving task instead\./);
	assert.doesNotMatch(context.broaderContext, /preserves the user's task framing/);
});
