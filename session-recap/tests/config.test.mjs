import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	applyDeprecatedFlagOverrides,
	configPaths,
	loadConfig,
	MAX_TIMER_DELAY_MS,
	shippedDefaults,
} from "../config.ts";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "session-recap-config-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "project");
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	return { root, agentDir, cwd, projectTrusted: true };
}

function json(path, value) {
	writeFileSync(path, JSON.stringify(value));
}

test("deep merges global, project, then explicit config", () => {
	const { root, agentDir, cwd } = fixture();
	const explicit = join(root, "explicit.json");
	json(join(agentDir, "session-recap.json"), { timings: { awayMs: 1000 }, widget: { header: "global" } });
	json(join(cwd, ".pi", "session-recap.json"), { timings: { awayMs: 2000 }, widget: { wrapWidth: 88 } });
	json(explicit, { timings: { idleMs: 3000 }, widget: { header: "explicit" } });

	const result = loadConfig({ cwd, agentDir, projectTrusted: true, explicitPath: explicit }, undefined);
	assert.equal(result.valid, true);
	assert.equal(result.config.timings.awayMs, 2000);
	assert.equal(result.config.timings.idleMs, 3000);
	assert.equal(result.config.widget.header, "explicit");
	assert.equal(result.config.widget.wrapWidth, 88);
	assert.equal(result.loadedFiles.length, 3);
});

test("environment and CLI config are separate layers with CLI per-key precedence", () => {
	const { root, agentDir, cwd } = fixture();
	const envPath = join(root, "env.json");
	const cliPath = join(root, "cli.json");
	json(envPath, { timings: { awayMs: 111, idleMs: 222 }, widget: { header: "env" } });
	json(cliPath, { timings: { awayMs: 333 } });
	const result = loadConfig({
		cwd,
		agentDir,
		projectTrusted: true,
		explicitPath: cliPath,
		env: { PI_SESSION_RECAP_CONFIG: envPath },
	}, undefined);
	assert.equal(result.valid, true);
	assert.equal(result.config.timings.awayMs, 333);
	assert.equal(result.config.timings.idleMs, 222);
	assert.equal(result.config.widget.header, "env");
	assert.deepEqual(result.loadedFiles, [envPath, cliPath]);
});

test("identical environment and CLI config paths load once", () => {
	const { root, agentDir, cwd } = fixture();
	const path = join(root, "shared.json");
	json(path, { timings: { awayMs: 321 } });
	const options = { cwd, agentDir, projectTrusted: true, explicitPath: path, env: { PI_SESSION_RECAP_CONFIG: path } };
	assert.equal(configPaths(options).filter((candidate) => candidate === path).length, 1);
	assert.deepEqual(loadConfig(options, undefined).loadedFiles, [path]);
});

test("a deduplicated CLI path keeps its highest-precedence position", () => {
	const { agentDir, cwd } = fixture();
	const shared = join(agentDir, "session-recap.json");
	json(shared, { timings: { awayMs: 999 } });
	json(join(cwd, ".pi", "session-recap.json"), { timings: { awayMs: 111 } });
	const result = loadConfig({ cwd, agentDir, projectTrusted: true, explicitPath: shared, env: {} }, undefined);
	assert.equal(result.config.timings.awayMs, 999);
	assert.equal(result.loadedFiles.filter((path) => path === shared).length, 1);
});

test("PI_CODING_AGENT_DIR selects the global config directory", () => {
	const { root, cwd } = fixture();
	assert.equal(
		configPaths({ cwd, projectTrusted: false, env: { PI_CODING_AGENT_DIR: join(root, "custom-agent") } })[0],
		join(root, "custom-agent", "session-recap.json"),
	);
});

test("project config is loaded only for trusted projects", () => {
	const { agentDir, cwd } = fixture();
	const globalPath = join(agentDir, "session-recap.json");
	const projectPath = join(cwd, ".pi", "session-recap.json");
	json(globalPath, { widget: { header: "global" } });
	json(projectPath, { widget: { header: "project" }, focus: { enableSequence: "untrusted-sequence" } });

	const untrusted = loadConfig({ cwd, agentDir, projectTrusted: false }, undefined);
	assert.equal(untrusted.config.widget.header, "global");
	assert.equal(untrusted.config.focus.enableSequence, shippedDefaults().focus.enableSequence);
	assert.deepEqual(untrusted.loadedFiles, [globalPath]);
	assert.equal(configPaths({ cwd, agentDir, projectTrusted: false }).includes(projectPath), false);

	const trusted = loadConfig({ cwd, agentDir, projectTrusted: true }, undefined);
	assert.equal(trusted.config.widget.header, "project");
	assert.equal(trusted.config.focus.enableSequence, "untrusted-sequence");
	assert.deepEqual(trusted.loadedFiles, [globalPath, projectPath]);
});

