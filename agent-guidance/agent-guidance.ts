/**
 * Provider-Specific Context Extension
 *
 * Loads different context files based on the current model's provider,
 * supplementing the core AGENTS.md loading with provider-specific additions.
 *
 * How it works:
 * - Core loads AGENTS.md (or CLAUDE.md as fallback)
 * - This extension loads provider-specific files (CLAUDE.md, CODEX.md, GEMINI.md)
 * - Skips loading if core already loaded that exact file (avoids duplication)
 *
 * Examples:
 * - Repo has AGENTS.md + CLAUDE.md → Anthropic gets both, OpenAI gets AGENTS.md + CODEX.md
 * - Repo has only CLAUDE.md → Anthropic gets CLAUDE.md, OpenAI gets CLAUDE.md + CODEX.md
 *
 * Configuration (optional):
 * Create ~/.pi/agent/provider-context.json to customize mappings:
 *
 * {
 *   "providers": {
 *     "anthropic": ["CLAUDE.md"],
 *     "openai": ["CODEX.md", "OPENAI.md"]
 *   },
 *   "models": {
 *     "claude-3-5-sonnet*": ["CLAUDE-3-5.md"],
 *     "o1*": ["O1.md"]
 *   }
 * }
 *
 * Usage:
 * 1. Copy to ~/.pi/agent/extensions/ or .pi/extensions/
 * 2. Create provider-specific files alongside your AGENTS.md
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// Built-in provider to context file mappings
const DEFAULT_PROVIDER_FILES: Record<string, string[]> = {
	anthropic: ["CLAUDE.md"],
	openai: ["CODEX.md"],
	"openai-codex": ["CODEX.md"],
	"github-copilot": ["CODEX.md"],
	google: ["GEMINI.md"],
	"google-gemini-cli": ["GEMINI.md"],
	"google-antigravity": ["GEMINI.md"],
	"google-vertex": ["GEMINI.md"],
	mistral: ["MISTRAL.md"],
	xai: ["XAI.md"],
	groq: ["GROQ.md"],
};

interface ProviderContextConfig {
	providers?: Record<string, string[]>;
	models?: Record<string, string[]>;
}

/**
 * Simple glob matching for model patterns.
 * Supports * as wildcard.
 */
function globMatch(pattern: string, value: string): boolean {
	const regex = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`, "i");
	return regex.test(value);
}

/**
 * Load configuration from ~/.pi/agent/provider-context.json
 */
function loadConfig(agentDir: string): ProviderContextConfig {
	const configPath = path.join(agentDir, "provider-context.json");
	if (fs.existsSync(configPath)) {
		try {
			return JSON.parse(fs.readFileSync(configPath, "utf-8"));
		} catch {
			// Ignore parse errors, use defaults
		}
	}
	return {};
}

/**
 * Get candidate filenames for a model/provider combination.
 */
function getCandidateFiles(modelId: string | undefined, provider: string, config: ProviderContextConfig): string[] {
	// First check model-specific patterns
	if (modelId && config.models) {
		for (const [pattern, files] of Object.entries(config.models)) {
			if (globMatch(pattern, modelId)) {
				return files;
			}
		}
	}

	// Then check provider mappings (config overrides defaults)
	if (config.providers?.[provider]) {
		return config.providers[provider];
	}

	// Fall back to built-in defaults
	return DEFAULT_PROVIDER_FILES[provider] ?? [];
}

/**
 * Check if we should load a provider file from a directory.
 * Skip if:
 * - Core already loaded the same file (to avoid duplication)
 * - AGENTS.md and provider file have identical content
 */
function shouldLoadProviderFile(dir: string, providerFile: string): boolean {
	const providerFilePath = path.join(dir, providerFile);
	if (!fs.existsSync(providerFilePath)) return false;

	const agentsMdPath = path.join(dir, "AGENTS.md");
	const agentsMdExists = fs.existsSync(agentsMdPath);
	const claudeMdExists = fs.existsSync(path.join(dir, "CLAUDE.md"));

	// Determine what core would have loaded from this directory
	// Core prefers AGENTS.md, falls back to CLAUDE.md
	const coreLoadedFile = agentsMdExists ? "AGENTS.md" : claudeMdExists ? "CLAUDE.md" : null;

	// Skip if core loaded this exact file
	if (coreLoadedFile === providerFile) return false;

	// Skip if AGENTS.md exists and has identical content to provider file
	if (agentsMdExists) {
		try {
			const agentsContent = fs.readFileSync(agentsMdPath, "utf-8");
			const providerContent = fs.readFileSync(providerFilePath, "utf-8");
			if (agentsContent === providerContent) return false;
		} catch {
			// Ignore read errors, proceed with loading
		}
	}

	return true;
}

/**
 * Walk up from cwd to root, collecting directories to check.
 * Returns in order: global → ancestors (root to cwd) → cwd
 */
function getDirectoriesToCheck(cwd: string, agentDir: string): string[] {
	const dirs: string[] = [];
	const seen = new Set<string>();

	// 1. Global agent dir
	if (fs.existsSync(agentDir) && !seen.has(agentDir)) {
		dirs.push(agentDir);
		seen.add(agentDir);
	}

	// 2. Walk up from cwd to root, collect ancestors
	const ancestors: string[] = [];
	let currentDir = cwd;
	const root = path.resolve("/");

	while (true) {
		if (!seen.has(currentDir)) {
			ancestors.unshift(currentDir); // Add to front for root→cwd order
			seen.add(currentDir);
		}

		if (currentDir === root) break;
		const parentDir = path.resolve(currentDir, "..");
		if (parentDir === currentDir) break;
		currentDir = parentDir;
	}

	dirs.push(...ancestors);
	return dirs;
}

/**
 * Load provider-specific context file content from a directory.
 */
function loadProviderFileFromDir(dir: string, candidates: string[]): { path: string; content: string } | null {
	for (const filename of candidates) {
		if (shouldLoadProviderFile(dir, filename)) {
			const filePath = path.join(dir, filename);
			try {
				return {
					path: filePath,
					content: fs.readFileSync(filePath, "utf-8"),
				};
			} catch {
				// Ignore read errors
			}
		}
	}
	return null;
}

export default function providerContextExtension(pi: ExtensionAPI) {
	const agentDir = path.join(process.env.HOME || "", ".pi", "agent");
	const config = loadConfig(agentDir);

	pi.on("before_agent_start", async (_event, ctx) => {
		const provider = ctx.model?.provider;
		if (!provider) return;

		const modelId = ctx.model?.id;
		const candidates = getCandidateFiles(modelId, provider, config);
		if (candidates.length === 0) return;

		// Collect all provider-specific context files
		const contextFiles: Array<{ path: string; content: string }> = [];
		const dirs = getDirectoriesToCheck(ctx.cwd, agentDir);

		for (const dir of dirs) {
			const file = loadProviderFileFromDir(dir, candidates);
			if (file) {
				contextFiles.push(file);
			}
		}

		if (contextFiles.length === 0) return;

		// Build the system prompt append
		let append = "\n\n# Provider-Specific Context\n\n";
		append += "The following provider-specific context files have been loaded:\n\n";
		for (const { path: filePath, content } of contextFiles) {
			append += `## ${filePath}\n\n${content}\n\n`;
		}

		return { systemPromptAppend: append };
	});
}
