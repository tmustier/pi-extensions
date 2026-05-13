---
name: extending-pi
description: Guide for changing or extending Pi's behaviour. Use when someone wants to modify how Pi behaves, add capabilities, decide which Pi extension point or artifact to use, build or package an extension, create an Agent Skill, add prompt templates/themes/context/model providers, configure Pi resources, or asks whether a Pi internal patch is needed.
---

# Extending Pi

Help the user choose what to build, scaffold the right artifact, and package it when useful.

This skill is intentionally **not** an API reference. Pi's docs, examples, and installed TypeScript types are the source of truth for exact signatures and current behavior.

## Core principle: choose a public extension point first, patch last

Pi has multiple public extension points: Agent Skills, context files, prompt templates, themes, packages, model configuration, provider extensions, settings, and TypeScript extensions. Do not jump straight to a TypeScript extension or Pi internal patch. Patch-level changes are appropriate for core bugs, missing primitives, or behavior that genuinely cannot be expressed through public Pi extension points.

## What to build

| Goal | Build a… | Key files / locations | Detailed source of truth |
|------|----------|-----------------------|--------------------------|
| Teach an agent a workflow, domain, or how to use a tool/API/CLI | **Agent Skill** | `SKILL.md` plus optional `scripts/`, `references/`, `assets/` in `.agents/skills/`, `.pi/skills/`, or a package | Read `skill-creator/SKILL.md` and Pi docs `docs/skills.md` |
| Change Pi runtime behavior, add a typed tool, command, keybinding, event hook, UI, resource loader, provider, renderer, safety gate, or session behavior | **Extension** | TypeScript extension file in `.pi/extensions/`, `~/.pi/agent/extensions/`, or a Pi package | Read Pi docs `docs/extensions.md` fully plus relevant `examples/extensions/` code first |
| Reuse a prompt pattern with variables | **Prompt template** | Markdown file in `.pi/prompts/`, `~/.pi/agent/prompts/`, or a package | Read `docs/prompt-templates.md` |
| Set project-wide or user-wide instructions | **Context file** | `AGENTS.md`, `CLAUDE.md`, `SYSTEM.md`, or `APPEND_SYSTEM.md` as appropriate | Read the README Context Files / System Prompt sections |
| Change Pi's appearance | **Theme** | JSON theme in `.pi/themes/`, `~/.pi/agent/themes/`, or a package | Read `docs/themes.md` |
| Add or route models/providers | **models.json** or a **provider extension** | `~/.pi/agent/models.json` for supported APIs; extension for OAuth, dynamic discovery, or custom streaming | Read `docs/models.md` and `docs/custom-provider.md` |
| Share any of the above | **Pi package** | `package.json` with a `pi` key or conventional `extensions/`, `skills/`, `prompts/`, `themes/` directories | Read `docs/packages.md` |

## Behavior-change triage

Use this before touching Pi internals:

1. **State the desired user-visible behavior** in one sentence.
2. **Choose the lightest artifact** from the table above. Ask whether the need is instructions, configuration, a reusable package, a runtime hook/tool/UI, or a core bug fix.
3. **Read the current docs for the chosen surface.** Use the table's source-of-truth column; this skill should route you, not replace the docs.
4. **Inspect a relevant working example** when one exists and adapt that pattern where possible.
5. **Only consider a Pi internal patch after the public-extension-point audit fails.** If a patch is still needed, record the docs/examples/source checked and explain why no existing extension point can cover the case. Prefer proposing the smallest public extension API addition when the behavior should be user-extensible.

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

## TypeScript extension workflow

Use this when the chosen artifact is a Pi TypeScript extension or provider extension.

Agents often miss existing Pi extension points by reading only the first matching section or doing a heading search. Before deciding a Pi patch is needed:

1. **Read `docs/extensions.md` fully.** Extension capabilities are spread across hooks, tools, commands, keybindings, resource loaders, renderers, session/compaction events, settings, and linked docs.
2. **Follow relevant linked docs** for the surface you are changing: `docs/tui.md`, `docs/themes.md`, `docs/models.md`, `docs/custom-provider.md`, `docs/packages.md`, `docs/keybindings.md`, `docs/session-format.md`, or `docs/compaction.md`.
3. **Read `examples/extensions/README.md` and at least one matching example** under `examples/extensions/`. Copy current structure rather than inventing from memory.
4. **Map the request to a current extension capability**: events, tools, commands, shortcuts, flags, UI, custom rendering, resource discovery, model/provider registration, session/compaction hooks, tool operations, or packaging.
5. **Inspect installed types/source if docs or examples are ambiguous** rather than guessing API names or signatures. Useful starting points include `dist/core/extensions/types.d.ts`, `dist/core/index.d.ts`, and the matching `src/` files when available.
6. **Build as an extension or package unless the audit produces concrete evidence that no public extension point exists.** If a patch is required, document what was checked and prefer adding the smallest public extension API that would make the behavior extensible.

## Quick-start steps

1. **Pick the artifact type** from the table above.
2. **Do the behavior-change triage** for any Pi behavior change before touching internals.
3. **For TypeScript extensions, complete the extension workflow** before deciding a patch is required.
4. **Scaffold from current docs/examples**, not from stale snippets in this skill.
5. **Validate locally**:
   - Agent Skills: load with `pi --no-skills --skill /path/to/skill` or invoke `/skill:name`; if it does not trigger, check `name` and `description` frontmatter.
   - Extensions: test with `pi -e ./path/to/extension.ts`; for iterative work, put the extension in `.pi/extensions/` or `~/.pi/agent/extensions/` so `/reload` picks it up.
   - Themes/prompts/packages/models: use the relevant docs' validation/loading path, then `/reload` or restart where required.
6. **Package and share** when the result should be reusable: use `package.json` with a `pi` manifest or conventional resource directories, then test with `pi install ./path` or a git/npm source.
