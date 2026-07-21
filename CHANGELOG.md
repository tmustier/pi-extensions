# Changelog

## [0.1.58] - 2026-07-21

### Changed
- Bundle `@tmustier/pi-ralph-wiggum` 0.2.3, which binds loops to their owning Pi session and documents how iterations share a session and use normal compaction. Thanks to @juicetin for the fix and regression test ([#50](https://github.com/tmustier/pi-extensions/issues/50), [#52](https://github.com/tmustier/pi-extensions/pull/52)), and to @rhossack and @RichardScottOZ for prompting the documentation clarification ([#46](https://github.com/tmustier/pi-extensions/issues/46)).
- Bundle `@tmustier/pi-session-recap` 0.2.2, which silently skips unsupported runtime-only custom API handlers instead of logging a recap failure. Thanks to @timvdhoorn for reporting and fixing the custom-provider failure ([#81](https://github.com/tmustier/pi-extensions/pull/81)).
- Exclude nested development `node_modules` trees from the root npm package and document pre-publish tarball inspection.

### Removed
- Remove the retired Tessl `skill-review-and-optimize` workflows. They had no configured Tessl token, reported authentication failures as successful checks, and could no longer provide useful skill review or optimization feedback.

Thanks to @popey for the advance retirement notice ([#48](https://github.com/tmustier/pi-extensions/issues/48)).

## [0.1.57] - 2026-07-17

### Changed
- `usage-extension` 0.9.1: exports save to `/tmp` by default (full path shown in the confirmation note), with a configurable `exportDir` under the `usage-extension` key in settings.json.

## [0.1.56] - 2026-07-17

### Changed
- `usage-extension` 0.9.0: Graphs-first default view with a visible view strip, `[e]` export from every view (CSV/JSON), table filtering (`/` filter, `x` hide, `a` reset) with slice-aware totals and exports, refreshed README screenshots.

## [0.1.55] - 2026-07-17

### Changed
- `usage-extension` 0.8.1: all “Worth attention” alarms lead with dollars (share in the parenthetical); “Where it went” keeps percentages.

## [0.1.54] - 2026-07-17

### Changed
- `usage-extension` 0.8.0: cache-miss taxonomy split (resume after break / model switch / prefix change), facts-first section order, and pi test providers (`faux-provider`, `fake-provider`) excluded from all stats.

## [0.1.53] - 2026-07-17

### Changed
- `usage-extension` 0.7.2: insights view polish — sectioned headers with rules, warning-coloured alarms, plain-language copy, 100-column content cap, and an explicit all-clear state.

## [0.1.52] - 2026-07-17

### Added
- `usage-extension` 0.7.1: descriptive loading messages with a live file counter — first-time build, cache-format rebuild, and incremental “updating since \<date>” states.

## [0.1.51] - 2026-07-17

### Changed
- `usage-extension` 0.7.0: insights view redesigned around materiality — conditional "Worth attention" alarms (TTL cache re-warm tax, prefix-change misses, session concentration, upfront tax, cache-leverage floor) plus always-on "Where it went" lenses (context tax, project mix, reasoning share, burn trend). Cache format v3 (one-off rebuild on first open).

## [0.1.50] - 2026-07-17

### Changed
- `usage-extension` 0.6.1: graph lines are clipped to each series' active range, removing flat zero/flat tails for late-starting or retired providers/models/thinking levels.

## [0.1.49] - 2026-07-17

### Added
- `usage-extension` 0.6.0: interactive graph explorer view (cost/tokens/messages/reasoning over time, grouped by provider/model/thinking level, cumulative or per-bucket, with legend filtering). Cache format bumped to v2. See `usage-extension/CHANGELOG.md`.

## [0.1.48] - 2026-07-17

### Added
- `usage-extension` 0.5.0: new Last 30 Days period tab (rolling 30 calendar days including today).

## [0.1.47] - 2026-07-17

### Changed
- `usage-extension` 0.4.0: `/usage` now caches per-file extraction results on disk and pre-filters session JSONL at the byte level before JSON-parsing. Warm opens drop from ~17 s to ~0.3 s on a 5.2 GB session corpus. See `usage-extension/CHANGELOG.md`.

## [0.1.42] - 2026-05-13

### Changed
- Refresh `extending-pi` and nested `skill-creator` guidance for current Pi docs, extension-first customization, and Agent Skills terminology.

## [0.1.40] - 2026-05-07

### Changed
- Declare `@earendil-works` Pi peer and development dependencies for the bundled extensions.
