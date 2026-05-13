---
name: extending-pi
description: Guide for changing or extending Pi's behaviour. Use when someone wants to modify how Pi behaves, add capabilities, decide which Pi extension point or artifact to use, build or package an extension, create an Agent Skill, add prompt templates/themes/context/model providers, configure Pi resources, or asks whether a Pi internal patch is needed.
---

# Extending Pi

Help the user choose what to build, scaffold the right artifact, and package it when useful.

This skill is intentionally **not** an API reference. Pi's docs, examples, and installed TypeScript types are the source of truth for exact signatures and current behavior.

## Core principle: choose an extension point first, patch last

Pi has multiple public extension points: Agent Skills, context files, prompt templates, themes, packages, model configuration, provider extensions, settings, and TypeScript extensions. Do not jump straight to a TypeScript extension or Pi internal patch.

Before editing Pi internals:

1. **State the desired user-visible behavior** in one sentence.
2. **Choose what to build** from the table below. Ask whether the need is instructions, configuration, a reusable package, a runtime hook/tool/UI, or a core bug fix.
3. **Read the current docs for the chosen surface.** Use `docs/extensions.md` and `examples/extensions/README.md` when the chosen surface is a TypeScript extension; otherwise start with the artifact-specific docs in the table.
4. **Inspect at least one relevant working example** and adapt that pattern where possible.
5. **Inspect installed types/source if the docs or examples are ambiguous** rather than guessing API names or signatures. Useful starting points for extensions include `dist/core/extensions/types.d.ts`, `dist/core/index.d.ts`, and the matching `src/` files when available.
6. **Only consider a Pi internal patch after the public-extension-point audit fails.** If a patch is still needed, record the docs/examples/source checked and explain why no existing extension point can cover the case. Prefer proposing the smallest public extension API addition when the behavior should be user-extensible.

Patch-level changes are appropriate for core bugs, missing primitives, or behavior that genuinely cannot be expressed through public Pi extension points such as extensions, Agent Skills, prompt templates, themes, packages, settings, or model/provider configuration.

## What to build

| Goal | Build a… | Key files / locations | Detailed source of truth |
|------|----------|-----------------------|--------------------------|
| Teach an agent a workflow, domain, or how to use a tool/API/CLI | **Agent Skill** | `SKILL.md` plus optional `scripts/`, `references/`, `assets/` in `.agents/skills/`, `.pi/skills/`, or a package | Read `skill-creator/SKILL.md` and Pi docs `docs/skills.md` |
| Change Pi runtime behavior, add a typed tool, command, keybinding, event hook, UI, resource loader, provider, renderer, safety gate, or session behavior | **Extension** | TypeScript extension file in `.pi/extensions/`, `~/.pi/agent/extensions/`, or a Pi package | Read Pi docs `docs/extensions.md` plus relevant `examples/extensions/` code first |
| Reuse a prompt pattern with variables | **Prompt template** | Markdown file in `.pi/prompts/`, `~/.pi/agent/prompts/`, or a package | Read `docs/prompt-templates.md` |
| Set project-wide or user-wide instructions | **Context file** | `AGENTS.md`, `CLAUDE.md`, `SYSTEM.md`, or `APPEND_SYSTEM.md` as appropriate | Read the README Context Files / System Prompt sections |
| Change Pi's appearance | **Theme** | JSON theme in `.pi/themes/`, `~/.pi/agent/themes/`, or a package | Read `docs/themes.md` |
| Add or route models/providers | **models.json** or a **provider extension** | `~/.pi/agent/models.json` for supported APIs; extension for OAuth, dynamic discovery, or custom streaming | Read `docs/models.md` and `docs/custom-provider.md` |
| Share any of the above | **Pi package** | `package.json` with a `pi` key or conventional `extensions/`, `skills/`, `prompts/`, `themes/` directories | Read `docs/packages.md` |

## Agent Skill terminology

Use **Agent Skill** / **Agent Skills** when referring to the artifact, rather than client-specific names. Skills follow the Agent Skills standard and can be used by multiple agent clients. It is fine to say "Pi loads Agent Skills from…" when discussing Pi-specific discovery paths.

## Agent Skill vs Extension

If instructions plus normal tools are enough, prefer an **Agent Skill**. If the harness itself must change behavior, prefer an **Extension**.

Examples:

- "Pi should know our deploy process" → **Agent Skill** (workflow instructions and maybe helper scripts)
- "Pi should confirm before `rm -rf`" → **Extension** (intercept tool calls)
- "Pi should use Brave Search" → **Agent Skill** if a CLI/script plus instructions is enough; **Extension** if it needs a typed tool, custom UI, or runtime integration
- "Pi should have a structured `db_query` tool" → **Extension**
- "Pi should change the footer, add plan mode, add subagents, or alter compaction" → **Extension**

## Behavior-change audit checklist

Use this checklist whenever the request is to modify Pi's behavior:

1. Decide the lightest artifact that could satisfy the request: Agent Skill, context file, prompt template, theme, model config/provider, settings, package, TypeScript extension, docs-only guidance, or core patch.
2. If the likely answer is a TypeScript extension, map it to a current extension capability: events, tools, commands, shortcuts, flags, UI, custom rendering, resource discovery, model/provider registration, session/compaction hooks, tool operations, or packaging.
3. Read the relevant docs for that artifact and any linked docs (`docs/extensions.md`, `docs/tui.md`, `docs/themes.md`, `docs/models.md`, `docs/custom-provider.md`, `docs/packages.md`, etc.).
4. Inspect a matching example when one exists, especially under `examples/extensions/` for TypeScript extensions, and copy its structure rather than inventing from memory.
5. If still unsure, grep/read the installed Pi types or source for the exact API.
6. Build using a public extension point unless the audit produces concrete evidence that none can cover the request.

## Quick-start steps

1. **Pick the artifact type** from the table above.
2. **Do the behavior-change audit** for any Pi behavior change before touching internals.
3. **Scaffold from current docs/examples**, not from stale snippets in this skill.
4. **Validate locally**:
   - Agent Skills: load with `pi --no-skills --skill /path/to/skill` or invoke `/skill:name`; if it does not trigger, check `name` and `description` frontmatter.
   - Extensions: test with `pi -e ./path/to/extension.ts`; for iterative work, put the extension in `.pi/extensions/` or `~/.pi/agent/extensions/` so `/reload` picks it up.
   - Themes/prompts/packages/models: use the relevant docs' validation/loading path, then `/reload` or restart where required.
5. **Package and share** when the result should be reusable: use `package.json` with a `pi` manifest or conventional resource directories, then test with `pi install ./path` or a git/npm source.
