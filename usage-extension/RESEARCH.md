# Pi Usage Data Research

## Summary

Pi tracks comprehensive usage data at the session level, with each assistant message containing full token counts and costs. This data is stored in session JSONL files but is **not aggregated** across sessions.

---

## Data Tracked Per Message

Every `AssistantMessage` includes a `Usage` object:

```typescript
interface Usage {
  input: number;        // Input tokens
  output: number;       // Output tokens  
  cacheRead: number;    // Cache read tokens (Anthropic prompt caching)
  cacheWrite: number;   // Cache write tokens
  totalTokens: number;  // Sum of all tokens
  cost: {
    input: number;      // Cost in USD
    output: number;     // Cost in USD
    cacheRead: number;  // Cost in USD
    cacheWrite: number; // Cost in USD
    total: number;      // Total cost in USD
  };
}
```

Each message also has:
- `provider`: e.g., "anthropic", "openai", "google"
- `model`: e.g., "claude-opus-4-5", "gpt-5.2-codex"
- `timestamp`: Unix timestamp in milliseconds

---

## Storage Locations

### Session Files
- **Path**: `~/.pi/agent/sessions/<cwd-encoded>/<timestamp>_<uuid>.jsonl`
- **Format**: JSONL (one JSON object per line)
- **Contents**:
  - Session header: `type: "session"`, `id`, `timestamp`, `cwd`, `parentSession?`
  - Message entries: `type: "message"` with full message objects
  - Model changes: `type: "model_change"` 
  - Thinking level changes: `type: "thinking_level_change"`
  - Compaction entries: `type: "compaction"` with `tokensBefore`

### Settings
- **Path**: `~/.pi/agent/settings.json`
- Contains user preferences (model, thinking level, extensions, etc.)

### Other Files
- `~/.pi/agent/auth.json` - API key auth
- `~/.pi/agent/oauth.json` - OAuth tokens
- `~/.pi/agent/pi-debug.log` - Debug output (not structured usage data)

---

## Current Footer Stats (Real-time)

The footer displays for the **current session only**:
```
↑45k ↓1.2k R32k W13k $0.106 45.3%/200k (auto)  claude-opus-4-5 • high
```

- `↑` Total input tokens
- `↓` Total output tokens
- `R` Total cache read tokens
- `W` Total cache write tokens
- `$X.XXX` Total cost (with "(sub)" if using OAuth subscription)
- `X.X%/XXk` Context percentage / context window size
- Model name + thinking level

---

## Model Cost Data

From `models.generated.ts`, each model has:
```typescript
cost: {
  input: number;      // $/million tokens
  output: number;     // $/million tokens
  cacheRead: number;  // $/million tokens (typically discounted)
  cacheWrite: number; // $/million tokens (typically premium)
}
```

---

## What's NOT Currently Tracked

Pi does **not** have:
1. **Aggregate usage log** - No separate file tracking usage across sessions
2. **Time-based summaries** - No daily/weekly/monthly aggregates
3. **Per-model analytics** - Must parse all sessions to compute
4. **Per-project analytics** - Must parse all session directories
5. **Usage trends over time** - No historical data beyond session files

---

## Extension Access

Extensions can access:
- `ctx.sessionManager.getEntries()` - All entries in current session
- `ctx.sessionManager.getBranch()` - Current conversation branch
- `SessionManager.listAll()` - List all sessions across all cwds
- `SessionManager.list(cwd)` - List sessions for a specific cwd

---

## Sample Session Entry

```json
{
  "type": "message",
  "id": "8efb2da4",
  "parentId": "83ddfc3c",
  "timestamp": "2026-01-10T19:50:59.678Z",
  "message": {
    "role": "assistant",
    "content": [...],
    "api": "anthropic-messages",
    "provider": "anthropic",
    "model": "claude-opus-4-5",
    "usage": {
      "input": 8,
      "output": 300,
      "cacheRead": 45404,
      "cacheWrite": 9779,
      "totalTokens": 55491,
      "cost": {
        "input": 0.00004,
        "output": 0.0075,
        "cacheRead": 0.022702,
        "cacheWrite": 0.06111875,
        "total": 0.09136075
      }
    },
    "stopReason": "toolUse",
    "timestamp": 1768074651011
  }
}
```

---

## Implementation Notes for /usage Extension

### Data Collection Approach
Since there's no aggregated usage log, the extension must:
1. Use `SessionManager.listAll()` to find all sessions
2. Parse each JSONL file to extract assistant messages
3. Sum usage data from all messages
4. Group by model, provider, date, and cwd as needed

### Performance Considerations
- Session files can be large (100KB-1MB each)
- Many sessions (100+) across directories
- Consider caching computed aggregates
- Lazy load / paginate session history

### Available Groupings
- **By Time**: Today, This Week, This Month, All Time
- **By Model**: Group by `message.model`
- **By Provider**: Group by `message.provider`
- **By Project**: Group by session's `cwd`
- **By Session**: Individual session stats
