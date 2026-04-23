# Changelog

## v0.1.0

- Initial release.
- Two triggers: DECSET `?1004` focus reporting + idle fallback on `turn_end`.
- Auto-recap on `/resume` and `/fork`.
- `/recap` command for manual generation.
- Defaults to the user's active model with `reasoning: "minimal"` when supported, for zero-auth-surprise behaviour across built-in and custom providers.
- Flags: `--recap-idle-seconds`, `--recap-focus-min-seconds`, `--recap-disable-focus`, `--recap-disable`, `--recap-model`.
- Draft stamping by branch-leaf id to avoid regenerating on focus-out/in churn without new session activity.
- Idle fallback armed on `turn_end` rather than `agent_end` so errored/aborted turns still get a recap.