test("explicit environment and CLI paths remain available for untrusted projects", () => {
	const { root, agentDir, cwd } = fixture();
	const envPath = join(root, "env.json");
	const cliPath = join(root, "cli.json");
	json(envPath, { widget: { header: "env" } });
	json(cliPath, { widget: { header: "cli" } });
	const result = loadConfig({
		cwd,
		agentDir,
		projectTrusted: false,
		explicitPath: cliPath,
		env: { PI_SESSION_RECAP_CONFIG: envPath },
	}, undefined);
	assert.equal(result.config.widget.header, "cli");
	assert.deepEqual(result.loadedFiles, [envPath, cliPath]);
});

test("a missing environment config reports the exact path and retains defaults", () => {
	const { root, agentDir, cwd } = fixture();
	const path = join(root, "missing-env.json");
	const errors = [];
	const result = loadConfig({
		cwd,
		agentDir,
		projectTrusted: true,
		env: { PI_SESSION_RECAP_CONFIG: path },
	}, undefined, (message) => errors.push(message));
	assert.equal(result.valid, false);
	assert.equal(result.config.timings.liveFirstMs, 120000);
	assert.ok(errors[0].includes(path));
});

test("a missing CLI config reports the exact path and retains defaults", () => {
	const { root, agentDir, cwd } = fixture();
	const path = join(root, "missing.json");
	const errors = [];
	const result = loadConfig({ cwd, agentDir, projectTrusted: true, explicitPath: path }, undefined, (message) => errors.push(message));
	assert.equal(result.valid, false);
	assert.equal(result.config.timings.liveFirstMs, 120000);
	assert.ok(errors[0].includes(path));
});

test("unknown keys are rejected and the last valid config is retained", () => {
	const { agentDir, cwd } = fixture();
	const previous = shippedDefaults();
	previous.widget.header = "last valid";
	json(join(agentDir, "session-recap.json"), { widget: { surprise: true } });
	const errors = [];

	const result = loadConfig({ cwd, agentDir, projectTrusted: true }, previous, (message) => errors.push(message));
	assert.equal(result.valid, false);
	assert.equal(result.config.widget.header, "last valid");
	assert.match(errors[0], /invalid config .*session-recap\.json: config\.widget\.surprise is unknown/);
});

test("unsafe template syntax is rejected during config validation", async (t) => {
	for (const [name, template] of [
		["expression", "{{#if transcript}}{{transcript}}{{/if}}"],
		["nested opening delimiter", "{{{transcript}}}"],
		["stray closing delimiter", "{{transcript}}}"],
	]) {
		await t.test(name, () => {
			const { agentDir, cwd } = fixture();
			const path = join(agentDir, "session-recap.json");
			json(path, { prompts: { live: template } });
			const errors = [];
			const result = loadConfig({ cwd, agentDir, projectTrusted: true }, undefined, (message) => errors.push(message));
			assert.equal(result.valid, false);
			assert.ok(errors[0].includes(path));
			assert.match(errors[0], /invalid interpolation token/);
		});
	}
});

test("ordinary single braces remain valid in template prose", () => {
	const { agentDir, cwd } = fixture();
	json(join(agentDir, "session-recap.json"), { prompts: { live: "Object {shape}: {{transcript}}" } });
	assert.equal(loadConfig({ cwd, agentDir, projectTrusted: true }, undefined, () => {}).valid, true);
});

test("focus input sequences must be non-empty, non-overlapping, and fit the parser cap", async (t) => {
	for (const [name, focus] of [
		["empty in", { inSequence: "" }],
		["empty out", { outSequence: "" }],
		["identical", { inSequence: "same", outSequence: "same" }],
		["undersized cap", { inSequence: "long", inputBufferCap: 2 }],
		["in prefixes out", { inSequence: "A", outSequence: "AB" }],
		["out prefixes in", { inSequence: "AB", outSequence: "A" }],
	]) {
		await t.test(name, () => {
			const { agentDir, cwd } = fixture();
			json(join(agentDir, "session-recap.json"), { focus });
			assert.equal(loadConfig({ cwd, agentDir, projectTrusted: true }, undefined, () => {}).valid, false);
		});
	}
});

test("model candidates allow nested IDs and reject malformed edges", async (t) => {
	const { agentDir, cwd } = fixture();
	json(join(agentDir, "session-recap.json"), {
		model: { candidates: ["openrouter/anthropic/claude-sonnet"] },
	});
	assert.equal(loadConfig({ cwd, agentDir, projectTrusted: true }, undefined, () => {}).valid, true);

	for (const [name, candidates] of [
		["empty list", []],
		["slash only", ["/"]],
		["missing provider", ["/model"]],
		["missing model", ["provider/"]],
		["whitespace provider", [" provider/model"]],
		["whitespace model", ["provider/model "]],
	]) {
		await t.test(name, () => {
			const { agentDir, cwd } = fixture();
			json(join(agentDir, "session-recap.json"), { model: { candidates } });
			assert.equal(loadConfig({ cwd, agentDir, projectTrusted: true }, undefined, () => {}).valid, false);
		});
	}
});

test("model enums and live event names are strict", async (t) => {
	for (const [name, override] of [
		["unknown event", { activity: { liveEvents: ["message_update", "unknown"] } }],
		["reasoning", { model: { reasoning: "turbo" } }],
		["cache retention", { model: { cacheRetention: "forever" } }],
	]) {
		await t.test(name, () => {
			const { agentDir, cwd } = fixture();
			json(join(agentDir, "session-recap.json"), override);
			assert.equal(loadConfig({ cwd, agentDir, projectTrusted: true }, undefined, () => {}).valid, false);
		});
	}
});

