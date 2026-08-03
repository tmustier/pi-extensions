import assert from "node:assert/strict";
import test from "node:test";
import { shippedDefaults } from "../config.ts";
import { buildTranscript, generateRecap, parseRecapResponse, renderTextTemplate } from "../recap.ts";

const model = (provider, id, api = "openai-codex-responses") => ({ provider, id, api });
const response = (text) => ({ content: [{ type: "text", text }] });

function recapContext({ active, models = [], auth = async () => ({ ok: true, apiKey: "test" }) }) {
	return {
		model: active,
		modelRegistry: {
			find(provider, id) {
				return models.find((candidate) => candidate.provider === provider && candidate.id === id);
			},
			getApiKeyAndHeaders: auth,
		},
	};
}

test("transcript cap preserves live and newest persisted evidence", () => {
	const config = shippedDefaults();
	config.transcript.totalChars = 210;
	config.transcript.currentUserReserveChars = 45;
	config.transcript.persistedReserveChars = 75;
	const entries = [
		{ type: "message", message: { role: "user", content: `old framing ${"x".repeat(500)}` } },
		{ type: "message", message: { role: "assistant", content: `obsolete detail ${"y".repeat(500)}` } },
		{ type: "message", message: { role: "assistant", content: "newest persisted result" } },
	];
	const transcript = buildTranscript(entries, config, [
		"Assistant streaming: current implementation work",
		"Tool running: test runner",
	]);
	assert.ok(transcript.length <= config.transcript.totalChars);
	assert.match(transcript, /newest persisted result/);
	assert.match(transcript, /entation work/);
	assert.match(transcript, /Tool running: test runner/);
	assert.doesNotMatch(transcript, /obsolete detail/);
});

test("small transcript caps reserve the current request, persisted detail, and live evidence", () => {
	const config = shippedDefaults();
	config.transcript.totalChars = 180;
	config.transcript.currentUserReserveChars = 50;
	config.transcript.persistedReserveChars = 70;
	config.transcript.liveMaxChars = 60;
	const transcript = buildTranscript([
		{ type: "message", message: { role: "user", content: "CURRENT_REQUEST" } },
		{ type: "message", message: { role: "assistant", content: "NEWEST_PERSISTED" } },
	], config, [`${"live output ".repeat(80)}LIVE_PROGRESS`]);
	assert.ok(transcript.length <= 180);
	assert.match(transcript, /CURRENT_REQUEST/);
	assert.match(transcript, /NEWEST_PERSISTED/);
	assert.match(transcript, /LIVE_PROGRESS/);
	assert.equal(transcript.match(/CURRENT_REQUEST/g)?.length, 1);
});

test("live evidence never exceeds liveMaxChars", () => {
	const config = shippedDefaults();
	config.transcript.totalChars = 500;
	config.transcript.liveMaxChars = 30;
	const transcript = buildTranscript([], config, [`${"old ".repeat(50)}LIVE_TAIL`]);
	assert.ok(transcript.length <= 30);
	assert.match(transcript, /LIVE_TAIL/);
});

test("scarce transcript budget protects current and persisted evidence before live and old framing", () => {
	const config = shippedDefaults();
	config.transcript.totalChars = 70;
	config.transcript.currentUserReserveChars = 40;
	config.transcript.persistedReserveChars = 40;
	const transcript = buildTranscript([
		{ type: "compaction", summary: "OLD_FRAMING" },
		{ type: "message", message: { role: "user", content: "CURRENT_REQUEST" } },
		{ type: "message", message: { role: "assistant", content: "NEWEST_PERSISTED" } },
	], config, ["LIVE_EVIDENCE"]);
	assert.ok(transcript.length <= 70);
	assert.match(transcript, /CURRENT_REQUEST/);
	assert.match(transcript, /NEWEST_PERSISTED/);
	assert.doesNotMatch(transcript, /LIVE_EVIDENCE|OLD_FRAMING/);
});

test("long assistant and tool-result entries retain trailing errors and next steps", () => {
	const config = shippedDefaults();
	config.transcript.assistantChars = 90;
	config.transcript.toolResultChars = 80;
	const entries = [
		{ type: "message", message: { role: "user", content: "Fix the release blocker without changing scope." } },
		{
			type: "message",
			message: {
				role: "assistant",
				content: `Started investigation. ${"background ".repeat(30)}Next: rerun the focused package tests.`,
			},
		},
		{
			type: "message",
			message: {
				role: "toolResult",
				toolName: "test",
				content: `Test output ${"passing line ".repeat(30)}ERROR: timeout while closing the final handle.`,
			},
		},
	];
	const transcript = buildTranscript(entries, config);
	assert.match(transcript, /Fix the release blocker/);
	assert.match(transcript, /Next: rerun the focused package tests\./);
	assert.match(transcript, /ERROR: timeout while closing the final handle\./);
	assert.ok(transcript.length <= config.transcript.totalChars);
});

test("the total transcript cap also preserves the tail of one oversized recent entry", () => {
	const config = shippedDefaults();
	config.transcript.assistantChars = 500;
	config.transcript.totalChars = 100;
	const transcript = buildTranscript([
		{ type: "message", message: { role: "user", content: "Investigate the failure." } },
		{
			type: "message",
			message: { role: "assistant", content: `${"progress ".repeat(80)}NEXT_STEP_SURVIVES` },
		},
	], config);
	assert.ok(transcript.length <= config.transcript.totalChars);
	assert.match(transcript, /NEXT_STEP_SURVIVES/);
});

