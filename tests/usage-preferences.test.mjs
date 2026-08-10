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
	});
	assert.deepEqual(parseUsagePreferences('{"usage-extension":{"rememberPeriod":true}}'), {
		rememberView: false,
		rememberPeriod: true,
	});
	assert.deepEqual(parseUsagePreferences('{"usage-extension":{"rememberView":true,"rememberPeriod":true}}'), {
		rememberView: true,
		rememberPeriod: true,
	});
});

test("parseUsagePreferences uses strict booleans and safe defaults", () => {
	assert.deepEqual(parseUsagePreferences('{"usage-extension":{"rememberView":"true","rememberPeriod":1}}'), {
		rememberView: false,
		rememberPeriod: false,
	});
	assert.deepEqual(parseUsagePreferences("not json"), { rememberView: false, rememberPeriod: false });
});

test("resolveUsageSelection restores each enabled dimension independently", () => {
	const remembered = { view: "insights", period: "lastWeek" };
	assert.deepEqual(resolveUsageSelection({ rememberView: true, rememberPeriod: false }, remembered), {
		view: "insights",
		period: "allTime",
	});
	assert.deepEqual(resolveUsageSelection({ rememberView: false, rememberPeriod: true }, remembered), {
		view: "graph",
		period: "lastWeek",
	});
	assert.deepEqual(resolveUsageSelection({ rememberView: true, rememberPeriod: true }, {}), {
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
		assert.deepEqual(preferences, { rememberView: true, rememberPeriod: false });

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
			{ rememberView: false, rememberPeriod: false },
		);
		assert.throws(() => readFileSync(getUsageStatePath(dir), "utf8"), { code: "ENOENT" });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
