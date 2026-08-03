# session-recap

A configurable recap widget for Pi. It covers terminal absence, idle turns, resumed sessions, manual `/recap`, and long active agent runs.

Default live output:

```text
✦ recap
Done: Added config loading and tests.
Now: Running the typecheck.
Next: Fix any type errors, then review the diff.
```

## Install

Install the standalone npm package:

```bash
pi install npm:@tmustier/pi-session-recap
```

Or install it from this extension collection:

```bash
pi install git:github.com/tmustier/pi-extensions
```

To load only this extension from the collection, filter it in `~/.pi/agent/settings.json`:

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

## Triggers and lifecycle

- **Live:** starts with `agent_start`. The first eligible model call is 120 seconds later. After a recap becomes visible, the next live call waits at least 90 seconds and requires meaningful new streaming, tool, or finalized-message activity.
- **Away:** continuous terminal blur arms a 90-second timer through DECSET `?1004` focus reporting.
- **Turn ended while away:** a 3-second debounce handles the common multi-tab completion case.
- **Idle:** after `turn_end`, used only until the terminal proves that focus events work.
- **Resume/fork:** runs after `session_start` for the prior branch.
- **Manual:** `/recap` runs immediately and has priority over an automatic request.

Events update an in-memory live snapshot; they do not call the model. One polling scheduler owns live calls. It includes current `message_update` text, `tool_execution_start/update/end`, finalized messages, turn boundaries, and the persisted branch. This covers one long tool, continuous output, and multi-turn loops.

Only one recap call runs at a time. A completed snapshot may be slightly stale if work advanced during generation; request ownership prevents an older call from overwriting a newer one. New user input and session shutdown abort active calls. `agent_end` stops the live scheduler. `lifecycle.liveWidgetOnAgentEnd` selects `keep` or `clear`.

## Configuration

[`defaults.json`](defaults.json) is the shipped, authoritative full default configuration. Put partial strict-JSON overrides at:

1. `~/.pi/agent/session-recap.json`, or `$PI_CODING_AGENT_DIR/session-recap.json`
2. `<ctx.cwd>/.pi/session-recap.json`
3. the path in `$PI_SESSION_RECAP_CONFIG`
4. the path passed through `--recap-config` (wins over the environment variable)

The project layer is loaded only when Pi reports `ctx.isProjectTrusted()`. Untrusted clones cannot change recap prompts, terminal focus sequences, model selection, or other settings through `<ctx.cwd>/.pi/session-recap.json`. Global config and paths explicitly selected through the environment or CLI remain user-controlled and load regardless of project trust.

Shipped defaults have the lowest priority. The environment and CLI files are both loaded when both are set; CLI values win per key. Identical paths load once at their highest-precedence position. Objects deep-merge. Arrays replace arrays. Relative explicit paths resolve from `ctx.cwd`; `~/` expands to the home directory.

The extension reloads config on `session_start`, every `agent_start`, and before `/recap`. Reloaded prompts, model and response settings, transcript limits, widget settings, enabled gates, and live eligibility timings are read by the next applicable check or model call; an already armed one-shot timer keeps its original deadline, then rechecks `enabled.automatic` and its reason flag before starting work. `agent_start` cancels a pending resume recap. The in-memory activity buffer options (`assistantCharsPerLiveVersion`, `toolUpdateCharsPerLiveVersion`, `maxLiveEvents`, `maxLiveEventChars`, `maxRunningTools`, and `liveAssistantChars`) and the `livePollMs` interval apply on the next `agent_start`, which preserves evidence already captured by the current run. A change to focus enablement, sequences, or parser cap safely disables the old terminal mode and reattaches the new parser. Focus input sequences must be non-empty, distinct, and not prefixes of each other. Widget/status key changes clear the old keys before rendering under new ones. Cancelling manual or idle work clears its owning drafting status even when widget lifecycle clearing is disabled. A malformed file, unknown key or event, wrong type, invalid enum, unsafe focus sequence, invalid cap, or invalid model candidate rejects the whole reload. Pi logs/notifies the exact path and retains the last valid canonical JSON config, or shipped defaults if none loaded. Deprecated flags are derived afterward and never mutate that canonical state. Missing optional files are ignored.

Config is parsed only with `JSON.parse`. Prompt and output templates permit named text interpolation such as `{{transcript}}` and `{{done}}`. Unknown, nested, stray, or expression-like delimiters fail, including `{{{transcript}}}` and `{{transcript}}}`; ordinary single braces remain valid prose. There is no `eval`, module loading, Handlebars logic, or code execution.

### Example

```json
{
  "timings": {
    "liveFirstMs": 180000,
    "liveMinIntervalMs": 120000
  },
  "model": {
    "candidates": ["anthropic/claude-haiku", "$active"],
    "maxTokens": 192
  },
  "response": {
    "template": "Done: {{done}}\nNow: {{current}}\nNext: {{next}}"
  },
  "lifecycle": {
    "liveWidgetOnAgentEnd": "clear"
  }
}
```

### Full field reference