test("recap defaults to the active model with configured no-reasoning and cache policy", async () => {
	const config = shippedDefaults();
	const active = model("anthropic", "claude-sonnet");
	const calls = [];
	const recap = await generateRecap("User: continue", "away", recapContext({ active }), config, undefined,
		async (selected, _context, options) => {
			calls.push({ selected, options });
			return response("Continue the task with the active model.");
		});
	assert.equal(recap, "Continue the task with the active model.");
	assert.equal(calls[0].selected, active);
	assert.equal(calls[0].options.reasoning, "off");
	assert.equal(calls[0].options.cacheRetention, "none");
	assert.equal(calls[0].options.maxTokens, 256);
});

test("active model follows an explicitly configured Luna auth failure", async () => {
	const config = shippedDefaults();
	config.model.candidates = ["openai-codex/gpt-5.6-luna", "$active"];
	const active = model("anthropic", "claude-sonnet");
	const luna = model("openai-codex", "gpt-5.6-luna");
	const attempted = [];
	const ctx = recapContext({
		active,
		models: [luna],
		auth: async (selected) => {
			attempted.push(selected);
			return selected === luna ? { ok: false } : { ok: true, apiKey: "active" };
		},
	});
	const recap = await generateRecap("User: continue", "away", ctx, config, undefined,
		async (selected) => response(`Used ${selected.id}`));
	assert.equal(recap, "Used claude-sonnet");
	assert.deepEqual(attempted, [luna, active]);
});

test("active model follows an explicitly configured Luna completion failure", async () => {
	const config = shippedDefaults();
	config.model.candidates = ["openai-codex/gpt-5.6-luna", "$active"];
	const active = model("anthropic", "claude-sonnet");
	const luna = model("openai-codex", "gpt-5.6-luna");
	const attempted = [];
	const recap = await generateRecap("User: continue", "away", recapContext({ active, models: [luna] }), config, undefined,
		async (selected) => {
			attempted.push(selected);
			if (selected === luna) throw new Error("Luna unavailable");
			return response("Active fallback recap.");
		});
	assert.equal(recap, "Active fallback recap.");
	assert.deepEqual(attempted, [luna, active]);
});

test("explicit configured model remains highest priority", async () => {
	const config = shippedDefaults();
	config.model.candidates = ["anthropic/claude-haiku", ...config.model.candidates];
	const override = model("anthropic", "claude-haiku");
	const selected = [];
	await generateRecap("User: continue", "away", recapContext({
		active: model("openai-codex", "gpt-5.6-sol"),
		models: [override],
	}), config, undefined, async (candidate) => {
		selected.push(candidate);
		return response("Override recap.");
	});
	assert.deepEqual(selected, [override]);
});

test("nested model IDs are resolved after the first slash", async () => {
	const config = shippedDefaults();
	config.model.candidates = ["openrouter/anthropic/claude-sonnet"];
	const nested = model("openrouter", "anthropic/claude-sonnet");
	const selected = [];
	await generateRecap("User: continue", "away", recapContext({ models: [nested] }), config, undefined, async (candidate) => {
		selected.push(candidate);
		return response("Nested model recap.");
	});
	assert.deepEqual(selected, [nested]);
});

test("unsupported final custom API is skipped", async () => {
	const config = shippedDefaults();
	config.model.candidates = ["$active"];
	const recap = await generateRecap("User: bridge", "away", recapContext({
		active: model("bridge", "bridge-model", "claude-bridge"),
	}), config, undefined, async () => {
		throw new Error("No API provider registered for api: claude-bridge");
	});
	assert.equal(recap, undefined);
});

test("safe templates only interpolate named text values", () => {
	assert.equal(renderTextTemplate("Done: {{done}}", { done: "read files" }), "Done: read files");
	assert.throws(() => renderTextTemplate("{{constructor}}", { done: "x" }), /unknown value/);
	assert.throws(() => renderTextTemplate("{{#if done}}boom{{/if}}", { done: "x" }), /invalid interpolation/);
	assert.throws(() => renderTextTemplate("{{(() => process.exit())()}}", {}), /invalid interpolation/);
	assert.throws(() => renderTextTemplate("{{{done}}}", { done: "x" }), /invalid interpolation/);
	assert.throws(() => renderTextTemplate("{{done}}}", { done: "x" }), /invalid interpolation/);
	assert.equal(renderTextTemplate("Object {done}: {{done}}", { done: "x" }), "Object {done}: x");
});

test("structured live response parses plain and fenced JSON", () => {
	const config = shippedDefaults();
	assert.equal(
		parseRecapResponse('{"done":"tests added","current":"typecheck","next":"review"}', "live", config),
		"Done: tests added\nNow: typecheck\nNext: review",
	);
	assert.equal(
		parseRecapResponse('```json\n{"done":"A","current":"B","next":"C"}\n```', "live", config),
		"Done: A\nNow: B\nNext: C",
	);
});

test("malformed structured output uses configured fallback", () => {
	const config = shippedDefaults();
	config.response.malformedFallback = "safe fallback";
	assert.equal(parseRecapResponse("not json", "live", config), "safe fallback");
	assert.equal(parseRecapResponse('{"done":5}', "live", config), "safe fallback");
});
