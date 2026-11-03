# pi-extensions

Example extensions for the [Pi coding agent](https://github.com/badlogic/pi-mono). These are the first Pi extensions I ever created and are meant to inspire you on some things you can do with Pi. I still use some of these, but note that if you want the maintainer's (my) pi setup, most of it is currently here https://github.com/tmustier/vibes.

## Extensions

| Extension | Description |
|-----------|-------------|
| [/readfiles](files-widget/) | In-terminal file browser and viewer widget. Navigate files, view diffs, select code, send comments to agent - without leaving Pi, and without interrupting your agent |
| [tab-status](tab-status/) | Manage as many parallel sessions as your mind can handle. Terminal tab indicators for <br>✅ done / 🚧 stuck / 🛑 timed out |
| [pi-ralph-wiggum](pi-ralph-wiggum/) | Run arbitrarily-long tasks without diluting model attention. Flat version without subagents like [ralph-loop](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-loop) |
| [agent-guidance](agent-guidance/) | Switch between Claude/Codex/Gemini with model-specific guidance (CLAUDE.md, CODEX.md, GEMINI.md) |
| [/usage](usage-extension/) | 📊 Usage statistics dashboard. See cost, tokens, and messages by provider/model across Today, This Week, Last Week, This Month, Last 30 Days, and All Time — with a compact view for narrow terminals |
| [/paste](raw-paste/) | Paste editable text, not [paste #1 +21 lines]. Running `/paste` with optional keybinding |
| [/code](code-actions/) | Pick code blocks or inline snippets from assistant messages to copy, insert, or run with `/code` |
| [session-recap](session-recap/) | While-you-were-away recap above the editor when you return to a session. Keeps you in flow while multi-clauding |
| [arcade](arcade/) | Play minigames while your tests run: 👾 sPIce-invaders, 👻 picman, 🏓 ping, 🧩 tetris, 🍄 mario-not |

## Agent Skills

| Agent Skill | Description |
|-------------|-------------|
| [extending-pi](extending-pi/) | Guide for extending Pi — decide between Agent Skills, extensions, prompt templates, themes, models/providers, or packages. |
| [pi-ralph-wiggum](pi-ralph-wiggum/) | Agent Skill instructions for long-running development loops. |

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

## Update notices

Pi 1.5 and later use each package's `UPDATE_NOTES.md` for short startup notices.
The first launch records the version without showing old notes. Pi's
`collapseChangelog` setting reduces notices to one line per package.

Pi cannot filter a package's notes by the extensions you load. The root bundle
and Arcade therefore include only changes that affect every extension in that
package. A change to Tetris alone will not notify someone who loads only Ping.
Individual npm packages, such as `@tmustier/pi-files-widget`, have their own
notes and version history. Their notes do not appear when loaded through the
root bundle or a wrapper in another package such as Vibes.

The full history stays in `CHANGELOG.md` and each extension's `CHANGELOG.md`.
Releases with no meaningful change for the relevant users have no startup entry.
No additional prompts, notifications or model messages are registered.

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
    "~/pi-extensions/pi-ralph-wiggum",
    "~/pi-extensions/agent-guidance/agent-guidance.ts",
    "~/pi-extensions/raw-paste",
    "~/pi-extensions/code-actions",
    "~/pi-extensions/session-recap",
    "~/pi-extensions/usage-extension"
  ]
}
```

For agent-guidance, also run the setup script:
```bash
cd ~/pi-extensions/agent-guidance && ./setup.sh
```

See each extension's README for details.
