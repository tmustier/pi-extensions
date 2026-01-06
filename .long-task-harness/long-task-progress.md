# pi-extensions - Progress Log

## Project Overview

**Started**: 2026-01-06
**Status**: In Progress
**Repository**: git@github.com:tmustier/pi-extensions.git

### Project Goals

- Maintain a small set of personal Pi extensions
- Add a Space Invaders game extension for interactive play

### Key Decisions

- **[D1]** Use ASCII glyphs and a fixed grid size to keep TUI rendering consistent (Session 1)

---

## Current State

**Last Updated**: 2026-01-06

### What's Working
- `extensions/tab-status.ts` updates the terminal tab title
- `extensions/space-invaders.ts` implemented with /space-invaders command (needs manual run)
- `extensions/paddle-ball.ts` implemented with /paddle-ball command (needs manual run)

### What's Not Working
- Space Invaders gameplay not validated in a terminal yet
- Paddle Ball gameplay not validated in a terminal yet

### Blocked On
- None

---

## Session Log

### Session 1 | 2026-01-06 | Commits: none

#### Metadata
- **Features**: harness-001 (started), invaders-001 (started)
- **Files Changed**: 
  - `.long-task-harness/long-task-progress.md` (+/-) - updated project context
  - `.long-task-harness/features.json` (+/-) - defined initial features
  - `.long-task-harness/init.sh` (+0/-0) - generated harness helper
  - `extensions/space-invaders.ts` (+/-) - Space Invaders extension
  - `README.md` (+/-) - documented new extension
  - `AGENTS.md` (+/-) - added harness invocation snippet
  - `CLAUDE.md` (+/-) - added harness invocation snippet
- **Commit Summary**: (uncommitted)

#### Goal
Initialize long-task-harness tracking and add a Space Invaders extension.

#### Accomplished
- [x] Initialized long-task-harness structure
- [x] Added Space Invaders extension with save/resume behavior
- [x] Updated README install list
- [x] Added long-task-harness invocation snippets for Codex/Claude

#### Decisions
- **[D1]** Use ASCII glyphs and a fixed grid size to keep rendering predictable across terminals

#### Context & Learnings
- Save state is stored in session entries so the game can resume without external files.

#### Next Steps
1. Run `/space-invaders` in an interactive session to validate controls and rendering
2. Update feature status once the game is verified

---

### Session 2 | 2026-01-06 | Commits: none

#### Metadata
- **Features**: paddle-001 (started), harness-001 (progressed)
- **Files Changed**: 
  - `extensions/paddle-ball.ts` (+/-) - Paddle Ball TUI extension
  - `README.md` (+/-) - documented Paddle Ball extension
  - `.long-task-harness/features.json` (+/-) - tracked paddle-001 feature
  - `.long-task-harness/long-task-progress.md` (+/-) - session log update
- **Commit Summary**: (uncommitted)

#### Goal
Add a classic Paddle Ball game extension for interactive play.

#### Accomplished
- [x] Implemented Paddle Ball (Pong-style) TUI game with save/resume behavior
- [x] Documented the new extension in README
- [x] Updated long-task-harness tracking for paddle-001

#### Decisions
- None

#### Context & Learnings
- Game uses ASCII-only glyphs with a fixed grid to keep rendering consistent.

#### Next Steps
1. Run `/paddle-ball` in an interactive session to validate controls and rendering -> likely affects: paddle-001
2. Run `/space-invaders` to validate gameplay -> likely affects: invaders-001

---

### Session 3 | 2026-01-06 | Commits: none

#### Metadata
- **Features**: paddle-001 (progressed)
- **Files Changed**: 
  - `extensions/paddle-ball.ts` (+/-) - increased paddle movement step
- **Commit Summary**: (uncommitted)

#### Goal
Make the Paddle Ball paddle feel more responsive.

#### Accomplished
- [x] Increased player paddle movement step for snappier control

#### Decisions
- None

#### Context & Learnings
- Snappiness is now driven by a larger per-input step (PLAYER_STEP = 2).

