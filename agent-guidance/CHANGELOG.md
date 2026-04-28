# Changelog

## 0.1.4 - 2026-04-28

### Changed
- Templates simplified to focus on durable behavioural overrides:
  - `CODEX.md`: replaces the previous agent-protocol prose with two blocks for OpenAI models — `<solution_persistence>` (autonomy + bias for action + persist till done + no quality-for-tokens trade) and `<validation>` (run validators before summarizing or committing; fix failures before finalizing).
  - `GEMINI.md`: replaces the empty placeholder with a `<tool_usage_rules>` block that steers Gemini to pi's `read`/`write`/`edit` tools instead of `cat`/heredoc/`sed -i`/etc.

## 0.1.3 - 2026-02-03

### Changed
- Publish metadata refresh (no runtime changes).

## 0.1.2 - 2026-02-02

### Changed
- **BREAKING:** Changed `before_agent_start` handler to use `systemPrompt` instead of deprecated `systemPromptAppend` (Pi v0.39.0+)

## 0.1.0 - 2026-01-13
- Initial release.
