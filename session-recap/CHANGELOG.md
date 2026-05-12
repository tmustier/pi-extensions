# Changelog

## [0.1.3] - 2026-05-12

### Fixed
- Defer focus-triggered recaps while the agent is still active, matching Claude Code's away-summary pending behavior and avoiding duplicate/stale recaps during slow tool calls.
- Cancel stale in-flight recap drafts when a new turn starts.
- Skip `/resume` and `/fork` recap generation in headless/non-UI sessions.
- Read registered flag values using bare flag names (for example `recap-idle-seconds`, not `--recap-idle-seconds`) so automatic trigger configuration actually takes effect.
- Invoke recap generation with no reasoning, no prompt-cache retention, and `maxTokens: 256`.

### Added
- Add `--recap-during-active` to opt back into focus-triggered recaps while an agent turn is still running.

## [0.1.2] - 2026-05-07

### Changed
- Declare the `@earendil-works` Pi peer and development dependencies used by runtime imports.
- Update Pi extension imports to the new `@earendil-works` namespace.

## v0.1.0

- Initial release.
- Two triggers: DECSET `?1004` focus reporting + idle fallback on `turn_end`.
- Auto-recap on `/resume` and `/fork`.
- `/recap` command for manual generation.
- Defaults to the user's active model with `reasoning: "minimal"` when supported, for zero-auth-surprise behaviour across built-in and custom providers.
- Flags: `--recap-idle-seconds`, `--recap-focus-min-seconds`, `--recap-disable-focus`, `--recap-disable`, `--recap-model`.
- Draft stamping by branch-leaf id to avoid regenerating on focus-out/in churn without new session activity.
- Idle fallback armed on `turn_end` rather than `agent_end` so errored/aborted turns still get a recap.
- Robust focus-event parser that advances through its buffer so completed sequences never fire twice across chunk boundaries.
- Per-call `AbortController` ownership so late-completing aborted requests can't clear state for a newer in-flight request.
- Quick refocus (< `--recap-focus-min-seconds`) now also cancels any in-flight focus draft, preventing a slow model response from bypassing the suppression.
