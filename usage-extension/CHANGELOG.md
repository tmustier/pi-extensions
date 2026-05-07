# Changelog

## [0.3.2] - 2026-05-07

### Changed
- Declare the `@earendil-works` Pi peer and development dependencies used by runtime imports.
- Update Pi extension imports to the new `@earendil-works` namespace.

## 0.3.1 - 2026-04-19
- **Cost-only insights.** The Insights view now weights every insight by recorded USD cost, with no tokens fallback. The headline question is now "What's contributing to your cost?" and every bullet reads "X% of your cost …". Periods with no recorded cost show an explicit empty state instead of silently switching unit.
- **Long-running sessions use true lifetime.** The 8h+ insight now looks at each session's global lifetime across all session files, not just the span visible inside the selected period slice.
- **Exact ±2 min parallel window.** The "4+ sessions in parallel" insight now uses a precise ±120000 ms two-pointer sweep instead of rounded minute buckets. A message at second 1 of minute M and another at second 59 of minute M+2 are correctly treated as ~178 s apart (outside the window).
- **Empty states.** Insights view now distinguishes three cases: no usage recorded in the period, usage but no cost data, and usage with cost but no insights clearing the 1% threshold.
- **Narrow-terminal compact hint is hidden in Insights mode** (it only applied to the table layout).
- **"Cache miss" bullet relabelled** to "of your cost came from >100k-token uncached prompts" — same math, more accurate wording.
- **Messages with missing/invalid timestamps are excluded** from the parallel-sessions sweep so that older/incomplete logs don't inflate the insight by collapsing into a single synthetic instant.

## 0.3.0 - 2026-04-19
- Add an **Insights** view to `/usage` (press `v` to toggle). Surfaces Claude-style narrative characteristics of your usage for the active time period:
  - `X% of your usage was while 4+ sessions ran in parallel`
  - `X% of your usage was at >150k context`
  - `X% of your usage hit a >100k-token cache miss`
  - `X% of your usage came from sessions active for 8+ hours`
  - `X% of your usage came from your top 5 sessions`
- Insights are weighted by cost when cost data is recorded, otherwise by tokens, with a small footer noting which basis is in use.
- Insights are independent characteristics of usage (they overlap), not a breakdown — the view makes this explicit.

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
