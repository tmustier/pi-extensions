# Changelog

## 0.2.0 - 2026-04-19

### Changed
- **BREAKING (git-source users only):** Repo directory renamed `ralph-wiggum/` → `pi-ralph-wiggum/` so the SKILL.md `name` field matches its parent directory (both in the repo and after `pi install npm:@tmustier/pi-ralph-wiggum`). This removes the `[Skill conflicts]` warning pi emitted on every startup. Thanks to @ishanmalik for reporting ([#12](https://github.com/tmustier/pi-extensions/issues/12)).
  - npm users: no action needed — package name `@tmustier/pi-ralph-wiggum` is unchanged.
  - Git-source users referencing `~/pi-extensions/ralph-wiggum/…` in their pi config should update the path to `~/pi-extensions/pi-ralph-wiggum/…`.
- SKILL.md `name` is now `pi-ralph-wiggum` (was `ralph-wiggum`).
- Renamed the README's `Install` section to `Installation` so it matches the skill validator's expectations.

## 0.1.7 - 2026-04-19

### Fixed
- Ralph loops no longer silently stop after auto-compaction or `/compact`. On session reload, `currentLoop` is now rehydrated from the on-disk state (most-recently-updated active loop wins on ties), so `ralph_done`, `agent_end`, and `before_agent_start` continue to function. Thanks to @elecnix for the detailed report and proposed fix ([#11](https://github.com/tmustier/pi-extensions/issues/11)).

## 0.1.5 - 2026-02-03

### Added
- Add preview image metadata for the extension listing.

## 0.1.4 - 2026-02-02

### Changed
- **BREAKING:** Updated tool execute signatures for Pi v0.51.0 compatibility (`signal` parameter now comes before `onUpdate`)
- **BREAKING:** Changed `before_agent_start` handler to use `systemPrompt` instead of deprecated `systemPromptAppend` (Pi v0.39.0+)

## 0.1.3 - 2026-01-26
- Added note clarifying this is a flat version without subagents.

## 0.1.1 - 2026-01-25
- Clarified that agents must write the task file themselves (tool does not auto-create it).

## 0.1.0 - 2026-01-13
- Initial release.
