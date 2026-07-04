# session-recap — design & plan

> Status: **v0.2.0 — away-recap redesign**  ·  Lives in `tmustier/pi-extensions/session-recap/`
> v0.1 guessed at Claude Code's recap design; v0.2 is informed by the actual
> implementation from the leaked Claude Code source (`tmustier/cc-inv`,
> 2026-03-31): `src/services/awaySummary.ts` + `src/hooks/useAwaySummary.ts`.

## Summary

When you've genuinely been away from a Pi session, a short recap is drafted
while you're gone and parked above the editor so it's waiting when you return.
Targets the "multi-clauding / multi-pi" workflow where several agent sessions
run in parallel tabs.

```
✦ recap
You're migrating the billing tables to the v2 schema; 4 of 7 are done and
invoices.ts still fails its FK constraint. Next: fix the foreign key on
line 142.
```

## What Claude Code actually does (from cc-inv)

| Aspect | Claude Code (leaked source) | session-recap v0.2 |
|---|---|---|
| Trigger | Blur → 5-min timer → generate while still away. Refocus cancels timer + in-flight. Timer fires mid-turn → pending bit, generate at turn end if still blurred. | Same shape, but 90s default + an extra trigger: turn ends while blurred (debounced 3s). Multi-tab agent workflows context-switch faster than CC's 5 min assumes. |
| Idle fallback | None — focus state `unknown` (no DECSET 1004) = feature off. | Kept, but only armed when the terminal has *not* demonstrated focus support (no `ESC[I`/`ESC[O` seen this session). |
| Output | Persistent dim `※` transcript system message (`away_summary` subtype), excluded from API context. | Transient widget above the editor (pi-idiomatic, non-polluting), cleared on next input. |
| Model | `getSmallFastModel()` — Haiku or `ANTHROPIC_SMALL_FAST_MODEL`. Never the active model. | Active model (no auth surprises across custom providers) + `--recap-model` override. See trade-off below. |
| Context | Last **30 raw messages** + session memory, instruction appended as a user message, `skipCacheWrite: true`. | Two-tier compact text transcript (~12k char cap). 30 raw messages is only affordable at Haiku pricing; on the active model it could be 30–80k tokens per throwaway hint. |
| Prompt | "Write exactly 1-3 short sentences. Start by stating the high-level task — what they are building or debugging, not implementation details. Next: the concrete next step. **Skip status reports and commit recaps.**" | Adopted near-verbatim. This was v0.1's biggest miss — our old prompt asked for a status report, which is exactly what CC bans. |
| Dedupe | Max one summary per user turn (`hasSummarySinceLastUserTurn`). | Branch-leaf-id stamping (equivalent effect). |
| In-flight abort on refocus | Yes — summary appended to transcript late would be weird. | No — a widget landing moments after return is exactly when it helps. |

## Triggers (v0.2)

| Trigger | Detection | Behaviour |
|---|---|---|
| Away timer | DECSET `?1004` focus-out, then `--recap-away-seconds` (default 90) of continuous blur | Generate and show; the widget is parked above the editor for when you return. |
| Turn ends while away | `turn_end` while blurred, debounced `3s` | The prime multi-tab moment: the agent finished while you were in another tab. Debounce lets mid-loop `turn_end`→`turn_start` pairs pass without drafting. |
| Idle fallback | `setTimeout` armed on `turn_end`, **only when focus reporting is unproven** | Generate after `--recap-idle-seconds` (default 120) of no input. Covers terminals without `?1004`. Disarmed permanently once a real focus event is seen. |
| `/resume` / `/fork` | `session_start { reason: "resume" \| "fork" }` | Auto-recap the prior session so you know where you left off. |
| Manual | `/recap` command | Generate now, bypass the activity gate. |

All triggers share one in-flight slot (`AbortController`); the next `input`,
`agent_start`, or `turn_start` cancels drafts and clears the widget.

Removed from v0.1: draft-on-every-focus-out + reveal-on-focus-in with a
min-away threshold (`--recap-focus-min-seconds`). That design fired a model
call on every alt-tab and cancelled most of them; the blur-timer model spends
one call only after a genuine absence, and the park/reveal/cancel machinery
(`pendingRecap`, quick-glance suppression) disappears entirely.

### Focus-out during long-running agent activity

Unchanged from v0.1, and matches CC's pending bit: if an away/post-turn
trigger fires while a turn is still loading, generation is deferred to
`agent_end` (if still blurred). `--recap-during-active` opts back into
mid-flight drafts.

## Display

- `ctx.ui.setWidget("session-recap", [...], { placement: "aboveEditor" })`
- Accent-bold `✦ recap` header + up to 4 dim wrapped lines (~100 cols).
- Cleared on: user input, new turn start, session reload, session shutdown.
- **No session persistence.** CC appends a transcript message instead; for pi
  a widget is idiomatic and avoids polluting the session file.

## Model selection — decision (unchanged from v0.1)

