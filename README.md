# pi-extensions

Personal extensions for the [Pi coding agent](https://github.com/badlogic/pi-mono).

## Extensions

| Extension | Description |
|-----------|-------------|
| [model-context](model-context/) | Load provider-specific context files (CLAUDE.md, CODEX.md, GEMINI.md) |
| [tab-status](tab-status/) | Terminal tab indicators for managing parallel Pi sessions |
| [arcade](arcade/) | Games: sPIce-invaders, picman, ping, tetris |

## Quick Setup

```bash
# Model context (provider-specific guidelines)
cd model-context && ./setup.sh

# Tab status
ln -s ~/pi-extensions/tab-status/tab-status.ts ~/.pi/agent/extensions/

# Arcade games
ln -s ~/pi-extensions/arcade/*.ts ~/.pi/agent/extensions/
```

See each extension's README for details.
