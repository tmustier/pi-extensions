# /usage Extension Design

## Overview

A `/usage` command that opens a TUI overlay with tabbed views showing usage stats grouped by provider and model.

---

## Layout

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│  Usage                                                                                   │
│                                                                                          │
│  [Today]  [This Week]  [All Time]                                                        │
│                                                                                          │
│  Provider / Model          Sessions  Messages     Cost     Tokens    ↑Input  ↓Output  Cache │
│  ──────────────────────────────────────────────────────────────────────────────────────────  │
│                                                                                          │
│  anthropic                       12        89   $12.45      2.3M     1.2M     0.8M   0.3M │
│    claude-opus-4-5                8        67    $9.23      1.8M     0.9M     0.6M   0.3M │
│    claude-sonnet-4                4        22    $3.22      0.5M     0.3M     0.2M      - │
│                                                                                          │
│  openai                           5        34    $4.56      0.8M     0.5M     0.3M      - │
│    gpt-5.2-codex                  5        34    $4.56      0.8M     0.5M     0.3M      - │
│                                                                                          │
│  google                           2        12    $0.89      0.3M     0.2M     0.1M      - │
│    gemini-2.5-pro                 2        12    $0.89      0.3M     0.2M     0.1M      - │
│                                                                                          │
│  ──────────────────────────────────────────────────────────────────────────────────────────  │
│  Total                           19       135   $17.90      3.4M     1.9M     1.2M   0.3M │
│                                                                                          │
│  Cache = read + write (currently only Anthropic reports cache write)                     │
│  [Tab] switch view    [q/Esc] close                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Tabs

| Tab | Time Filter |
|-----|-------------|
| **Today** | Sessions with activity today (based on session timestamp) |
| **This Week** | Sessions from the last 7 days |
| **All Time** | All sessions ever |

---

## Columns

| Column | Description |
|--------|-------------|
| **Sessions** | Number of unique session files with messages from this model |
| **Messages** | Count of assistant messages (each LLM response) |
| **Cost** | Total cost in USD |
| **Tokens** | Total tokens (input + output + cacheRead + cacheWrite) |
| **↑Input** | Input tokens (prompts, context, tool results sent to model) |
| **↓Output** | Output tokens (responses, tool calls from model) |
| **Cache** | Cache read + write tokens combined (note: only Anthropic reports cache write) |

---

## Grouping

- **Provider level**: Aggregated stats for all models under that provider
- **Model level**: Indented under provider, individual model stats
- **Total row**: Sum across all providers

---

## Interaction

| Key | Action |
|-----|--------|
| `Tab` / `Shift+Tab` | Cycle between Today → This Week → All Time |
| `q` / `Escape` | Close overlay |

---

## Data Model

```typescript
interface TokenBreakdown {
  total: number;    // input + output + cache
  input: number;    // ↑ tokens sent to model
  output: number;   // ↓ tokens from model
  cache: number;    // cacheRead + cacheWrite combined
}

interface ModelStats {
  sessions: Set<string>;  // Session IDs (for counting unique sessions)
  messages: number;
  cost: number;
  tokens: TokenBreakdown;
}

interface ProviderStats {
  sessions: Set<string>;
  messages: number;
  cost: number;
  tokens: TokenBreakdown;
  models: Map<string, ModelStats>;
}

interface TimeFilteredStats {
  providers: Map<string, ProviderStats>;
  totals: {
    sessions: number;
    messages: number;
    cost: number;
    tokens: TokenBreakdown;
  };
}

interface UsageData {
  today: TimeFilteredStats;
  thisWeek: TimeFilteredStats;
  allTime: TimeFilteredStats;
}
```

---

## Implementation

1. **Command**: Register `/usage` command
2. **Data Collection**: 
   - Use `SessionManager.listAll()` to get all sessions
   - Parse each JSONL file, extract assistant messages
   - Filter by timestamp for Today/This Week
   - Group by provider → model
3. **Overlay**: Use Pi's overlay system to render the table
4. **Tab State**: Track active tab, re-render on Tab key
