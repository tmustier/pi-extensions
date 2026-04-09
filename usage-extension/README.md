# /usage - Usage Statistics Dashboard

A Pi extension that displays aggregated usage statistics across all sessions.

![Usage Statistics Screenshot](screenshot.png)

## Compatibility

- **Pi version:** 0.42.4+
- **Last updated:** 2026-04-09

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

### Time Periods

| Period | Definition |
|--------|------------|
| **Today** | From midnight (00:00) today |
| **This Week** | From Monday 00:00 of the current week |
| **All Time** | All recorded sessions |

Use `Tab` or `←`/`→` to switch between periods.

### Count Modes

| Mode | Definition |
|------|------------|
| **Deduped** | Default. Deduplicates copied assistant history across branched session files |
| **Raw** | Counts every assistant message found in every session file |

Both modes scan nested session files recursively, so subagent runs are included.

### Timezone

Time periods are calculated in the local timezone where Pi runs. If you want to override it, set the `TZ` environment variable (IANA timezone, e.g. `TZ=UTC` or `TZ=America/New_York`) before launching Pi.

### Columns

| Column | Description |
|--------|-------------|
| **Provider / Model** | Provider name, expandable to show models |
| **Sessions** | Number of unique sessions |
| **Msgs** | Number of assistant messages |
| **Cost** | Total cost in USD (from API response) |
| **Tokens** | Total tokens (input + output) |
| **↑In** | Input tokens *(dimmed)* |
| **↓Out** | Output tokens *(dimmed)* |
| **Cache** | Cache read + write tokens *(dimmed)* |

### Navigation

| Key | Action |
|-----|--------|
| `Tab` / `←` `→` | Switch time period |
| `m` | Cycle count mode |
| `d` | Switch to deduped mode |
| `r` | Switch to raw mode |
| `↑` `↓` | Select provider |
| `Enter` / `Space` | Expand/collapse provider to show models |
| `q` / `Esc` | Close |

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

## Data Source

Statistics are parsed recursively from session files in `~/.pi/agent/sessions/`, including nested subagent runs such as `run-0/` directories. Each session is a JSONL file containing message entries with usage data.

In **Deduped** mode, assistant messages duplicated across branched session files are deduplicated by timestamp + total tokens (matching the extension's previous behavior and keeping totals comparable with earlier releases).

In **Raw** mode, every assistant message found in every session file is counted.

Respects the `PI_CODING_AGENT_DIR` environment variable if set.

## Changelog

See `CHANGELOG.md`.
