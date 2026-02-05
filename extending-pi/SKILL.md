---
name: extending-pi
description: Guide for extending Pi — decide between skills, extensions, prompt templates, themes, context files, or custom models, then create and package them. Use when someone wants to extend Pi, add capabilities, create a skill, build an extension, or make a Pi package.
---

# Extending Pi

Help the user decide what to build and where to find guidance.

## What to build

| Goal | Build a… | Where |
|------|----------|-------|
| Teach Pi a workflow or how to use a tool/API/CLI | **Skill** | Read `skill-creator/SKILL.md` for detailed guidance |
| Give Pi a new tool, command, or runtime behavior | **Extension** | Read Pi docs: `docs/extensions.md` |
| Reuse a prompt pattern with variables | **Prompt template** | Read Pi docs: `docs/prompt-templates.md` |
| Set project-wide coding guidelines | **Context file** | `AGENTS.md` in project root or `.pi/agent/` — just markdown |
| Change Pi's appearance | **Theme** | Read Pi docs: `docs/themes.md` |
| Add a model or provider | **Custom model** | Read Pi docs: `docs/models.md` (JSON) or `docs/custom-provider.md` (extension) |
| Share any of the above | **Package** | Read Pi docs: `docs/packages.md` |

## Skill vs Extension — the fuzzy boundary

If `bash` + instructions can do it, prefer a **skill** (simpler, no code to maintain). If you need event hooks, typed tools, UI components, or policy enforcement, use an **extension**.

Examples:
- "Pi should know our deploy process" → **Skill** (workflow instructions)
- "Pi should confirm before `rm -rf`" → **Extension** (event interception)
- "Pi should use Brave Search" → **Skill** (instructions + CLI scripts)
- "Pi should have a structured `db_query` tool" → **Extension** (registerTool)
