# session-recap

"While you were away" recap for Pi, modelled on Claude Code's away-summary. When you've genuinely been away from a Pi session, a short recap is drafted while you're gone and parked above the editor so it's waiting when you return.

![session-recap widget in a live Pi session](./assets/recap.png)

Built for multi-clauding / multi-pi workflows where several agent sessions run in parallel tabs.

The recap orients rather than reports: it states the high-level task first (what you're building or debugging), then the concrete next step — the last assistant message is already on screen; what you've lost after a context switch is the task thread.

## How it triggers

1. **Away timer.** The extension enables terminal focus reporting (DECSET `?1004`) on session start. After the terminal has been continuously blurred for `--recap-away-seconds` (default 90s), a recap is generated and shown, so it's parked above the editor when you refocus.
2. **Turn ends while you're away.** If the agent finishes a turn while the terminal is blurred — the prime multi-tab moment — a recap is drafted after a short debounce.
3. **Idle fallback.** Only on terminals that haven't demonstrated focus-reporting support: `--recap-idle-seconds` (default 120s) after the last `turn_end` with no input, a recap is generated anyway. The first real focus event disarms this path for the session.

Also fires automatically on `/resume` and `/fork` so you know where the prior session left off.

Clears cleanly on: next user input, new turn start, session reload, or session shutdown.

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

Defaults to the **currently active model** in your Pi session, but with recap-specific low-cost settings. This piggybacks on whatever auth you already have (including custom providers registered via `pi.registerProvider`), so there are no login surprises.

- No tools or Agent Skills are loaded into the recap call — only a compact two-tier transcript is sent (recent activity in detail, plus your earlier prompts and any compaction summary for task framing), capped at ~12k chars.
- Reasoning/thinking is disabled for the recap call.
- Prompt cache writes/reads are disabled with `cacheRetention: "none"`.
- Output is capped with `maxTokens: 256`.
- No active model or failed auth resolution → the recap is skipped silently.

Override with `--recap-model "<provider>/<id>"` if you want a specific model regardless of the session's active one.

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
| `--recap-model "<p/id>"` | (active model) | Override the default, e.g. `anthropic/claude-sonnet-4-6`. |

> v0.1's `--recap-focus-min-seconds` was removed: recaps are no longer drafted on every focus-out, so there is no quick-glance suppression to tune.

## Command

| Command | Description |
|---|---|
| `/recap` | Force-generate a recap right now, bypassing the activity gate. |

## Behaviour notes

- **Uses `turn_end`, not `agent_end`**, to arm triggers, so a turn that errors or is aborted still gets recapped — and the prompt asks the model to say so explicitly.
- **No duplicate drafts**: the last-drafted recap prompt is fingerprinted; blur/refocus churn or session metadata-only changes reuse the recap rather than regenerating.
- **Defers during active work by default**: if a trigger fires while a turn is still loading, the draft waits for the agent to finish, matching Claude Code's away-summary pending behaviour. Use `--recap-during-active` to allow mid-flight recaps.
- **Aborts on new input**: any in-flight recap request is cancelled when you start typing or a new turn begins.
- **No session persistence**: the recap lives only in the widget for the active session — nothing is stored.

## Design

See [DESIGN.md](./DESIGN.md) for the design-of-record, including a comparison with Claude Code's actual away-summary implementation.

## License

MIT
