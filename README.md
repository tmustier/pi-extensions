# pi-extensions

Personal extensions for the [Pi coding agent](https://github.com/badlogic/pi-mono).

## Extensions

| Extension | Description |
|-----------|-------------|
| [agent-guidance](agent-guidance/) | Switch between Claude/Codex/Gemini with model-specific guidance (CLAUDE.md, CODEX.md, GEMINI.md)
| [tab-status](tab-status/) | Manage as many parallel sessions as your mind can handle: terminal tab indicators for ✅ done, 🚧 stuck , and 🛑 timed out
| [arcade](arcade/) | Play minigames while you wait for CI: 👾 sPIce-invaders, 👻 picman, 🏓 ping, 🧩 tetris |

## Quick Setup

```bash
# Agent guidance (provider-specific rules)
cd agent-guidance && ./setup.sh

# Tab status
ln -s ~/pi-extensions/tab-status/tab-status.ts ~/.pi/agent/extensions/

# Arcade games
ln -s ~/pi-extensions/arcade/*.ts ~/.pi/agent/extensions/
```

See each extension's README for details.
