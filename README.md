# pi-extensions

Personal extensions for the [Pi coding agent](https://github.com/badlogic/pi-mono).

## Extensions

| Extension | Description |
|-----------|-------------|
| [tab-status](tab-status/) | Manage as many parallel sessions as your mind can handle. Terminal tab indicators for <br>✅ done / 🚧 stuck / 🛑 timed out |
| [arcade](arcade/) | Play minigames while your tests run: 👾 sPIce-invaders, 👻 picman, 🏓 ping, 🧩 tetris, 🧱 badlogic-game |
| [ralph-wiggum](ralph-wiggum/) | Run arbitrarily-long tasks without diluting model attention. This one actually works! Inspired by [ralph-loop](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-loop) |
| [agent-guidance](agent-guidance/) | Switch between Claude/Codex/Gemini with model-specific guidance (CLAUDE.md, CODEX.md, GEMINI.md) |
| [raw-paste](raw-paste/) | Ever want to paste raw text you can edit in your command line? Now you can. `/paste` command with optional keybinding. |
| [code-actions](code-actions/) | Pick code blocks or inline snippets from assistant messages to copy, insert, or run with `/code`. |
| [relaunch](relaunch/) | Exit pi and resume the current session with `/relaunch`. |

## Quick Setup

```bash
# Tab status
ln -s ~/pi-extensions/tab-status/tab-status.ts ~/.pi/agent/extensions/

# Arcade games
ln -s ~/pi-extensions/arcade/*.ts ~/.pi/agent/extensions/

# Ralph Wiggum (long-running loops)
ln -s ~/pi-extensions/ralph-wiggum ~/.pi/agent/extensions/

# Agent guidance (provider-specific rules)
cd agent-guidance && ./setup.sh

# Paste (/paste)
ln -s ~/pi-extensions/raw-paste ~/.pi/agent/extensions/

# Code actions (/code)
ln -s ~/pi-extensions/code-actions ~/.pi/agent/extensions/

# Relaunch (/relaunch)
ln -s ~/pi-extensions/relaunch ~/.pi/agent/extensions/
```

See each extension's README for details.
