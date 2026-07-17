# Changelog

## [0.6.0] - 2026-07-17

### Added
- **Interactive graph explorer.** New third view mode (cycle with `v`): a braille line chart of usage over time for the active period, with a legend showing per-series totals and shares.
  - Metrics (`m`): cost, tokens, messages, reasoning tokens.
  - Grouping (`g`): by provider, by model, by thinking level, or total only — top 6 series plus an `other` rollup, with a bold Total line always drawn.
  - Cumulative running totals or per-bucket rates (`c`), hourly buckets for day/week periods and daily buckets for Last 30 Days / All Time.
  - Legend filtering: `↑`/`↓` moves the cursor, `Enter`/`Space` hides or shows a series, `a` shows all. The y-axis rescales to the visible series so small series can be inspected by hiding large ones.
- **Thinking level and reasoning tokens.** Session parsing now replays `thinking_level_change` entries (compact and spaced JSON styles) to attribute a thinking level to each assistant message, and records `usage.reasoning` token counts. Messages before the first recorded change appear as `unknown`.

### Changed
- On-disk cache format bumped to v2 (per-message thinking level and reasoning tokens). The first open after upgrading does a one-off full rebuild; older caches are ignored safely.

## [0.5.0] - 2026-07-17

### Added
- **Last 30 Days period.** New tab between Last Week and All Time covering the last 30 calendar days including today (from midnight 29 days back, DST-safe). Available in both the table and insights views.

## [0.4.0] - 2026-07-17

### Performance
- `/usage` no longer re-reads and JSON-parses every session JSONL file on every open. On a real 5.2 GB / 3,310-file corpus, warm opens went from ~17 s to ~0.3 s (~50×) and the one-off cold build from ~17 s to ~7 s, with peak memory roughly halved.
- **On-disk cache.** Per-file extraction results are persisted to `<agentDir>/usage-extension-cache.json` (respects `PI_CODING_AGENT_DIR`), keyed by file size + mtime. Only new or changed session files are re-parsed; entries for deleted files are evicted. Deleting the cache file forces a full rebuild — it is recreated automatically.
- **Buffer-level pre-filter.** Session files are scanned as raw bytes and only lines that can be a session header or an assistant message are UTF-8-decoded and JSON-parsed; the multi-megabyte tool-result lines that dominate session files are skipped with a cheap byte search. Both compact (`"role":"assistant"`) and spaced (`"role": "assistant"`, seen in imported third-party session files) JSON styles are matched.
- Changed files are parsed with bounded concurrency, and a cancelled cold build persists partial progress so the next open resumes instead of restarting.

### Changed
- Data collection, caching, and insights moved from `index.ts` into `usage-extension/data.ts`, with tests in `tests/usage-data.test.mjs`. Verified equivalent to the previous parser across all 3,310 real session files (zero extraction mismatches).
- Files without a session header (which are ignored, as before) no longer register their messages in the branch-dedupe hash set, so an identical message in a later, valid session file is now counted instead of silently dropped.

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
