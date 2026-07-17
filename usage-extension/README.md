# /usage - Usage Statistics Dashboard

A Pi extension that displays aggregated usage statistics across all sessions.

![Default table view of /usage](screenshot.png)

## Compatibility

- **Pi version:** 0.42.4+
- **Last updated:** 2026-07-17 (0.6.1)

## Installation

### Pi package manager

```bash
pi install npm:@tmustier/pi-usage-extension
```

```bash
pi install git:github.com/tmustier/pi-extensions
```

Then filter to just this extension in `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    {
      "source": "git:github.com/tmustier/pi-extensions",
      "extensions": ["usage-extension/index.ts"]
    }
  ]
}
```

### Local clone

Add to your `~/.pi/agent/settings.json`:

```json
{
  "extensions": [
    "~/pi-extensions/usage-extension"
  ]
}
```

## Usage

In Pi, run:
```
/usage
```

## Features

### Views

`/usage` has three view modes, cycled with `v`:

- **Table** (default) — per-provider / per-model stats with cost and token breakdown (screenshot at the top of this page).
- **Insights** — narrative characteristics of your cost for the active time period, e.g. *"X% of your cost was at >150k context"*. Insights are **independent characteristics**, not a breakdown, so they overlap and can sum to more than 100%.
- **Graphs** — an interactive braille line-chart explorer for usage over time (details below).

![Insights view of /usage](insights-screenshot.png)

**Unit:** insights are always weighted by recorded API cost (USD). Periods with no recorded cost show an explicit empty state rather than silently switching to a different unit.

### Graph explorer

The **Graphs** view plots usage over time for the active period as a braille line chart, with a legend showing per-series totals and shares.

- **Metric** (`m` to cycle): cost, tokens (input + output + cache write), messages, reasoning tokens.
- **Grouping** (`g` to cycle): by provider, by model, by thinking level, or total only. The top 6 series are shown individually; the rest merge into an `other` series. A bold **Total** line is always drawn.
- **Cumulative vs per-bucket** (`c` to toggle): running total across the period (default), or the raw per-bucket rate.
- **Filtering**: move the legend cursor with `↑`/`↓` and toggle series visibility with `Enter`/`Space` (`a` shows all again). The y-axis rescales to the visible series — hide the big lines to zoom into the small ones.
- **Buckets**: hourly for Today / This Week / Last Week, daily for Last 30 Days / All Time.
- **Line clipping**: every series (provider, model, thinking level, `other`, Total) is drawn only between its first and last bucket with usage, so late-starting or retired series don't drag a flat zero/flat tail across the whole period.

Thinking levels are replayed from `thinking_level_change` entries in each session file; messages before the first recorded change appear as `unknown`. Reasoning token counts come from `usage.reasoning` where providers report them; pi only records this field since **pi 0.80.3 (30 June 2026)**, so earlier sessions show zero reasoning tokens even though thinking models were in use.

The insights currently shown:

| Insight | Threshold |
|---|---|
| Parallel sessions | ≥ 4 sessions active within an exact ±2 min window |
| Large context | `input + cacheRead + cacheWrite > 150k` |
| Large uncached prompt | `input + cacheWrite > 100k` |
| Long-running sessions | session lifetime ≥ 8 hours (global, not per-period slice) |
| Top-session concentration | top 5 sessions by cost |

### Time Periods

| Period | Definition |
|--------|------------|
| **Today** | From midnight (00:00) today |
| **This Week** | From Monday 00:00 of the current week |
| **Last Week** | Previous week (Monday 00:00 → this Monday 00:00) |
| **Last 30 Days** | Rolling window: the last 30 calendar days including today (from midnight 29 days back) |
| **All Time** | All recorded sessions |

Use `Tab` or `←`/`→` to switch between periods.

### Timezone

Time periods are calculated in the local timezone where Pi runs. If you want to override it, set the `TZ` environment variable (IANA timezone, e.g. `TZ=UTC` or `TZ=America/New_York`) before launching Pi.

### Columns

| Column | Description |
|--------|-------------|
| **Provider / Model** | Provider name, expandable to show models |
| **Sessions** | Number of unique sessions |
| **Msgs** | Number of assistant messages |
| **Cost** | Total cost in USD (from API response) |
| **Tokens** | Fresh tokens for the turn: input + output + cache write |
| **↑In** | Fresh input tokens: input + cache write *(dimmed)* |
| **↓Out** | Output tokens *(dimmed)* |
| **Cache** | Cache read + write tokens *(dimmed; informational)* |

> **As of 0.2.0:** `Tokens = Input + Output + CacheWrite` and `↑In = Input + CacheWrite`. `CacheRead` stays out of `Tokens` so repeated cache hits don't swamp the dashboard. The dashboard itself shows a one-line footer reminder.

On narrow terminals, `/usage` automatically switches to a compact table instead of overflowing the terminal. Hidden columns reappear as soon as you widen the terminal.

### Navigation

| Key | Action |
|-----|--------|
| `Tab` / `←` `→` | Switch time period |
| `↑` `↓` | Select provider *(table)* / move legend cursor *(graphs)* |
| `Enter` / `Space` | Expand/collapse provider *(table)* / toggle series visibility *(graphs)* |
| `v` | Cycle Table → Insights → Graphs view |
| `m` | Cycle metric: cost / tokens / messages / reasoning *(graphs)* |
| `g` | Cycle grouping: provider / model / thinking level / total *(graphs)* |
| `c` | Toggle cumulative vs per-bucket *(graphs)* |
| `a` | Show all series *(graphs)* |
| `q` / `Esc` | Close |

## Performance & Caching

`/usage` builds its stats from every session JSONL file under `<agentDir>/sessions`. To keep opens fast on large histories (multi-GB, thousands of files):

- **On-disk cache.** Per-file extraction results are cached in `<agentDir>/usage-extension-cache.json` (respects `PI_CODING_AGENT_DIR`), keyed by file size + mtime. Warm opens only re-parse session files that changed since the last run — on a 5.2 GB / 3,310-file corpus that takes the open from ~17 s to ~0.3 s.
- **First open** after install (or after deleting the cache) does a one-off full build, showing the usual cancellable loader. Cancelling saves partial progress, so the next open resumes where it left off.
- The cache is safe to delete at any time; it is rebuilt automatically. Corrupt or version-mismatched caches are ignored and rebuilt rather than trusted.
- **0.6.0 bumps the cache format to v2** (adds thinking level and reasoning tokens per message). The first open after upgrading does a one-off full rebuild, then warm opens are fast again.

## Provider Notes

### Cost Tracking

Cost data comes directly from the API response (`usage.cost.total`). Accuracy depends on the provider reporting costs.

### Cache Tokens

Cache token support varies by provider:

| Provider | Cache Read | Cache Write |
|----------|------------|-------------|
| Anthropic | ✓ | ✓ |
| Google | ✓ | ✗ |
| OpenAI Codex | ✓ | ✗ |

The "Cache" column combines both read and write tokens.

`Tokens` and `↑In` include cache writes but intentionally exclude cache reads. That keeps totals aligned with fresh/billed prompt work without letting repeated cache hits swamp the dashboard.

## Data Source

Statistics are parsed recursively from session files in `~/.pi/agent/sessions/`, including nested subagent runs such as `run-0/` directories. Each session is a JSONL file containing message entries with usage data.

Assistant messages duplicated across branched session files are deduplicated by timestamp + total tokens, matching the extension's previous behavior while still including recursive subagent sessions.

Respects the `PI_CODING_AGENT_DIR` environment variable if set.

## Changelog

See `CHANGELOG.md`.
