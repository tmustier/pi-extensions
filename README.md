# pi-extensions

Personal extensions for the [Pi coding agent](https://github.com/badlogic/pi-mono).

## Extensions

| Extension | Description |
|-----------|-------------|
| [agent-guidance](agent-guidance/) | Switch between Claude/Codex/Gemini with model-specific guidance (CLAUDE.md, CODEX.md, GEMINI.md) |
| [ralph-wiggum](ralph-wiggum/) | Run arbitrarily-long tasks without diluting model attention. This one actually works! Inspired by [ralph-loop](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-loop). |
| [tab-status](tab-status/) | Manage as many parallel sessions as your mind can handle. Terminal tab indicators ✅ done / 🚧 stuck / 🛑 timed out. |
| [arcade](arcade/) | Play minigames while your tests run: 👾 sPIce-invaders, 👻 picman, 🏓 ping, 🧩 tetris |

## Quick Setup

```bash
# Ralph Wiggum (long-running loops)
ln -s ~/pi-extensions/ralph-wiggum ~/.pi/agent/extensions/

# Agent guidance (provider-specific rules)
cd agent-guidance && ./setup.sh

# Tab status
ln -s ~/pi-extensions/tab-status/tab-status.ts ~/.pi/agent/extensions/

# Arcade games
ln -s ~/pi-extensions/arcade/*.ts ~/.pi/agent/extensions/
```

See each extension's README for details.
