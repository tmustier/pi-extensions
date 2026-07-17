# Changelog

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
