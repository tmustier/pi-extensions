import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	getUsageStatePath,
	loadUsagePreferences,
	loadUsageSelectionState,
	parseUsagePreferences,
	parseUsageSelectionState,
	resolveUsageSelection,
	saveUsageSelectionState,
} from "../usage-extension/preferences.ts";

test("parseUsagePreferences enables view and period memory independently", () => {
	assert.deepEqual(parseUsagePreferences('{"usage-extension":{"rememberView":true}}'), {
		rememberView: true,
		rememberPeriod: false,
		commandName: "usage",
	});
	assert.deepEqual(parseUsagePreferences('{"usage-extension":{"rememberPeriod":true}}'), {
		rememberView: false,
		rememberPeriod: true,
		commandName: "usage",
	});
	assert.deepEqual(parseUsagePreferences('{"usage-extension":{"rememberView":true,"rememberPeriod":true}}'), {
		rememberView: true,
		rememberPeriod: true,
		commandName: "usage",
	});
});

test("parseUsagePreferences uses strict booleans and safe defaults", () => {
	assert.deepEqual(parseUsagePreferences('{"usage-extension":{"rememberView":"true","rememberPeriod":1}}'), {
		rememberView: false,
		rememberPeriod: false,
		commandName: "usage",
	});
	assert.deepEqual(parseUsagePreferences("not json"), {
		rememberView: false,
		rememberPeriod: false,
		commandName: "usage",
	});
});

test("parseUsagePreferences accepts a safe custom command name", () => {
	assert.deepEqual(parseUsagePreferences('{"usage-extension":{"commandName":"us-stats_2"}}'), {
		rememberView: false,
		rememberPeriod: false,
		commandName: "us-stats_2",
	});
});

test("parseUsagePreferences rejects slash-prefixed and malformed command names", () => {
	for (const commandName of ["/us", "Usage", "2usage", "usage stats", "usage:2", "", true]) {
		assert.equal(
			parseUsagePreferences(JSON.stringify({ "usage-extension": { commandName } })).commandName,
			"usage",
		);
	}
});

test("resolveUsageSelection restores each enabled dimension independently", () => {
	const remembered = { view: "insights", period: "lastWeek" };
	assert.deepEqual(
		resolveUsageSelection({ rememberView: true, rememberPeriod: false, commandName: "usage" }, remembered),
		{
			view: "insights",
			period: "allTime",
		},
	);
	assert.deepEqual(
		resolveUsageSelection({ rememberView: false, rememberPeriod: true, commandName: "usage" }, remembered),
		{
			view: "graph",
			period: "lastWeek",
		},
	);
	assert.deepEqual(resolveUsageSelection({ rememberView: true, rememberPeriod: true, commandName: "usage" }, {}), {
		view: "graph",
		period: "allTime",
	});
});

test("parseUsageSelectionState ignores unknown or malformed selections", () => {
	assert.deepEqual(parseUsageSelectionState('{"view":"table","period":"lastWeek"}'), {
		view: "table",
		period: "lastWeek",
	});
	assert.deepEqual(parseUsageSelectionState('{"view":"calendar","period":"yesterday"}'), {});
	assert.deepEqual(parseUsageSelectionState("not json"), {});
});

test("selection state persists only enabled dimensions and loads defensively", () => {
	const dir = mkdtempSync(join(tmpdir(), "usage-preferences-"));
	try {
		writeFileSync(
			join(dir, "settings.json"),
			'{"usage-extension":{"rememberView":true,"rememberPeriod":false}}',
			"utf8",
		);
		const preferences = loadUsagePreferences(dir);
		assert.deepEqual(preferences, { rememberView: true, rememberPeriod: false, commandName: "usage" });

		saveUsageSelectionState(dir, { view: "insights", period: "last30Days" }, preferences);
		assert.deepEqual(loadUsageSelectionState(dir), { view: "insights" });
		assert.deepEqual(JSON.parse(readFileSync(getUsageStatePath(dir), "utf8")), { view: "insights" });

		writeFileSync(getUsageStatePath(dir), '{"view":"broken","period":"today"}', "utf8");
		assert.deepEqual(loadUsageSelectionState(dir), { period: "today" });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("disabled selection memory clears stale state and does not create a new file", () => {
	const dir = mkdtempSync(join(tmpdir(), "usage-preferences-disabled-"));
	try {
		writeFileSync(getUsageStatePath(dir), '{"view":"table","period":"today"}', "utf8");
		saveUsageSelectionState(
			dir,
			{ view: "table", period: "today" },
			{ rememberView: false, rememberPeriod: false, commandName: "usage" },
		);
		assert.throws(() => readFileSync(getUsageStatePath(dir), "utf8"), { code: "ENOENT" });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