#### Next Steps
1. Run `/paddle-ball` in an interactive session to validate the new feel -> likely affects: paddle-001

---

### Session 4 | 2026-01-06 | Commits: none

#### Metadata
- **Features**: paddle-001 (progressed)
- **Files Changed**: 
  - `extensions/paddle-ball.ts` (+/-) - label opponent as PI
- **Commit Summary**: (uncommitted)

#### Goal
Adjust Paddle Ball UI to refer to the opponent as PI.

#### Accomplished
- [x] Updated scoreboard label from AI to PI

#### Decisions
- None

#### Context & Learnings
- Labeling only; internal state still uses ai naming.

#### Next Steps
1. Run `/paddle-ball` to confirm labeling in the UI -> likely affects: paddle-001

---

### Session 5 | 2026-01-06 | Commits: none

#### Metadata
- **Features**: paddle-001 (progressed), harness-001 (progressed)
- **Files Changed**: 
  - `extensions/paddle-ball.ts` (+/-) - /ping command alias, ball speed variation, pi glyph
  - `README.md` (+/-) - updated command name/alias
  - `.long-task-harness/long-task-progress.md` (+/-) - session log update
- **Commit Summary**: (uncommitted)

#### Goal
Make Paddle Ball feel more responsive and rename the command to /ping.

#### Accomplished
- [x] Added /ping command (kept /paddle-ball alias) and updated title/labels
- [x] Vary ball speed based on center vs edge paddle hits
- [x] Updated ball glyph to the pi symbol and tweaked miss handling

#### Decisions
- None

#### Context & Learnings
- Ball now only scores after leaving the playfield, reducing the "teleport" feel near paddles.

#### Next Steps
1. Run `/ping` to validate the new ball speed, glyph rendering, and serve behavior -> likely affects: paddle-001

---

### Session 6 | 2026-01-06 | Commits: none

#### Metadata
- **Features**: paddle-001 (progressed)
- **Files Changed**: 
  - `extensions/paddle-ball.ts` (+/-) - enlarge ball glyph
- **Commit Summary**: (uncommitted)

#### Goal
Make the Ping ball more visually prominent.

#### Accomplished
- [x] Increased ball glyph size to double-pi

#### Decisions
- None

#### Context & Learnings
- Uses "ππ" for a wider 2-cell ball while staying within the 2-char cell width.

#### Next Steps
1. Run `/ping` to confirm the larger glyph renders cleanly -> likely affects: paddle-001

---

### Session 7 | 2026-01-06 | Commits: none

#### Metadata
- **Features**: paddle-001 (progressed)
- **Files Changed**: 
  - `extensions/ping.ts` (+/-) - pause on narrow terminals, vim speed boost
- **Commit Summary**: (uncommitted)

#### Goal
Make /ping pause gracefully on narrow terminals and add a vim key speed boost.

#### Accomplished
- [x] Auto-pause the game loop when the terminal is too narrow and resume on resize
- [x] Add a vim-only speed boost for player paddle hits

#### Decisions
- None

#### Context & Learnings
- ESC/Q handling works while auto-paused so players can still save or quit.

#### Next Steps
1. Run `/ping` to validate auto-pause behavior and the vim speed boost -> likely affects: paddle-001

---

### Session 8 | 2026-01-06 | Commits: none

#### Metadata
- **Features**: paddle-001 (progressed)
- **Files Changed**: 
  - `extensions/ping.ts` (+/-) - stronger vim boost ball speed
- **Commit Summary**: (uncommitted)

#### Goal
Make the vim key speed boost much faster for /ping.

#### Accomplished
- [x] Added a multi-tick ball speed boost after player vim hits
- [x] Cleared boost state on score/restart

#### Decisions
- None

#### Context & Learnings
- Boost only applies while the ball is moving toward the AI to avoid a too-fast return.

#### Next Steps
1. Run `/ping` to confirm the stronger vim boost makes the game winnable -> likely affects: paddle-001

---

### Session 9 | 2026-01-06 | Commits: none

