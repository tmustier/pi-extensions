import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionProjection } from "@earendil-works/pi-coding-agent";
import { buildRecapContext, hasMeaningfulActivity } from "../index.ts";

const initialTask = `Build a session recap that preserves the user's task framing. ${"context ".repeat(100)}`.trim();
const summary = `The recap extension now works, but its output lacks the original task context. ${"detail ".repeat(120)}`.trim();
const toolResult = `The implementation still flattens and truncates the conversation. ${"output ".repeat(1000)}`;

function project(entries) {
	let parentId = null;
	const complete = entries.map((entry, index) => {
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
	return buildSessionProjection(complete).entries;
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
	const context = buildRecapContext(project([initialEntry, ...currentEntries]));

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

	const context = buildRecapContext(project(branch));
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

	const context = buildRecapContext(project(branch));
	assert.equal(context.messages[0].role, "user");
	assert.equal(context.messages[0].content, "(Earlier conversation omitted.)");
	assert.equal(context.messages[1].role, "assistant");
});

test("recap context does not repeat a recent initial request", () => {
	const context = buildRecapContext(project([initialEntry]));
	assert.equal(context.broaderContext, undefined);
});

test("canonical projection applies context replacements to recap messages and initial framing", () => {
	const branch = [
		{ ...initialEntry, id: "initial" },
		{
			type: "context_edit",
			targetId: "initial",
			replacement: { content: "Build the corrected projected task." },
		},
	];
	for (let i = 0; i < 16; i++) {
		branch.push(
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: `Response ${i}` }] } },
			{ type: "message", message: { role: "user", content: `Follow-up ${i}` } },
		);
	}

	const context = buildRecapContext(project(branch));
	assert.doesNotMatch(JSON.stringify(context), /preserves the user's task framing/);
	assert.match(context.broaderContext, /Initial user request:\nBuild the corrected projected task\./);
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
	const projection = project(entries);
	const context = buildRecapContext(projection);

	assert.deepEqual(context.messages.map((message) => message.content), ["Current task"]);
	assert.equal(context.broaderContext, undefined);
	assert.equal(hasMeaningfulActivity(projection), false);
});

test("canonical projection applies assistant replacements to activity logic", () => {
	const projection = project([
		{ type: "message", message: { role: "user", content: "Current task" } },
		{
			type: "message",
			id: "assistant",
			message: {
				role: "assistant",
				content: [{ type: "toolCall", id: "call-old", name: "read", arguments: { path: "old.ts" } }],
			},
		},
		{
			type: "context_edit",
			targetId: "assistant",
			replacement: { content: "Brief corrected response." },
		},
	]);

	assert.equal(hasMeaningfulActivity(projection), false);
});
