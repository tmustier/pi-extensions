---
name: extending-pi
description: Guide for extending Pi — decide between skills, extensions, prompt templates, themes, context files, or custom models, then scaffold files, configure manifests, and package them. Use when someone wants to extend Pi, add capabilities, create a skill, build an extension, make a Pi package, scaffold extension files, or configure a manifest.json.
---

# Extending Pi

Help the user decide what to build, scaffold the right files, and point to detailed guidance.

## What to build

| Goal | Build a… | Key files to create | Where |
|------|----------|-------------------|-------|
| Teach Pi a workflow or how to use a tool/API/CLI | **Skill** | `SKILL.md` with YAML frontmatter + markdown body | Read `skill-creator/SKILL.md` for detailed guidance |
| Give Pi a new tool, command, or runtime behavior | **Extension** | `manifest.json` + `src/index.ts` entry point | Read Pi docs: `docs/extensions.md` |
| Reuse a prompt pattern with variables | **Prompt template** | `.md` file with `{{variable}}` placeholders | Read Pi docs: `docs/prompt-templates.md` |
| Set project-wide coding guidelines | **Context file** | `AGENTS.md` in project root or `.pi/agent/` — just markdown | No extra docs needed |
| Change Pi's appearance | **Theme** | `theme.json` with color and font definitions | Read Pi docs: `docs/themes.md` |
| Add a model or provider | **Custom model** | `models.json` or extension with provider registration | Read Pi docs: `docs/models.md` (JSON) or `docs/custom-provider.md` (extension) |
| Share any of the above | **Package** | `manifest.json` with dependencies and entry points | Read Pi docs: `docs/packages.md` |

## Skill vs Extension — the fuzzy boundary

If `bash` + instructions can do it, prefer a **Skill** (simpler, no code to maintain). If you need event hooks, typed tools, UI components, or policy enforcement, use an **Extension**.

Examples:
- "Pi should know our deploy process" → **Skill** (workflow instructions)
- "Pi should confirm before `rm -rf`" → **Extension** (event interception)
- "Pi should use Brave Search" → **Skill** (instructions + CLI scripts)
- "Pi should have a structured `db_query` tool" → **Extension** (registerTool)

## Minimal working examples

**Skill** — place in `.pi/skills/my-skill/SKILL.md`:
```markdown
---
name: my-skill
description: Does X when the user asks to Y.
---
# My Skill
Step 1: ...
Step 2: ...
```

**Extension** — create `manifest.json` + `src/index.ts`:
```json
{ "name": "my-extension", "version": "0.1.0", "entry": "src/index.ts" }
```
```typescript
import { registerTool } from "@anthropic/pi-sdk";
registerTool("my_tool", { description: "..." }, async (input) => { /* ... */ });
```

## Quick-start steps

1. **Pick the artifact type** from the table above.
2. **Scaffold the files** — create the key files using the minimal examples above.
3. **Validate locally**:
   - Skills: place `SKILL.md` in `.pi/skills/<name>/` and invoke the skill — if it doesn't trigger, check that `name` and `description` in frontmatter are set correctly.
   - Extensions: run `pi ext install .` — if it fails with "missing entry", verify the `entry` path in `manifest.json` points to an existing file.
4. **Package and share** — follow `docs/packages.md` to bundle and publish.
