# pi-extensions

Personal extensions for the [Pi coding agent](https://github.com/badlogic/pi-mono).

## Extensions

| Extension | Description |
|-----------|-------------|
| [/files](files-widget/) | In-terminal file browser and viewer. Navigate files, view diffs, select code, send comments to agent - all without leaving Pi |
| [tab-status](tab-status/) | Manage as many parallel sessions as your mind can handle. Terminal tab indicators for <br>✅ done / 🚧 stuck / 🛑 timed out |
| [ralph-wiggum](ralph-wiggum/) | Run arbitrarily-long tasks without diluting model attention. Flat version without subagents like [ralph-loop](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-loop) |
| [agent-guidance](agent-guidance/) | Switch between Claude/Codex/Gemini with model-specific guidance (CLAUDE.md, CODEX.md, GEMINI.md) |
| [/usage](usage-extension/) | 📊 Usage statistics dashboard. See cost, tokens, and messages by provider/model across Today, This Week, All Time |
| [/paste](raw-paste/) | Paste editable text, not [paste #1 +21 lines]. Running `/paste` with optional keybinding |
| [/code](code-actions/) | Pick code blocks or inline snippets from assistant messages to copy, insert, or run with `/code` |
| [arcade](arcade/) | Play minigames while your tests run: 👾 sPIce-invaders, 👻 picman, 🏓 ping, 🧩 tetris, 🍄 mario-not |

## Install (pi package manager)

```bash
pi install git:github.com/tmustier/pi-extensions
```

To enable only a subset, replace the package entry in `~/.pi/agent/settings.json` with a filtered one:

```json
{
  "packages": [
    {
      "source": "git:github.com/tmustier/pi-extensions",
      "extensions": ["files-widget/index.ts"]
    }
  ]
}
```

## Quick Setup

If you keep a local clone, add extensions to your `~/.pi/agent/settings.json`:

```json
{
  "extensions": [
    "~/pi-extensions/files-widget",
    "~/pi-extensions/tab-status/tab-status.ts",
    "~/pi-extensions/arcade/spice-invaders.ts",
    "~/pi-extensions/arcade/ping.ts",
    "~/pi-extensions/arcade/picman.ts",
    "~/pi-extensions/arcade/tetris.ts",
    "~/pi-extensions/arcade/mario-not/mario-not.ts",
    "~/pi-extensions/ralph-wiggum",
    "~/pi-extensions/agent-guidance/agent-guidance.ts",
    "~/pi-extensions/raw-paste",
    "~/pi-extensions/code-actions",
    "~/pi-extensions/usage-extension"
  ]
}
```

For agent-guidance, also run the setup script:
```bash
cd ~/pi-extensions/agent-guidance && ./setup.sh
```

See each extension's README for details.