- `enabled`: toggles `automatic`, `manual`, `away`, `idle`, `resume`, `live`, and `focusReporting` independently.
- `timings`: `awayMs`, `idleMs`, `postTurnDebounceMs`, `resumeDelayMs`, `liveFirstMs`, `liveMinIntervalMs`, and scheduler `livePollMs`.
- `focus`: terminal `enableSequence`, `disableSequence`, `inSequence`, `outSequence`, parser `inputBufferCap`, `allowAwayDuringAgent`, and `finishDraftAfterRefocus`.
- `activity`: persisted recap `assistantMinWords`; live dirty thresholds `assistantCharsPerLiveVersion` and `toolUpdateCharsPerLiveVersion`; allowed `liveEvents`; snapshot `maxLiveEvents` and `maxLiveEventChars`; running-tool map cap `maxRunningTools`. Missing tool-end events evict the oldest running record first at this cap.
- `transcript`: caps for `earlierUserPrompts`, `earlierPromptChars`, `compactionSummaryChars`, `userChars`, `assistantChars`, `toolArgumentsChars`, `toolResultChars`, total input `totalChars`, current-request reserve `currentUserReserveChars`, newest persisted-detail reserve `persistedReserveChars`, live-section cap `liveMaxChars`, and current stream `liveAssistantChars`. The reserves protect the current request and newest persisted evidence before remaining space goes to high-priority live evidence; older framing uses only leftover space. Scarce budgets scale the protected sections proportionally. Rendered order remains framing, current request, persisted detail, live activity.
- `model`: ordered `candidates` (`provider/id` or `$active`; IDs may contain further `/` characters), `reasoning`, `cacheRetention`, `maxTokens`, `fallbackOnAuthError`, `fallbackOnCompletionError`, and `silentUnsupportedApi`.
- `prompts`: `system` plus reason-specific `away`, `idle`, `resume`, `manual`, and `live`. Reason prompts may interpolate only `{{transcript}}`.
- `response.modes`: `plain` or `json` per reason. Default live mode is JSON; other reasons stay plain.
- `response`: structured `fields`, deterministic `template`, `malformedFallback`, `emptyFieldFallback`, and visible `maxChars`.
- `widget`: `key`, `statusKey`, `header`, theme color names, `wrapWidth`, `maxBodyLines`, `placement`, and `draftingStatus`.
- `lifecycle`: `clearOnInput`, `clearOnAgentStart`, `clearOnTurnStart`, `liveWidgetOnAgentEnd`, `clearOnSessionShutdown`, and `persistWidgetAcrossResume`.

The defaults file gives exact types and current values. JSON arrays replace defaults, so include `$active` explicitly when active-model fallback is wanted. Timing zero means immediate where allowed; `livePollMs` stays positive. Every timing value must be at most Node's timer limit, `2147483647` ms. Zero prompt-count or per-component transcript caps disable that component. Transcript allocation reserves and the live-section cap, model/output/widget caps, focus parser capacity, running-tool cap, and activity dirty thresholds must stay positive integers.

## Models, output, cost

The sole default candidate is `$active`, so the package does not send transcript data to a provider other than the one already active in Pi. Auth or completion failure falls through only when more candidates are explicitly configured and the matching policy flag is enabled. Runtime-only custom APIs unsupported by `pi-ai/compat` can be skipped silently. Reasoning is off, cache retention is none, output is capped at 256 tokens, and transcript input is capped at 12,000 characters by default.

To opt in to Luna first, configure the provider explicitly:

```json
{
  "model": {
    "candidates": ["openai-codex/gpt-5.6-luna", "$active"]
  }
}
```

Live mode requests evidence-bound JSON fields `done`, `current`, and `next`. Plain or fenced JSON is accepted. Wrong field types or malformed output display the configured safe fallback. Away, idle, resume, and manual modes default to plain text but can select the same JSON path.

At defaults, a continuously active run costs at most one recap request after two minutes and another no sooner than 90 seconds after the prior recap becomes visible, when meaningful activity exists. Actual provider billing follows the selected model. Raise `liveFirstMs` or `liveMinIntervalMs`, remove expensive candidates, or set `enabled.live` to `false` to reduce cost.

## Terminal focus behavior

The extension writes DECSET `?1004` on session start and listens for `ESC[I` and `ESC[O`. iTerm2, Ghostty, Alacritty, Kitty, WezTerm, xterm, VS Code, and Warp generally support it. For tmux:

```text
set -g focus-events on
```

Apple Terminal may need the idle fallback. Set `enabled.focusReporting` to `false` if focus events interfere with input. The idle path remains available.

## Flags and migration

Canonical configuration is JSON. `--recap-config <path>` is the supported selector. These old flags remain as deprecated final in-memory overrides:

- `--recap-away-seconds`
- `--recap-idle-seconds`
- `--recap-disable-focus`
- `--recap-during-active`
- `--recap-disable`
- `--recap-model provider/id`

Migrate them to `timings.awayMs`, `timings.idleMs`, `enabled.focusReporting`, `focus.allowAwayDuringAgent`, `enabled.automatic`, and `model.candidates`. The removed v0.1 `--recap-focus-min-seconds` has no replacement because quick focus changes do not call the model.

## Residual constraints

Protocol event names, request ownership, abort behavior, JSON parsing, required `done/current/next` semantics, SHA-256 deduplication, and the no-code template grammar remain implementation invariants. Making them configurable would weaken correctness or security. Widgets are not written into the session transcript or persisted across process shutdown. Focus support still depends on the terminal or multiplexer forwarding DECSET `?1004` events.

See [DESIGN.md](DESIGN.md) for the state model.