test("required caps are positive integers and count fields are integral", async (t) => {
	for (const [name, override] of [
		["model tokens", { model: { maxTokens: 0 } }],
		["widget width", { widget: { wrapWidth: 0 } }],
		["widget lines", { widget: { maxBodyLines: 0 } }],
		["focus cap", { focus: { inputBufferCap: 0 } }],
		["response chars", { response: { maxChars: 0 } }],
		["transcript total", { transcript: { totalChars: 0 } }],
		["current user reserve", { transcript: { currentUserReserveChars: 0 } }],
		["persisted reserve", { transcript: { persistedReserveChars: 0 } }],
		["live transcript cap", { transcript: { liveMaxChars: 0 } }],
		["live event cap", { activity: { maxLiveEvents: 0 } }],
		["running tool cap", { activity: { maxRunningTools: 0 } }],
		["activity threshold", { activity: { toolUpdateCharsPerLiveVersion: 0 } }],
		["fractional count", { activity: { assistantMinWords: 1.5 } }],
	]) {
		await t.test(name, () => {
			const { agentDir, cwd } = fixture();
			json(join(agentDir, "session-recap.json"), override);
			assert.equal(loadConfig({ cwd, agentDir, projectTrusted: true }, undefined, () => {}).valid, false);
		});
	}
});

test("zero remains valid for documented immediate timing and disabled transcript components", () => {
	const { agentDir, cwd } = fixture();
	json(join(agentDir, "session-recap.json"), {
		timings: { awayMs: 0, liveFirstMs: 0, liveMinIntervalMs: 0 },
		transcript: { earlierUserPrompts: 0, earlierPromptChars: 0 },
	});
	assert.equal(loadConfig({ cwd, agentDir, projectTrusted: true }, undefined, () => {}).valid, true);
});

test("timer values accept the Node boundary and reject values above it", async (t) => {
	const timingNames = [
		"awayMs",
		"idleMs",
		"postTurnDebounceMs",
		"resumeDelayMs",
		"liveFirstMs",
		"liveMinIntervalMs",
		"livePollMs",
	];
	const { agentDir, cwd } = fixture();
	json(join(agentDir, "session-recap.json"), {
		timings: Object.fromEntries(timingNames.map((name) => [name, MAX_TIMER_DELAY_MS])),
	});
	assert.equal(loadConfig({ cwd, agentDir, projectTrusted: true }, undefined, () => {}).valid, true);

	for (const name of timingNames) {
		await t.test(`${name} above max`, () => {
			const paths = fixture();
			const errors = [];
			json(join(paths.agentDir, "session-recap.json"), { timings: { [name]: MAX_TIMER_DELAY_MS + 1 } });
			assert.equal(loadConfig(paths, undefined, (message) => errors.push(message)).valid, false);
			assert.match(errors[0], new RegExp(`config\\.timings\\.${name} must be <= ${MAX_TIMER_DELAY_MS}`));
		});
	}
});

test("deprecated second flags cannot produce timer values above the Node maximum", () => {
	const defaults = shippedDefaults();
	const result = applyDeprecatedFlagOverrides(defaults, {
		awaySeconds: String(MAX_TIMER_DELAY_MS / 1000 + 1),
		idleSeconds: String(MAX_TIMER_DELAY_MS / 1000 + 1),
	});
	assert.equal(result.timings.awayMs, defaults.timings.awayMs);
	assert.equal(result.timings.idleMs, defaults.timings.idleMs);
});

test("deprecated model override is derived from canonical config without duplicates after failed reload", () => {
	const { agentDir, cwd } = fixture();
	const canonical = shippedDefaults();
	const once = applyDeprecatedFlagOverrides(canonical, { model: "openai-codex/gpt-5.6-luna" });
	json(join(agentDir, "session-recap.json"), { model: { reasoning: "invalid" } });
	const failed = loadConfig({ cwd, agentDir, projectTrusted: true }, canonical, () => {});
	const twice = applyDeprecatedFlagOverrides(failed.config, { model: "openai-codex/gpt-5.6-luna" });
	assert.equal(failed.valid, false);
	assert.deepEqual(once.model.candidates, twice.model.candidates);
	assert.equal(twice.model.candidates.filter((candidate) => candidate === "openai-codex/gpt-5.6-luna").length, 1);
	assert.deepEqual(canonical.model.candidates, ["$active"]);
});

test("malformed JSON reports its exact path and keeps defaults", () => {
	const { agentDir, cwd } = fixture();
	const path = join(agentDir, "session-recap.json");
	writeFileSync(path, "{");
	const errors = [];
	const result = loadConfig({ cwd, agentDir, projectTrusted: true }, undefined, (message) => errors.push(message));
	assert.equal(result.valid, false);
	assert.equal(result.config.timings.liveFirstMs, 120000);
	assert.ok(errors[0].includes(path));
});