#### Metadata
- **Features**: paddle-001 (progressed)
- **Files Changed**: 
  - `extensions/ping.ts` (+/-) - point pause score display, win footer
- **Commit Summary**: (uncommitted)

#### Goal
Add a point pause with centered score and show a green win message.

#### Accomplished
- [x] Pause briefly after each point and render a centered score above the ball
- [x] Show a green win message instead of GAME OVER when the player wins

#### Decisions
- None

#### Context & Learnings
- Point pause only delays the loop; ball still resets to center for the next serve.

#### Next Steps
1. Run `/ping` to validate the score pause overlay and win footer -> likely affects: paddle-001

---

### Session 10 | 2026-01-06 | Commits: none

#### Metadata
- **Features**: paddle-001 (progressed)
- **Files Changed**: 
  - `extensions/ping.ts` (+/-) - raise default ball speed
- **Commit Summary**: (uncommitted)

#### Goal
Make normal ball speed as fast as the previous fast setting.

#### Accomplished
- [x] Raised the default ball delay to match the fast speed

#### Decisions
- None

#### Context & Learnings
- The vim boost still adds extra steps per tick, so it remains faster than normal.

#### Next Steps
1. Run `/ping` to confirm normal mode is winnable and vim boost still feels distinct -> likely affects: paddle-001

---

### Session 11 | 2026-01-06 | Commits: none

#### Metadata
- **Features**: paddle-001 (progressed)
- **Files Changed**: 
  - `extensions/ping.ts` (+/-) - slow AI paddle reaction
- **Commit Summary**: (uncommitted)

#### Goal
Slow Pi's paddle so scoring is possible in normal play.

#### Accomplished
- [x] Throttled AI paddle updates to every other tick

#### Decisions
- None

#### Context & Learnings
- AI speed now depends on `AI_MOVE_TICKS`, so it can be tuned without changing movement step size.

#### Next Steps
1. Run `/ping` to confirm normal points are possible and AI feels fair -> likely affects: paddle-001

---

### Session 12 | 2026-01-06 | Commits: none

#### Metadata
- **Features**: paddle-001 (progressed)
- **Files Changed**: 
  - `extensions/ping.ts` (+/-) - require front-face paddle hits
- **Commit Summary**: (uncommitted)

#### Goal
Only allow paddle bounces when the ball hits the front face.

#### Accomplished
- [x] Require front-face contact for paddle bounces; misses now pass out of bounds

#### Decisions
- None

#### Context & Learnings
- Misses at the paddle line still take one tick to exit, preserving the grace behavior.

#### Next Steps
1. Run `/ping` to confirm edge/past-paddle hits no longer bounce -> likely affects: paddle-001

---

### Session 13 | 2026-01-06 | Commits: none

#### Metadata
- **Features**: paddle-001 (progressed)
- **Files Changed**: 
  - `extensions/ping.ts` (+/-) - speed up AI paddle updates
- **Commit Summary**: (uncommitted)

#### Goal
Make the Pi paddle a bit faster.

#### Accomplished
- [x] Increased AI update frequency to move every tick

#### Decisions
- None

#### Context & Learnings
- AI speed can still be tuned via `AI_MOVE_TICKS` without changing movement step size.

#### Next Steps
1. Run `/ping` to confirm the AI feels challenging but fair -> likely affects: paddle-001

---

### Session 14 | 2026-01-06 | Commits: none

#### Metadata
- **Features**: paddle-001 (progressed)
- **Files Changed**: 
  - `extensions/ping.ts` (+/-) - fractional AI move rate
- **Commit Summary**: (uncommitted)

#### Goal
Adjust Pi paddle speed to land between 1 and 2 tick updates.

#### Accomplished
- [x] Switched AI movement to a fractional accumulator for ~1.5-tick moves

#### Decisions
- None

#### Context & Learnings
- AI speed is now controlled by `AI_MOVE_RATE` and can be tuned without changing step size.

#### Next Steps
1. Run `/ping` to verify AI difficulty feels balanced -> likely affects: paddle-001

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
1. [Priority 1] -> likely affects: feature-id
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
