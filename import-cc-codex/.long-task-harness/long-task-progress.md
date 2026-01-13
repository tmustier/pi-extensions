# import-cc-codex - Progress Log

## Project Overview

**Started**: 2026-01-13  
**Status**: In Progress  
**Repository**: /Users/thomasmustier/pi-extensions (import-cc-codex)

### Project Goals

Build an import pipeline that converts Claude Code and Codex transcripts into Pi session JSONL files, with clear labeling, usage exclusion, and `/resume`-compatible UX.

### Key Decisions

- **[D1]** Phase 1 uses `pi --import <path>` for developer testing; Phase 2 adds `/import` with `/resume` UX.
- **[D2]** Preserve original timestamps but adjust minimally to maintain UI order; store originals in import metadata.
- **[D3]** Store provenance in `custom` import metadata (no `parentSession` linkage).
- **[D4]** Mirror `/resume` list UI and add Claude/Codex indicators for import selection.

---

## Current State

**Last Updated**: 2026-01-13

### What's Working
- Long-task-harness initialized for `import-cc-codex`
- Spec documented and translated into feature checklist
- Research notes consolidated under `import-cc-codex/research`

### What's Not Working
- No import pipeline implemented yet
- No CLI flags or UI hooks

### Blocked On
- None

---

## Session Log

### Session 1 | 2026-01-13 | Commits: main..HEAD

#### Metadata
- **Features**: imp-001..imp-006 (started)
- **Files Changed**:
  - `import-cc-codex/.long-task-harness/features.json` (+/-) - project feature list
  - `import-cc-codex/.long-task-harness/long-task-progress.md` (+/-) - project log
  - `import-cc-codex/spec.md` (+) - spec document
  - `import-cc-codex/research/import-chats-from-other-agents.md` (+) - research + draft spec
  - `import-cc-codex/.long-task-harness/init.sh` (+) - harness init script
- **Commit Summary**: `docs(import-cc-codex): add spec and harness`

#### Goal
Initialize the project scope, spec, and tracking files for import-cc-codex.

#### Accomplished
- [x] Initialized long-task-harness in `import-cc-codex`
- [x] Documented spec + research findings
- [x] Converted spec into `features.json`

#### Decisions
- **[D1]** Use CLI path import for phase 1 and `/import` for phase 2.
- **[D2]** Keep `/resume` UI as baseline and add source indicators.
- **[D3]** Store import provenance in `custom` entries only.
- **[D4]** Preserve timestamps with minimal adjustments to enforce ordering.

#### Context & Learnings
- No hooks requested; long-task-harness is scoped to `import-cc-codex` only.

#### Next Steps
1. Implement `pi --import <path>` CLI flow → imp-001
2. Build CC + Codex parsers + mapping layer → imp-002
3. Implement usage exclusion + context estimate logic → imp-003

---

<!--
=============================================================================
SESSION TEMPLATE - Copy below this line for new sessions
=============================================================================

### Session N | YYYY-MM-DD | Commits: abc123..def456

#### Metadata
- **Features**: feature-id (started|progressed|completed|blocked)
- **Files Changed**: 
  - `path/to/file.ts` (+lines/-lines) - brief description
- **Commit Summary**: `type: message`, `type: message`

#### Goal
[One-liner: what you're trying to accomplish this session]

#### Accomplished
- [x] Completed task
- [ ] Incomplete task (carried forward)

#### Decisions
- **[DN]** Decision made and rationale (reference in features.json)

#### Context & Learnings
[What you learned, gotchas, context future sessions need to know.
Focus on WHAT and WHY, not the struggle/errors along the way.]

#### Next Steps
1. [Priority 1] → likely affects: feature-id
2. [Priority 2]

=============================================================================
GUIDELINES FOR GOOD SESSION ENTRIES
=============================================================================

1. METADATA is for machines (subagent lookup)
   - Always list features touched with status
   - Always list files with change magnitude
   - Always include commit range or hashes

2. DECISIONS are for continuity
   - Number them [D1], [D2] so they can be referenced
   - Copy key decisions to features.json history
   - Include rationale, not just the choice

3. CONTEXT is for future you/agents
   - Capture the WHY behind non-obvious choices
   - Note gotchas and edge cases discovered
   - Omit error-correction loops - just document resolution

4. COMMIT SUMMARY style
   - Use conventional commits: feat|fix|refactor|test|docs|chore
   - Keep to one-liners that scan quickly

5. Keep sessions BOUNDED
   - One session = one work period (not one feature)
   - If session runs long, split into multiple entries
   - Target: scannable in <30 seconds

-->
