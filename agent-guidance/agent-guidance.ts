/**
 * agent-guidance - Provider-specific context loading
 *
 * Loads CLAUDE.md, CODEX.md, or GEMINI.md based on current model provider,
 * supplementing Pi Core's AGENTS.md loading.
 *
 * Deduplication:
 * - Skips if core already loaded the file (CLAUDE.md fallback case)
 * - Skips if AGENTS.md has identical content
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const PROVIDER_FILES: Record<string, string[]> = {
	anthropic: ["CLAUDE.md"],
	openai: ["CODEX.md"],
	"openai-codex": ["CODEX.md"],
	"github-copilot": ["CODEX.md"],
	google: ["GEMINI.md"],
	"google-gemini-cli": ["GEMINI.md"],
	"google-antigravity": ["GEMINI.md"],
	"google-vertex": ["GEMINI.md"],
};

interface Config {
	providers?: Record<string, string[]>;
	models?: Record<string, string[]>;
}

function loadConfig(agentDir: string): Config {
	const configPath = path.join(agentDir, "agent-guidance.json");
	if (fs.existsSync(configPath)) {
		try {
			return JSON.parse(fs.readFileSync(configPath, "utf-8"));
		} catch {
			return {};
		}
	}
	return {};
}

function globMatch(pattern: string, value: string): boolean {
	return new RegExp(`^${pattern.replace(/\*/g, ".*")}$`, "i").test(value);
}

function getCandidateFiles(modelId: string | undefined, provider: string, config: Config): string[] {
	// Model-specific patterns take priority
	if (modelId && config.models) {
		for (const [pattern, files] of Object.entries(config.models)) {
			if (globMatch(pattern, modelId)) return files;
		}
	}
	// Then provider config, then defaults
	return config.providers?.[provider] ?? PROVIDER_FILES[provider] ?? [];
}

function shouldLoad(dir: string, providerFile: string): boolean {
	const providerPath = path.join(dir, providerFile);
	if (!fs.existsSync(providerPath)) return false;

	const agentsPath = path.join(dir, "AGENTS.md");
	const agentsExists = fs.existsSync(agentsPath);
	const claudeExists = fs.existsSync(path.join(dir, "CLAUDE.md"));

	// What did core load? (prefers AGENTS.md, falls back to CLAUDE.md)
	const coreLoaded = agentsExists ? "AGENTS.md" : claudeExists ? "CLAUDE.md" : null;
	if (coreLoaded === providerFile) return false;

	// Skip if identical to AGENTS.md
	if (agentsExists) {
		try {
			const agentsContent = fs.readFileSync(agentsPath, "utf-8");
			const providerContent = fs.readFileSync(providerPath, "utf-8");
			if (agentsContent === providerContent) return false;
		} catch {
			// Proceed with loading
		}
	}

	return true;
}

function getDirectories(cwd: string, agentDir: string): string[] {
	const dirs: string[] = [];
	const seen = new Set<string>();

	// Global agent dir first
	if (fs.existsSync(agentDir)) {
		dirs.push(agentDir);
		seen.add(agentDir);
	}

	// Walk up from cwd to root
	let current = cwd;
	const ancestors: string[] = [];
	while (true) {
		if (!seen.has(current)) {
			ancestors.unshift(current);
			seen.add(current);
		}
		const parent = path.resolve(current, "..");
		if (parent === current) break;
		current = parent;
	}

	dirs.push(...ancestors);
	return dirs;
}

export default function agentGuidance(pi: ExtensionAPI) {
	const agentDir = path.join(process.env.HOME || "", ".pi", "agent");
	const config = loadConfig(agentDir);

	pi.on("before_agent_start", async (event, ctx) => {
		const provider = ctx.model?.provider;
		if (!provider) return;

		const candidates = getCandidateFiles(ctx.model?.id, provider, config);
		if (candidates.length === 0) return;

		const files: Array<{ path: string; content: string }> = [];

		for (const dir of getDirectories(ctx.cwd, agentDir)) {
			for (const filename of candidates) {
				if (shouldLoad(dir, filename)) {
					const filePath = path.join(dir, filename);
					try {
						files.push({ path: filePath, content: fs.readFileSync(filePath, "utf-8") });
					} catch {
						// Skip unreadable files
					}
				}
			}
		}

		if (files.length === 0) return;

		let append = "\n\n# Provider-Specific Context\n\n";
		for (const { path: p, content } of files) {
			append += `## ${p}\n\n${content}\n\n`;
		}

		return { systemPrompt: event.systemPrompt + append };
	});
}
