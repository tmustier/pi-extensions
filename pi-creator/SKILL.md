---
name: pi-creator
description: Guide for extending Pi — decide between skills, extensions, prompt templates, themes, context files, or custom models, then create and package them. Use when someone wants to extend Pi, add capabilities, create a skill, build an extension, or make a Pi package.
---

# Pi Creator

Guide for deciding what to build and how to build it when extending Pi.

## Decision Tree

**What are you trying to do?**

1. **Teach Pi a workflow or how to use a tool/API/CLI** → **Skill**
   - On-demand instructions loaded when the task matches.
   - Can include scripts, references, assets.
   - For detailed guidance: read `skill-creator/SKILL.md`.

2. **Give Pi a new runtime capability or control its behavior** → **Extension**
   - TypeScript module with full API access.
   - Use when you need: new tools, commands, event interception, UI components, policy gates, custom providers.
   - See [Extension Creation](#extension-creation) below.

3. **Reuse a prompt pattern with variables** → **Prompt Template**
   - Markdown file invoked via `/name`. Supports positional args (`$1`, `$@`).
   - See [Prompt Template Creation](#prompt-template-creation) below.

4. **Set project-wide coding guidelines** → **Context File**
   - `AGENTS.md` (always loaded), `SYSTEM.md` / `APPEND_SYSTEM.md` (system prompt), `CLAUDE.md` / `OPENAI.md` (provider-specific).
   - Place in project root or `.pi/agent/`. No special format needed — just markdown.

5. **Change Pi's appearance** → **Theme**
   - JSON file in `~/.pi/agent/themes/` or `.pi/themes/`. Copy an existing theme and modify colors.

6. **Add a model or provider** → **Custom Model**
   - Simple: add to `~/.pi/agent/models.json` (supports OpenAI-compatible, Anthropic, Google, Bedrock APIs).
   - With OAuth/custom streaming: use `pi.registerProvider()` in an extension.

7. **Share any of the above** → **Package**
   - See [Packaging](#packaging) below.

### Skill vs Extension — the fuzzy boundary

If you're unsure, ask: **does this need runtime code that the agent can't invoke via bash?**

- "Pi should know our deploy process" → **Skill** (workflow instructions).
- "Pi should have a `/deploy` command that hits our API" → **Extension** (registerCommand).
- "Pi should use Brave Search" → **Skill** (instructions + CLI scripts the agent calls via bash).
- "Pi should confirm before `rm -rf`" → **Extension** (event interception, can't be done with instructions).
- "Pi should have a structured `db_query` tool with typed params" → **Extension** (registerTool).

Rule of thumb: if `bash` + instructions can do it, prefer a skill (simpler, no code). If you need hooks, UI, typed tools, or policy enforcement, use an extension.

## Extension Creation

### Minimal extension

Create `~/.pi/agent/extensions/my-ext.ts`:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  // Event handler
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
      const ok = await ctx.ui.confirm("Dangerous!", "Allow rm -rf?");
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
  });

  // Custom tool
  pi.registerTool({
    name: "greet",
    label: "Greet",
    description: "Greet someone",
    parameters: Type.Object({
      name: Type.String({ description: "Name to greet" }),
    }),
    async execute(toolCallId, params) {
      return { content: [{ type: "text", text: `Hello, ${params.name}!` }] };
    },
  });

  // Command
  pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (args, ctx) => ctx.ui.notify(`Hello ${args || "world"}!`, "info"),
  });
}
```

Test: `pi -e ./my-ext.ts`

### Extension structure

```
my-extension.ts                    # Single file — simplest
my-extension/index.ts              # Directory — for multi-file
my-extension/                      # With deps — needs npm install
  ├── package.json
  ├── index.ts
  └── src/
```

### Key APIs

| API | Purpose |
|-----|---------|
| `pi.on(event, handler)` | React to lifecycle events |
| `pi.registerTool(def)` | Add tool the LLM can call |
| `pi.registerCommand(name, opts)` | Add `/command` |
| `pi.registerShortcut(key, opts)` | Add keyboard shortcut |
| `pi.sendMessage(msg, opts)` | Inject messages |
| `pi.appendEntry(type, data)` | Persist state |
| `pi.registerProvider(name, config)` | Add model provider |
| `ctx.ui.*` | User interaction (confirm, select, notify, etc.) |

### Events

| Event | When | Can modify? |
|-------|------|-------------|
| `session_start` | Session loads | No |
| `before_agent_start` | Before LLM call | Inject message, modify system prompt |
| `context` | Before each turn | Modify message list |
| `tool_call` | Before tool runs | Block or modify |
| `tool_result` | After tool runs | Modify result |
| `turn_end` | After turn completes | No |
| `agent_end` | After all turns | No |
| `session_before_compact` | Before compaction | Cancel or provide custom summary |
| `input` | User input received | Transform, handle, or pass through |
| `model_select` | Model changed | No |
| `session_shutdown` | Pi exiting | Cleanup |

### Imports

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";              // For enum params (Google-compatible)
import { Text, Component } from "@mariozechner/pi-tui";        // For custom rendering
import { isToolCallEventType } from "@mariozechner/pi-coding-agent"; // Typed tool events
```

### Reference

For the full API, read the Pi docs:
- Extensions: `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`
- TUI components: `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/tui.md`
- Custom providers: `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/custom-provider.md`
- Examples: `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/`

## Prompt Template Creation

Create `~/.pi/agent/prompts/my-template.md`:

```markdown
---
description: What this template does
---
Your prompt text with $1 positional args and $@ for all args.
```

Invoke: `/my-template arg1 arg2`

Variables: `$1`, `$2`, ..., `$@` (all args), `${@:2}` (args from 2nd).

Locations: `~/.pi/agent/prompts/` (global), `.pi/prompts/` (project).

## Packaging

Bundle skills, extensions, prompts, and/or themes for distribution:

```json
{
  "name": "@scope/my-pi-package",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

Or use conventional directories (`extensions/`, `skills/`, `prompts/`, `themes/`) without explicit manifest.

Install: `pi install npm:@scope/my-pi-package` or `pi install git:github.com/user/repo`.

Peer deps (don't bundle): `@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`, `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`, `@sinclair/typebox`.
