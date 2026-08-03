# session-recap design

## Package boundary

`session-recap` is available as a standalone npm package and as one extension in the `pi-extensions` collection. Runtime code for this extension is:

- `index.ts`: Pi event, timer, focus, widget, and cancellation adapter
- `config.ts`: strict JSON loading, validation, precedence, deep merge, deprecated flag mapping
- `recap.ts`: transcript, safe templates, model fallback, response parsing
- `live-state.ts`: deterministic scheduler state and in-memory streaming/tool snapshot
- `ui-state.ts`: request-owned drafting-status cleanup
- `defaults.json`: all consumer-tunable defaults

## Configuration boundary

Each reload is atomic:

```text
shipped defaults < global < project < explicit env < explicit CLI
```

The project layer participates only when `ctx.isProjectTrusted()` is true. This prevents an untrusted clone from configuring prompts or terminal focus sequences. Global, explicit environment, and explicit CLI layers remain user-controlled. Environment and CLI overrides are separate deep-merged layers; identical paths load once at their highest-precedence position.

Each present override must parse as JSON, contain only known keys and events, match default value types, and pass semantic checks for enums, focus sequences, integer counts, caps, and Node's `2147483647` ms timer limit. Objects deep-merge; arrays replace. One bad layer rejects the reload and preserves the last valid canonical JSON config; deprecated flags derive a separate effective copy. Files are data, never imported or executed. Reload clears renamed widget/status keys and safely detaches then reattaches changed focus reporting configuration.

Most reloaded values are read by the next applicable eligibility check, render, or model call. Already armed one-shot timers retain their deadlines. Activity-buffer sizing and dirty-threshold options plus the polling interval are fixed for an active run and apply on the next `agent_start`; replacing them mid-run would discard captured evidence.

The text template grammar recognizes only `{{identifier}}`. Prompts receive `transcript`; the structured response template receives configured string fields. Nested or stray delimiters, unknown names, and expression syntax fail safely; ordinary single braces remain prose.

Protocol invariants stay in code: Pi event names, single-request ownership, abort rules, safe JSON extraction, `done/current/next` structured semantics, and transcript dedupe hashing. Configuration cannot replace parsers or callbacks.

## Live scheduler

`agent_start` resets `LiveRecapState`, resets `LiveActivityBuffer`, and starts one polling interval. Events only update memory and increment an activity version after configured thresholds. They never start model calls.

Eligibility requires:

1. an active agent run;
2. live and automatic recap enabled;
3. at least `liveFirstMs` since `agent_start`;
4. at least `liveMinIntervalMs` since the prior successful live recap completed and became visible;
5. `activityVersion > lastRequestedVersion`;
6. no recap request in flight.

A tool start is meaningful immediately, so one tool running longer than two minutes remains eligible. Empty assistant text does not dirty the run. Streaming assistant and tool updates refresh their current snapshot every event but dirty the scheduler only when configured cumulative character thresholds are crossed. Completed/error tools become capped final events and are removed from the running-tool map. If end events never arrive, `activity.maxRunningTools` bounds the map by evicting its oldest insertion deterministically. All live text caps retain bounded head and tail evidence; running-tool formatting reserves room for the `latest:` result after long arguments. Tool end, finalized assistant message, and turn end are meaningful boundaries. Event and character caps bound memory.

A request snapshots transcript text and activity version before awaiting the model. Later progress does not invalidate that result: a slightly stale recap remains useful. Only the current request owner may display, so an aborted or replaced request cannot overwrite a newer recap. The completion timestamp starts the next refresh interval, preventing slow calls from producing back-to-back widgets. Manual recap aborts and replaces automatic work. Input and shutdown abort. `agent_end` stops polling; config chooses whether the widget stays or clears. If clearing cancels the live request that owned the shared slot, one pending away recap is rescheduled when the terminal remains blurred and automatic away recap is still enabled.

## Away, idle, resume, and manual paths

Away focus reporting uses DECSET `?1004`. Continuous blur and turn-end debounce share the same request slot as live recap. By default, away generation waits until `agent_end` when an agent loop is active. Deferred zero-delay away work uses a generation token: a newer schedule invalidates the older one, while refocus, keyboard input, focus shutdown, and session shutdown invalidate all pending work. Keyboard input also clears stale blurred state. The idle fallback runs only until a real focus event proves focus reporting works. Resume/fork uses the persisted branch; `agent_start` cancels its timer. Every delayed automatic callback rechecks `enabled.automatic` and its reason flag when it fires. Manual recap includes the in-memory snapshot when available and has highest request priority.

Automatic non-live recaps use a hash of the exact capped transcript to avoid duplicate calls. Live dirty versions handle active refreshes instead.

## Model and response pipeline

Candidate strings resolve in configured order by splitting at the first `/`, so model IDs may contain further slashes. `$active` resolves at call time. It is the sole shipped default, preventing implicit cross-provider transcript disclosure. Other providers, including Luna, require an explicit candidate override. Auth and completion failure may fall through according to policy. Calls use configured system prompt, reason prompt, reasoning, cache retention, and token cap.

Plain mode normalizes text. JSON mode accepts a plain object or a fenced JSON object, validates configured fields as strings, fills empty fields, and renders a deterministic text template. Malformed output uses a configured fixed fallback. Default live output is `Done / Now / Next` and the prompt forbids unsupported claims. Transcript capping first allocates explicit reserves to the current request and newest persisted detail. When those protected reserves exceed the total cap, they scale proportionally. Live evidence receives the remaining space up to `liveMaxChars`; older framing uses only what remains after that. Sections render in readable chronological order. Long user, assistant, tool-result, and live entries retain bounded head and tail text so their latest error, progress, or next step survives per-entry limits.

## Rate and cost

Defaults permit the first active recap at 120 seconds, then require 90 seconds after each successful visible live recap plus meaningful activity. Model latency cannot increase concurrency or compress visible refreshes because there is one request slot and completion-based throttling. Input is capped at 12,000 characters and output at 256 tokens. Provider billing still applies; disabling live recap or increasing intervals is the cost control.

## Display and persistence

The extension uses `ctx.ui.setWidget` above the editor. Header, colors, width, line cap, status text, placement, and lifecycle clears are configurable. Recaps do not enter model conversation history or persist to the session file.
