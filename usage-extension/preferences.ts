import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { TabName } from "./data.ts";

export type ViewMode = "table" | "insights" | "graph";

export interface UsagePreferences {
	rememberView: boolean;
	rememberPeriod: boolean;
}

export interface UsageSelection {
	view: ViewMode;
	period: TabName;
}

export interface UsageSelectionState {
	view?: ViewMode;
	period?: TabName;
}

const DEFAULT_PREFERENCES: UsagePreferences = {
	rememberView: false,
	rememberPeriod: false,
};

const VIEW_MODES = new Set<ViewMode>(["graph", "table", "insights"]);
const PERIODS = new Set<TabName>(["today", "thisWeek", "lastWeek", "last30Days", "allTime"]);

export function parseUsagePreferences(settingsJson: string): UsagePreferences {
	try {
		const parsed = JSON.parse(settingsJson) as {
			"usage-extension"?: { rememberView?: unknown; rememberPeriod?: unknown };
		};
		const settings = parsed["usage-extension"];
		return {
			rememberView: settings?.rememberView === true,
			rememberPeriod: settings?.rememberPeriod === true,
		};
	} catch {
		return { ...DEFAULT_PREFERENCES };
	}
}

export function parseUsageSelectionState(stateJson: string): UsageSelectionState {
	try {
		const parsed = JSON.parse(stateJson) as { view?: unknown; period?: unknown };
		return {
			...(typeof parsed.view === "string" && VIEW_MODES.has(parsed.view as ViewMode)
				? { view: parsed.view as ViewMode }
				: {}),
			...(typeof parsed.period === "string" && PERIODS.has(parsed.period as TabName)
				? { period: parsed.period as TabName }
				: {}),
		};
	} catch {
		return {};
	}
}

export function resolveUsageSelection(
	preferences: UsagePreferences,
	remembered: UsageSelectionState,
): UsageSelection {
	return {
		view: preferences.rememberView ? remembered.view ?? "graph" : "graph",
		period: preferences.rememberPeriod ? remembered.period ?? "allTime" : "allTime",
	};
}

export function getUsageStatePath(agentDir: string): string {
	return join(agentDir, "usage-extension-state.json");
}

export function loadUsagePreferences(agentDir: string): UsagePreferences {
	try {
		return parseUsagePreferences(readFileSync(join(agentDir, "settings.json"), "utf8"));
	} catch {
		return { ...DEFAULT_PREFERENCES };
	}
}

export function loadUsageSelectionState(agentDir: string): UsageSelectionState {
	try {
		return parseUsageSelectionState(readFileSync(getUsageStatePath(agentDir), "utf8"));
	} catch {
		return {};
	}
}

export function saveUsageSelectionState(
	agentDir: string,
	state: UsageSelection,
	preferences: UsagePreferences,
): void {
	const statePath = getUsageStatePath(agentDir);
	if (!preferences.rememberView && !preferences.rememberPeriod) {
		try {
			unlinkSync(statePath);
		} catch {
			// No remembered state to clear.
		}
		return;
	}

	const saved: UsageSelectionState = {
		...(preferences.rememberView ? { view: state.view } : {}),
		...(preferences.rememberPeriod ? { period: state.period } : {}),
	};
	const tmpPath = join(agentDir, `.usage-state-${process.pid}-${Date.now()}.tmp`);
	mkdirSync(agentDir, { recursive: true });
	try {
		writeFileSync(tmpPath, JSON.stringify(saved, null, "\t") + "\n", "utf8");
		renameSync(tmpPath, statePath);
	} catch (error) {
		try {
			unlinkSync(tmpPath);
		} catch {
			// The temporary file may not have been created or may already be gone.
		}
		throw error;
	}
}
