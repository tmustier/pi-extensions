# pi-extensions

Personal extensions for the [Pi coding agent](https://github.com/badlogic/pi-mono).

## Extensions

| Extension | Description |
|-----------|-------------|
| [tab-status](tab-status/) | Manage as many parallel sessions as your mind can handle. Terminal tab indicators for <br>✅ done / 🚧 stuck / 🛑 timed out |
| [ralph-wiggum](ralph-wiggum/) | Run arbitrarily-long tasks without diluting model attention. Flat version without subagents like [ralph-loop](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-loop) |
| [agent-guidance](agent-guidance/) | Switch between Claude/Codex/Gemini with model-specific guidance (CLAUDE.md, CODEX.md, GEMINI.md) |
| [/usage](usage-extension/) | 📊 Usage statistics dashboard. See cost, tokens, and messages by provider/model across Today, This Week, All Time |
| [/paste](raw-paste/) | Paste editable text, not [paste #1 +21 lines]. Running `/paste` with optional keybinding |
| [/code](code-actions/) | Pick code blocks or inline snippets from assistant messages to copy, insert, or run with `/code` |
| [/relaunch](relaunch/) | WIP BEING DEVELOPED - Exit pi and resume the current session with `/relaunch`. |
| [arcade](arcade/) | Play minigames while your tests run: 👾 sPIce-invaders, 👻 picman, 🏓 ping, 🧩 tetris, 🍄 not-mario aka badlogic-game |

## Quick Setup

Add extensions to your `~/.pi/agent/settings.json`:

```json
{
  "extensions": [
    "~/pi-extensions/tab-status/tab-status.ts",
    "~/pi-extensions/arcade/spice-invaders.ts",
    "~/pi-extensions/arcade/ping.ts",
    "~/pi-extensions/arcade/picman.ts",
    "~/pi-extensions/arcade/tetris.ts",
    "~/pi-extensions/arcade/badlogic-game/badlogic-game.ts",
    "~/pi-extensions/ralph-wiggum",
    "~/pi-extensions/agent-guidance/agent-guidance.ts",
    "~/pi-extensions/raw-paste",
    "~/pi-extensions/code-actions",
    "~/pi-extensions/usage-extension",
    "~/pi-extensions/relaunch"
  ]
}
```

For agent-guidance, also run the setup script:
```bash
cd ~/pi-extensions/agent-guidance && ./setup.sh
```

See each extension's README for details.
