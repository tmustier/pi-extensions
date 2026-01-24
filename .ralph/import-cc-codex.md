# import-cc-codex implementation loop

## Goals
- Implement Phase 1 `pi --import <path>` CLI flow.
- Build Claude Code + Codex transcript parsing + mapping.
- Add usage exclusion + context estimate for imported ranges.
- Preserve metadata, ordering, and labels per spec.
- Prepare for Phase 2 `/import` selector (no UI changes yet unless required).

## Checklist (interleaved)
1. Wire CLI flags + import entrypoint (imp-001)
2. Implement parsers + mapping utilities (imp-002)
3. Add import metadata + labeling (imp-004)
4. Implement usage exclusion + context estimate (imp-003)
5. Add tool-output redaction (imp-005)
6. **Reflection**: summarize what works/doesn’t, adjust plan
7. **Cleanup**: refactor/simplify, remove redundancy, improve clarity
8. **Testing**: targeted tests for parsers/mapping
9. Repeat (1–5) as needed
10. **Reflection** (periodic)
11. **Cleanup** (periodic)
12. **Testing**: broaden scope; move toward E2E once CLI flow is stable

## Acceptance
- `pi --import <path>` creates a valid Pi session JSONL and opens it.
- Imported sessions are labeled, metadata preserved, and usage excluded.
- Deterministic context % works before first new assistant response.
- Tests cover key parsing and mapping behavior.

## Progress Log
- 2026-01-13: Wired `--import`/`--source` CLI flags, added core import module for CC/Codex parsing + mapping, updated README CLI docs, and added startup status banner plumbing. Pending: tests, usage exclusion/context estimate, redaction opt-out.
