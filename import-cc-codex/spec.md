# Import Claude Code + Codex Sessions into Pi — Spec

## Overview
We will add an import pipeline that converts Claude Code and Codex transcripts into Pi session JSONL files. Imported sessions must be clearly labeled, excluded from usage totals, and behave like normal Pi sessions (continuable, resumable, tree‑navigable).

## Goals
- Import Claude Code or Codex transcripts into valid Pi session JSONL (v3).
- Mark imported content clearly in UI and on disk.
- Exclude imported turns from usage totals; subsequent turns count normally.
- Phase 1: `pi --import <path>` for developer testing.
- Phase 2: `/import` in-session flow mirroring `/resume` UX.

## Non-goals
- Perfect token reconstruction for Codex transcripts.
- Replaying tool execution or restoring filesystem state.
- Guaranteeing identical model behavior across agents.

## Phases

### Phase 1 (CLI path import)
- CLI: `pi --import <path>` with optional `--source claude|codex` (auto-detect if omitted).
- Output session saved under current Pi project sessions directory.
- Immediately open imported session with a banner (e.g., “Imported from Codex — usage excluded”).

### Phase 2 (interactive import)
- `/import` command in-session.
- Picker mirrors `/resume` UI/format/columns, with cwd/all toggle and lazy loading.
- Search uses the same fields as `/resume`: first user message + summary text + timestamp.
- Clear source indicator (Claude/Codex badge/prefix) in list and session name.

## Data mapping

### Session header
- `type: "session"`, `version: 3`, new UUID, `timestamp` from first entry.
- Preserve original `cwd` in import metadata; store session under current cwd for usability.

### Messages
- **User**: map to Pi `role: "user"` with text/image content.
- **Assistant**: map to Pi `role: "assistant"` with text/thinking/toolCall blocks.
  - Claude Code: use provider/model/usage from transcript.
  - Codex: set usage to zero (optional heuristic later).
- **Thinking**: import, but mark/hide as imported in UI.
- **Tools**:
  - CC `tool_use` → Pi `toolCall`.
  - CC `tool_result` → Pi `toolResult`, resolve tool name; fallback `unknown:<short-id>`.
  - Codex `function_call` → Pi `toolCall`.
  - Codex `function_call_output` → Pi `toolResult` with raw text; optional JSON parse while preserving raw.
- **Summaries**: CC `summary` → `custom_message` labeled “Imported summary”.
- **Environment context** (Codex): store in `custom` metadata or drop; never show as a user message.
- **Aborted assistant messages**: keep only if non-empty or include tool calls.
- **Missing images**: replace with `[Image missing: <path>]` text block.

### Import metadata
- Append a `custom` entry: `customType: "import"` with `{ source, sourcePath, sourceSessionId, importedAt, originalCwd, originalModel?, originalTimestamps? }`.
- Track imported range in metadata (e.g., `importedUpToEntryId` or `importedEntryIds`).

## Usage + context accounting
- Imported assistant usage does **not** count toward totals.
- Context % uses deterministic estimate over imported messages until a new assistant response arrives.
- Imported usage never billed.

## Ordering + timestamps
- Preserve original timestamps.
- If timestamps collide/go backward, adjust minimally (e.g., +1ms) to preserve UI order while storing originals in metadata.

## UX + labeling
- Imported sessions show a clear source indicator in list and session name.
- `/resume` lists imported sessions alongside normal sessions.
- No read‑only state: `/tree` works immediately.

## Error handling
- Fail fast with actionable errors for invalid transcript files.
- Missing model/provider falls back gracefully; record fallback in import metadata.
- Tool mapping failures proceed with placeholder tool name.
- Redact obvious secrets in tool outputs by default (tokens/keys/Authorization), with an opt‑out flag.

## Scope constraints
- One source per session (no CC+Codex merge) in v0.
- Idempotent imports optional via flag; default is always create new session.
