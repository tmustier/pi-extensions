# Importing Claude Code + Codex conversations into Pi — findings

## Pi session format and storage

- **Location:** `~/.pi/agent/sessions/--<cwd>--/<timestamp>_<uuid>.jsonl` (cwd is encoded by replacing `/` with `-`).
- **Format:** JSONL with a header line (`type: "session"`, `version: 3`, `id`, `timestamp`, `cwd`, optional `parentSession`).
- **Entries:** Each entry is a `SessionEntry` with `id`, `parentId`, `timestamp`. Messages are stored as:
  - `user` message with `content` (string or `[{type:"text"|"image", ...}]`) and `timestamp` (ms).
  - `assistant` message with `api`, `provider`, `model`, `usage`, `stopReason`, `content` blocks (`text`, `thinking`, `toolCall`).
  - `toolResult` messages with `toolCallId`, `toolName`, `content` blocks (`text`/`image`), `isError`.
- **Tree structure:** Each entry has `parentId`; linear sessions use previous entry ID. `/tree` works off this structure.
- **Session display name:** `session_info` entries set a display name shown in `/resume`.

## Usage accounting (import shouldn’t count)

- `/session` and footer usage totals sum **all assistant message usage** in the session entries (not just post-compaction).
- Context % in the footer is computed from **the last assistant message’s usage** (input + output + cache read/write).
- There is **no built‑in “imported” flag** on messages or entries; to exclude imports you’d need to:
  - Set imported assistant `usage` to zero **and** accept that context % will show 0 until a new assistant message arrives, **or**
  - Add a new marker (e.g., `custom` entry or message field) and update footer + stats code to skip imported entries.

## Claude Code transcripts (local)

- **User history only:** `~/.claude/history.jsonl` (user commands/prompts; no assistant output).
- **Full transcripts:** `~/.claude/projects/<project>/<session>.jsonl`.
  - Lines include `type: "user"` and `type: "assistant"` entries with `message` objects plus metadata (`cwd`, `sessionId`, `timestamp`, etc.).
  - Assistant `message.content` can include blocks: `text`, `thinking`, `tool_use` (id, name, input).
  - Tool results show up as **user entries** whose `message.content` contains `tool_result` blocks (with `tool_use_id` and `content`).
  - Other line types include `summary` and `file-history-snapshot` (can be ignored for a v0 importer).

## Codex transcripts (local)

- **User history only:** `~/.codex/history.jsonl` (session_id, ts, text; no assistant output).
- **Full transcripts:** `~/.codex/sessions/YYYY/MM/DD/*.jsonl`.
  - Lines are event records: `{ timestamp, type, payload }`.
  - `type: "response_item"` with `payload.type: "message"` contains `role: "user"|"assistant"` and content blocks (`input_text` / `output_text`).
  - Tool calls appear as `response_item` with `payload.type: "function_call"` (name, arguments, call_id).
  - Tool outputs appear as `response_item` with `payload.type: "function_call_output"` (call_id, output JSON).
  - Many other record types (`event_msg`, `turn_context`, `reasoning`) can be ignored for basic import.

## Mapping notes for a v0 importer

- **Create a Pi session JSONL** with a valid header (`version: 3`) and a linear chain of `message` entries.
- **User messages** map directly from CC `message.role == "user"` and Codex `payload.role == "user"`.
- **Assistant messages** need Pi’s required fields (`api`, `provider`, `model`, `usage`, `stopReason`, `timestamp`).
  - CC provides model + usage in the assistant `message` payload; Codex logs do **not** provide usage tokens, so you’d likely set them to 0 (unless you add a heuristic).
- **Tool calls/results:**
  - CC: convert `tool_use` blocks → Pi `toolCall` blocks; convert `tool_result` blocks → Pi `toolResult` messages. Tool name may need to be looked up via the matching `tool_use_id`.
  - Codex: map `function_call` → Pi `toolCall`; `function_call_output` → Pi `toolResult`.
- **Make imports obvious:**
  - Add a `session_info` entry like `"Imported from Claude Code"` / `"Imported from Codex"` for `/resume` visibility.
  - Optionally add a `custom` entry (non‑LLM) to store source metadata (file path, original session ID, original tool/event IDs).
- **Resume + share support:** as long as the file is a valid Pi session JSONL in `~/.pi/agent/sessions`, `/resume`, `/tree`, `/export`, and `/share` should work without special casing.

## Open gaps to resolve if we implement

- **Imported usage vs. context %**: if imported assistant usage is zero, the footer’s context % will be 0 until a new assistant response is produced.
- **Missing tool names in CC `tool_result` blocks**: may need to build a `tool_use_id → name` index while parsing.
- **Model restoration warnings**: if the imported `provider/model` aren’t available locally, Pi will log a restore warning and fall back to the configured default model.

