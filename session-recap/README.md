# session-recap

"While you were away" recap for Pi, modelled on Claude Code's away-summary. When you've genuinely been away from a Pi session, a short recap is drafted while you're gone and parked at the end of the scrollable transcript so it's waiting when you return. In Pi's regular TUI it stays above the editor.

![session-recap widget in a live Pi session](./assets/recap.png)

Built for multi-clauding / multi-pi workflows where several agent sessions run in parallel tabs.

The recap orients rather than reports: it states the high-level task first (what you're building or debugging), then the concrete next step — the last assistant message is already on screen; what you've lost after a context switch is the task thread.

## How it triggers

1. **Away timer.** The extension enables terminal focus reporting (DECSET `?1004`) on session start. After the terminal has been continuously blurred for `--recap-away-seconds` (default 90s), a recap is generated and shown, so it's parked above the editor when you refocus.
2. **Turn ends while you're away.** If the agent finishes a turn while the terminal is blurred — the prime multi-tab moment — a recap is drafted after a short debounce.
3. **Idle fallback.** Only on terminals that haven't demonstrated focus-reporting support: `--recap-idle-seconds` (default 120s) after the last `turn_end` with no input, a recap is generated anyway. The first real focus event disarms this path for the session.

Also fires automatically on `/resume` and `/fork` so you know where the prior session left off.

The recap disappears when you submit a message or new agent work begins. It is temporary UI: it is not saved in session history or sent to the model.

Quick alt-tabs cost nothing: no model call is made until you've actually been away for the full threshold. If you return while a recap is still drafting, it's allowed to finish — it lands moments after you're back, which is exactly when it helps.

## Terminal compatibility

| Terminal | Focus reporting | Notes |
|---|---|---|
| iTerm2, Ghostty, Alacritty, Kitty, WezTerm, xterm | ✅ | Works out of the box. |
| VS Code integrated terminal, Warp | ✅ | Works. |
| Apple Terminal | ⚠️ Partial | Idle fallback covers it. |
| tmux | ✅ (with config) | Add `set -g focus-events on` to `~/.tmux.conf`, then `tmux source-file ~/.tmux.conf`. |

If focus events cause any weirdness in your terminal, run with `--recap-disable-focus` and the idle fallback still works.

## Model

The recap reuses the active provider's authentication and chooses a cheaper model when available:

1. `--recap-model` when set.
2. `anthropic/claude-haiku-4-5` for Anthropic sessions.
3. GPT-5.6 Luna when the active model is GPT and its provider offers Luna.
4. The currently active model otherwise.

The recap sends no system prompt, no tools and no Agent Skills, and never writes to the prompt cache. Reasoning is always off: most APIs disable thinking when no reasoning level is requested, and Codex models are sent an explicit `reasoningEffort: "none"` because they would otherwise fall back to the server-side default.

It uses a 30-message window in native roles, plus the initial request and latest compaction or branch summary. Large initial requests and tool results retain their beginning and end.

Custom providers work when they use a built-in pi-ai API type. Pi-only custom handlers are skipped because the standalone compatibility layer cannot route them; use `--recap-model "<provider>/<id>"` to select a supported model.

## Install

### Pi package manager

```bash
pi install git:github.com/tmustier/pi-extensions
```

Filter to just this extension in `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    {
      "source": "git:github.com/tmustier/pi-extensions",
      "extensions": ["session-recap/index.ts"]
    }
  ]
}
```

### Local clone

```json
{
  "extensions": [
    "~/pi-extensions/session-recap/index.ts"
  ]
}
```

## Flags

| Flag | Default | Description |
|---|---|---|
| `--recap-away-seconds <n>` | `90` | Seconds of continuous terminal blur before an away recap is generated. |
| `--recap-idle-seconds <n>` | `120` | Idle-fallback delay after `turn_end`, used only when the terminal doesn't report focus. |
| `--recap-disable-focus` | `false` | Disable DECSET `?1004` focus reporting. Idle fallback still runs. |
| `--recap-during-active` | `false` | Allow away recaps while an agent turn is still running, instead of deferring to the end of the turn. |
| `--recap-disable` | `false` | Disable the automatic recap entirely. `/recap` still works. |
| `--recap-model "<p/id>"` | automatic | Override model selection, e.g. `anthropic/claude-sonnet-4-6`. |

## Command

| Command | Description |
|---|---|
| `/recap` | Force-generate a recap right now, bypassing the activity gate. |

## License

MIT
