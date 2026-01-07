# pi-extensions

Personal extensions and context files for the [Pi coding agent](https://github.com/badlogic/pi-mono).

## Quick Setup

```bash
./setup.sh
```

This copies context files to `~/.pi/agent/` and symlinks the provider-context extension. Your local copies won't be overwritten on future runs.

## Provider-Specific Context

The `provider-context.ts` extension loads different context files based on which model you're using:

| Model Provider | Context File |
|---------------|--------------|
| Anthropic (Claude) | `CLAUDE.md` |
| OpenAI / Codex | `CODEX.md` |
| Google (Gemini) | `GEMINI.md` |
| All models | `AGENTS.md` (loaded by Pi core) |

**How it works:**
- Pi core always loads `AGENTS.md` (universal guidelines)
- The extension adds provider-specific files on top
- Edit your local `~/.pi/agent/*.md` files to customize

**Configuration (optional):**

Create `~/.pi/agent/provider-context.json` to customize mappings:

```json
{
  "providers": {
    "anthropic": ["CLAUDE.md"],
    "openai": ["CODEX.md", "OPENAI.md"]
  },
  "models": {
    "claude-3-5-sonnet*": ["CLAUDE-3-5.md"],
    "o1*": ["O1.md"]
  }
}
```

## Extensions

### Provider Context
- `provider-context.ts`: Loads model-specific context files (see above)

### Utilities
- `extensions/tab-status.ts`: Updates terminal tab title with Pi run status

### Arcade Games
- `extensions/arcade/space-invaders.ts`: Lobster Invaders (`/space-invaders`)
- `extensions/arcade/ping.ts`: Ping - Pong-style (`/ping`)
- `extensions/arcade/pacman.ts`: Picman - Pi-themed Pac-Man (`/picman`)
- `extensions/arcade/tetris.ts`: Tetris (`/tetris`)
- `extensions/arcade/doom/doom.ts`: ASCII Doom - first-person raycaster (`/doom`)

## Manual Install

Add extension paths to `~/.pi/agent/settings.json`:

```json
{
  "extensions": [
    "~/pi-extensions/provider-context.ts",
    "~/pi-extensions/extensions/tab-status.ts"
  ]
}
```

Or symlink to auto-discovery directory:

```bash
ln -s ~/pi-extensions/provider-context.ts ~/.pi/agent/extensions/
```
