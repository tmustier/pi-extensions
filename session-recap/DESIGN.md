# session-recap — design & plan

> Status: **v0.1.0 — initial release**  ·  Lives in `tmustier/pi-extensions/session-recap/`
> Mirrors the [Claude Code session recap feature](https://x.com/ClaudeDevs) for Pi.

## Summary

When you switch focus away from a Pi session and come back, Pi drops a one-line
recap above the editor so you can re-enter flow without re-reading scrollback.
Targets the "multi-clauding / multi-pi" workflow where several agent sessions
run in parallel tabs.

```
✦ recap
recap: Migrated 4 of 7 billing tables to the v2 schema; invoices.ts still fails
its FK constraint. Next: fix the foreign key on line 142.
```

## Triggers

| Trigger | Detection | Behaviour |
|---|---|---|
| Terminal focus out → in | DECSET `?1004` → `ESC[O` / `ESC[I` on stdin | Draft a recap in background on focus-out; reveal on focus-in if the out-duration ≥ `--recap-focus-min-seconds` (default 3s). |
| Idle after turn ends | `setTimeout(idleMs)` armed on `turn_end` | Generate and immediately show after `--recap-idle-seconds` (default 45s) of no user input. Idle path is the fallback for terminals without focus reporting. |
| `/resume` (and `/fork`) | `session_start { reason: "resume" \| "fork" }` | Auto-recap the prior session so you know where you left off. |
| Manual | `/recap` command | Generate now, bypass the activity gate. |

All four cancel each other cleanly via an `AbortController`; the next `input`,
`agent_start`, or new turn clears the widget.

## Display

- `ctx.ui.setWidget("session-recap", [...], { placement: "aboveEditor" })`
- Two lines: accent-bold `✦ recap` header + dim one-liner body.
- Cleared on: user input, new turn start, session reload, session shutdown.
- **No session persistence.** Recap lives only in the widget for the active session.

## Model selection — decision

Default must not surprise users with auth/login issues.

**Decision:** default to the **currently active model** with **`reasoning: "minimal"`** where supported. Trust the user's model choice — no auto-fallback to a cheap tier. If they're on Opus 4-7 the recap uses Opus 4-7. It's the only way to guarantee reliable generation across built-in + custom providers.

- Primary: `ctx.model` (whatever the user is running right now).
- Reasoning: pass `reasoningEffort: "minimal"` when `model.reasoning === true`; omit entirely otherwise.
  - Pi's own `setThinkingLevel` already clamps to model capabilities — we follow the same rule.
  - Some custom providers may not honour `reasoningEffort`; that's fine, they'll ignore it.
- Auth: `ctx.modelRegistry.getApiKeyAndHeaders(ctx.model)` — same primitive as every other pi call, so any OAuth / env-var / custom-provider credential the user already set up just works.
- Custom / local models (via `pi.registerProvider`): same path. If the provider is registered and has a key, recap works. If not, we skip silently — never fail loudly.
- No active model / no API key → skip silently, log to `console.error` for debugging.

**Escape hatch flag**

- `--recap-model "<provider>/<id>"` — force a specific model (e.g. if the user wants Sonnet 4-6 for speed regardless of what they're chatting with).

**Trade-off we're accepting**

- If the user is on a heavy model (Opus 4-7, GPT-5.4), each recap uses that model for a small one-liner task. Still cheap in absolute terms because the prompt is capped at ~12k chars and the output is one line, but not the cheapest option. We prefer "no auth surprise" over "always-cheapest".

## Context fed to the model

**Current (v0.1):** transcript of the branch since the last user prompt:
- User text (trimmed to 1200 chars)
- Assistant text (trimmed to 1200 chars)
- Tool calls as `- <name>(<JSON args, ≤280 chars>)`
- Tool results as `Result(<name>): <text, ≤400 chars>`
- Whole transcript capped at 12,000 chars.

**TODO (v0.2+):** smarter context extraction. Options to explore:
- [ ] User prompt + file diffs (from edit/write tool calls) only — compact, factual.
- [ ] Tool-call list + brief summaries (skip raw file content).
- [ ] Structured "files touched + what changed" block pre-built before the model call.
- [ ] Keep last N message entries instead of trimming each.

Trigger to revisit: recaps feel shallow, OR costs creep up on long sessions, OR we want to support much longer running tasks without a summariser pass.

## Prompt

One user message, no system prompt, no tools. Verbatim:

```
You produce a single-line recap of what the coding agent just did, so the user
can re-enter flow after switching focus back to this session.

Rules:
- Output ONE line, no preamble, no markdown.
- Format: `recap: <what happened, past tense, concrete>. Next: <one-line next step>.`
- If there is no meaningful next step, omit the `Next:` clause.
- Use file/function names where relevant. Be concrete, not vague.
- Max ~220 characters.

<transcript>
…
</transcript>
```

Post-processing: keep only the first line of the response as a belt-and-braces
guard against multi-line outputs.

## Edge cases

### 1. Focus → defocus → focus again without user input

**Current behaviour:** `handleFocusOut` re-enters `generateAndShow` if there is no in-flight request and no `draftingForFocus` flag, even if `pendingRecap` is still a perfectly valid recap for the same session state. Wasteful, and may overwrite a good recap with an identical one.

**Fix (planned):**
- Stamp each drafted recap with the current branch leaf id via `ctx.sessionManager.getLeafId()`.
- On focus-out: if `pendingRecap` exists AND its stamp matches the current leaf, skip regen entirely.
- Any new `turn_end` (or `input` / `agent_start`) invalidates the stamp.

**Related:** also gate on "has any activity happened since the previous draft?" — if nothing, reuse; if yes, regenerate.

### 2. Agent turn ends in error or abort

**Question:** does `agent_end` fire reliably on user-Escape abort and on model/transport errors? Need to verify against pi's current behaviour. `turn_end` is documented as per-turn and should fire even on partial completion.

**Fix (planned):**
- Switch the idle-timer arming from `agent_end` → **`turn_end`**. `turn_end` fires after every turn regardless of outcome and is overwritten/cleared by the next `turn_start` or by `input`. This makes the idle fallback robust to errors and aborts without needing a separate error signal.
- Focus-out path already works: `hasMeaningfulActivity` counts assistant words and tool calls, independent of success/failure. An aborted turn with partial work still qualifies.
- Add a note in the recap prompt encouraging the model to mention "aborted" / "failed" state explicitly when present in the transcript, so the one-liner is honest (e.g. `recap: Started refactor of auth.ts; aborted before tests ran. Next: resume from middleware split.`).

### 3. Terminal doesn't support DECSET ?1004

Idle fallback covers it. `--recap-disable-focus` lets the user opt out explicitly (in case the escape sequences cause weird ghost characters in a less-compliant terminal).

### 4. tmux without `focus-events on`

tmux swallows focus events unless `set -g focus-events on` is set. Document in README. Idle fallback still works.

### 5. Aborted-in-flight recap request

Already handled: `AbortController` on every `complete()` call; cancelled on input / agent_start / session_shutdown / next trigger.

### 6. Multiple pi sessions in the same terminal process

Not applicable — pi is one process per terminal tab. The stdin listener we add is scoped to the process and cleaned up on `session_shutdown`.

## Non-goals

- Session persistence of recap history (not needed — the widget is transient by design).
- Multi-recap / rolling summary across many focus cycles.
- Recap UI beyond the widget (no modal, no notifications by default).

## Release checklist — v0.1.0

### Code
- [x] Extension lives at `session-recap/index.ts`.
- [x] Default model = `ctx.model` with `reasoning: "minimal"` via `completeSimple()` when the model advertises reasoning; `--recap-model` override.
- [x] Idle timer armed on `turn_end` (not `agent_end`) so error/abort turns still get a recap.
- [x] `pendingRecap` + `lastDraftedLeafId` stamping; skip regen on focus-out if branch leaf hasn't changed.
- [x] Prompt explicitly asks the model to mention aborted/errored turn state when present.
- [x] `--recap-disable-focus` escape hatch in case DECSET `?1004` misbehaves.
- [x] Cleanup: `\x1b[?1004l` + listener removal on `session_shutdown`.

### Packaging
- [x] `session-recap/package.json` (`@tmustier/pi-session-recap` v0.1.0).
- [x] Added `./session-recap/index.ts` to root `package.json` → `pi.extensions`.
- [x] Root version bumped.

### Docs
- [x] `session-recap/README.md` — features, install, flags, terminal compatibility table.
- [x] `session-recap/CHANGELOG.md`.
- [x] Row added to repo-root `README.md`.
- [x] `DESIGN.md` retained as design-of-record.

### Release
- [ ] Follow `RELEASING.md`: commit, tag `session-recap/v0.1.0`, publish `@tmustier/pi-session-recap` + repo `pi-extensions`, push tag, GitHub release.

## Follow-ups (v0.2+)

- [ ] **Smarter context feeding**: try feeding user prompt + file diffs (from `edit`/`write` tool-call args) only, instead of the full trimmed transcript. Simpler, factual, likely cheaper. Alternative: pre-build a structured "files touched + what changed" block.
- [ ] **Verify `turn_end` really fires on every abort path** (user Escape mid-stream, provider errors, transport failures). If there's a gap, add a belt-and-braces `session_before_compact` / `session_shutdown` fallback.
- [ ] Optional: small e2e test harness to trigger fake `turn_end` / focus-in/out sequences and assert widget state transitions.