Default must not surprise users with auth/login issues.

**Decision:** default to the **currently active model**, invoked as a tiny
throwaway completion: no tools, reasoning disabled, `cacheRetention: "none"`,
`maxTokens: 256`. Any OAuth / env-var / custom-provider credential the user
already has just works. No active model / failed auth resolution → skip
silently.

- CC uses Haiku here. We deliberately diverge: pi sessions run against
  arbitrary providers and there is no universally-available cheap model we can
  assume auth for. The cost envelope is protected by the transcript cap
  (~3k input tokens) rather than by the model choice.
- `apiKey` may legitimately be absent when `ok: true` (env/ambient-auth
  providers such as Bedrock) — only bail when auth resolution itself fails,
  and pass `env` through to `completeSimple`.
- Escape hatch: `--recap-model "<provider>/<id>"`.

> **Import note:** as of pi 0.80.x, `completeSimple`/`getModel` live in
> `@earendil-works/pi-ai/compat` — the root export dropped them, which
> silently broke v0.1.3 at runtime.

## Context fed to the model — two-tier transcript

CC's insight: the recap's job is task re-orientation, and the task framing
lives in the *conversation*, not in the last tool call. CC affords the last 30
raw messages because it pays Haiku prices; we get the same orientation for
~500 extra tokens by being selective:

**Tier 1 — task framing (cheap):**
- Most recent compaction or branch-summary entry, trimmed to 600 chars —
  already-distilled task context (pi's analog of CC's session memory).
- Up to 4 user prompts *before* the latest one, trimmed to 300 chars each.
  Old assistant text and tool results add cost, not orientation.

**Tier 2 — recent detail (since the last user message, inclusive):**
- User text (≤1200 chars), assistant text (≤1200 chars)
- Tool calls as `- <name>(<JSON args, ≤280 chars>)`
- Tool results as `Result(<name>): <text, ≤400 chars>`

Whole transcript capped at 12,000 chars (~3k tokens), so worst-case cost is
unchanged from v0.1. The same builder serves resume/fork recaps (v0.1 passed
the whole branch for resume; tier 1 now covers that need).

## Prompt

One user message plus a terse system prompt (some providers require a
non-empty instruction string). Philosophy from CC: orient, don't report.

```
The user stepped away from this coding-agent session and is coming back.
Write a short recap so they can re-enter flow.

Rules:
- Write 1-3 short sentences of plain text. No preamble, no markdown, no bullets.
- Start by stating the high-level task — what the user is building, fixing, or
  debugging — not implementation minutiae.
- End with the concrete next step, if there is one.
- Skip status reports and commit recaps; orient the reader instead.
- If the last turn was aborted or errored, say so explicitly (e.g. "aborted
  during X", "errored at Y").
- Use file/function names where they matter. Max ~400 characters.

<transcript>
…
</transcript>
```

Post-processing: whitespace collapsed to single spaces, capped at 600 chars,
soft-wrapped into ≤4 widget lines.

## Edge cases

1. **Turn still running when a trigger fires** — deferred to `agent_end` via
   the pending bit (CC-equivalent). `--recap-during-active` opts out.
2. **Repeated blur/refocus with no new activity** — branch-leaf stamping skips
   regeneration; the stamp is invalidated by `turn_end`, `turn_start`,
   `input`, and `agent_start`.
3. **Errored/aborted turns** — triggers arm on `turn_end`, which fires
   regardless of outcome; the prompt asks the model to say so explicitly.
4. **Terminal without DECSET `?1004`** — idle fallback covers it, and only
   runs there: the first real focus event disarms the idle path for the
   session. Caveat: on a supporting terminal where the user never switches
   focus, the idle path stays armed (indistinguishable) — acceptable, since
   the recap is then merely redundant, and the 120s default keeps it rare.
5. **tmux** — needs `set -g focus-events on`; documented in README. Idle
   fallback covers it otherwise.
6. **User returns mid-draft** — the draft finishes and shows; it was triggered
   by a genuine absence and lands at the "just got back" moment. Typing
   cancels and clears as always.
7. **Branch advances during a draft** — the leaf is snapshotted before the
   model call; a stale draft is discarded rather than mis-stamped.

## Non-goals

- Session persistence of recap history (CC does persist; see Display).
- Multi-recap / rolling summary across many focus cycles.
- Recap UI beyond the widget (no modal, no notifications).
- Matching CC's small-fast-model choice (see Model selection).

## Follow-ups (v0.3+)

- [ ] Optional e2e harness driving fake focus sequences + `turn_end` events
      and asserting widget state transitions (manual tmux testing works but is
      tedious).
- [ ] Consider a provider-aware cheap-model default (e.g. Haiku when the
      active provider is Anthropic) once pi exposes a reliable "sibling small
      model" lookup.
- [ ] Revisit widget wrap width — read the real terminal width from the TUI
      instead of assuming ~100 cols.
