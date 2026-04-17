# Changelog

## 0.2.1 - 2026-04-17
- Add a one-line formula footer to the `/usage` dashboard (`Tokens = Input + Output + CacheWrite  ·  ↑In = Input + CacheWrite`)
- README now calls out the 0.2.0 formula change explicitly under the columns table

## 0.2.0 - 2026-04-17
- Include `cacheWrite` in the main `Tokens` total and in the `↑In` column so providers like Anthropic that report fresh prompt work under `cacheWrite` are no longer undercounted
- Keep `cacheRead` out of `Tokens` so repeated cache hits do not swamp the dashboard
- Keep the `Cache` column as combined cache read + write tokens for reference
- Minor semver bump: the numbers shown under `Tokens` and `↑In` are now higher for Anthropic usage. Cost, `↓Out`, and `Cache` are unchanged.

## 0.1.7 - 2026-04-09
- Prevent `/usage` from crashing in narrow terminals by switching to a compact responsive table and truncating every rendered line to the terminal width
- Thanks @markokocic

## 0.1.6 - 2026-04-09
- Add a "Last Week" time period tab
- Thanks @ttttmr

## 0.1.5 - 2026-04-09
- Keep recursive subagent session scanning in `/usage`
- Remove the deduped/raw mode toggle and keep the deduped view as the default behavior

## 0.1.4 - 2026-04-09
- Scan session files recursively so nested subagent runs are included in `/usage`
- Add deduped vs raw counting modes to compare copied branch history against raw file totals

## 0.1.3 - 2026-02-03
- Add preview image metadata for the extension listing.

## 0.1.2 - 2026-01-13
- Add loading spinner while parsing session files (Esc to cancel)
- Make data loading async to keep UI responsive
- Thanks @nicobailon

## 0.1.1 - 2026-01-12
- Deduplicate assistant messages across branched sessions to avoid double-counting
- Tokens total now excludes cache read/write tokens (cache remains in Cache column)
- Thanks @nicobailon

## 0.1.0 - 2026-01-10
- Initial release
- Collapsible provider/model view
- Three time periods: Today, This Week, All Time
- Token breakdown columns (dimmed for de-emphasis)