## Spec (draft)

### Goals
- Import a Claude Code or Codex transcript into a valid Pi session JSONL.
- Clearly mark imported content as imported in UI and on disk.
- Exclude imported turns from usage totals; subsequent turns should count normally.
- V0: after import, allow immediate continuation in Pi (new message appends to the imported session).
- Later: imported sessions should work with `/resume`, `/tree`, `/export`, `/share` without special cases.

### Non-goals
- Reconstructing exact token usage for Codex transcripts.
- Replaying tool execution or restoring filesystem state.
- Guaranteeing identical model/behavior across agents.

### Inputs
- Claude Code transcript: `~/.claude/projects/<project>/<session>.jsonl`.
- Codex transcript: `~/.codex/sessions/YYYY/MM/DD/*.jsonl`.
- Optional user-only histories (`~/.claude/history.jsonl`, `~/.codex/history.jsonl`) are out of scope for v0.

### Output
- A Pi session JSONL file in `~/.pi/agent/sessions/--<cwd>--/` with version `3` header.
- A `session_info` entry naming the source (e.g., "Imported from Claude Code").
- A `custom` entry with import metadata:
  - `customType: "import"`
  - `data`: `{ source, sourcePath, sourceSessionId, importedAt, originalCwd, originalModel? }`.

### Message mapping
- **User**: map to Pi `message` entries with `role: "user"` and text/image content.
- **Assistant**: map to Pi `message` entries with `role: "assistant"` and content blocks.
  - Codex: `usage` defaults to zeros unless we add a heuristic.
  - Claude Code: use `usage`, `provider`, `model` from transcript.
- **Thinking**: import as `thinking` blocks but hide by default in UI or mark as imported.
- **Tools**:
  - CC `tool_use` → Pi `toolCall` blocks.
  - CC `tool_result` → Pi `toolResult` messages (resolve `tool_use_id → name`; fallback to `unknown:<short-id>`).
  - Codex `function_call` → Pi `toolCall` blocks.
  - Codex `function_call_output` → Pi `toolResult` messages (store raw output text; optional JSON parse with raw preserved).
- **Summaries**: CC `summary` → `custom_message` with a visible "Imported summary" label.
- **Environment context** (Codex): store as `custom` metadata or drop; do not render as user messages.
- **Aborted assistant messages**: keep only if they contain tool calls or non-empty content; otherwise drop.
- **Missing images**: replace with a text placeholder like `[Image missing: <path>]`.

### Usage + context accounting
- Usage totals (`/session`, footer totals) should ignore imported assistant usage.
- Context % should avoid showing 0% on import; use a deterministic estimate across imported messages until a new assistant response arrives.
- Imported usage must not be billed or counted against the user’s usage metrics.
- Track imported range in a `custom` entry (e.g., `{ importedUpToEntryId, importedEntryIds? }`) rather than per-entry schema changes.

### UX expectations
- **Phase 1 (testing)**: `pi --import <path>` with optional `--source claude|codex` (auto-detect if omitted). No picker in v0; this is for developer testing.
- **Phase 2**: add `/import` in-session command that mirrors `/resume` UX (cwd/all toggle, lazy loading, same performance profile).
- **Picker flow** (Phase 2+): selector of recent CC/Codex sessions with preview (first user message + summary text + timestamp), type-to-filter, and optional `--query` CLI flag for direct search using the same fields as `/resume`.
- **Source labeling**: mirror `/resume` list UI/formatting/columns as baseline; add a clear Claude/Codex indicator (badge/prefix) in the list and in session name.
- **Post-import**: immediately open the imported session with a status banner (e.g., "Imported from Claude Code — usage excluded").
- Continuing the chat is seamless: the next user prompt appends to the imported session.
- `/resume` lists imported sessions alongside normal sessions.

### Error handling
- Invalid transcript files should fail fast with actionable error messages.
- Missing model/provider should fall back gracefully; record fallback in import metadata (not as a model change).
- If tool result mapping fails, import should still proceed with a placeholder tool name.
- Default to redacting obvious secrets in tool outputs (tokens/keys/Authorization), with an opt-out flag.

### Ordering + timestamps
- Preserve original timestamps for provenance.
- If timestamps are identical or go backwards, adjust stored timestamps minimally (e.g., +1ms) while keeping originals in import metadata to preserve UI order.

### Session placement
- Store the imported session under the current Pi project’s session directory for `/resume` usability.
- Preserve original `cwd` in import metadata and surface it in the session display name.

### Source scope
- V0: one source per session (no CC+Codex merge).
- No read-only mode; `/tree` is available immediately.
- Idempotent import is optional via a flag (default is always create a new session).
