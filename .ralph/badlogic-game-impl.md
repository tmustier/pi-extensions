# Badlogic Game Implementation

## Goal
Implement `/badlogic-game` per `badlogic-game/spec.md` with deterministic core logic, reliable tests (unit + integration + E2E), and incremental milestones.

## Loop Protocol
- Work on 1 feature per iteration (small, shippable, testable).
- Each iteration MUST:
  - Add or extend at least 1 regression test (unit or integration).
  - Add or extend at least 1 E2E scripted scenario (headless run with golden frame or state snapshot).
  - Record verification evidence (commands + results) in Reflection.
- After each story, do a quick refactor pass to keep code concise and modular.
- Keep diffs small; commit once the feature passes verification.
- Self-reflect every iteration and adjust plan if needed.

## Refactor Principles
- Keep files under ~400 LOC; split by responsibility (engine, render, entities, input, levels).
- Prefer pure functions and deterministic state updates; avoid hidden globals.
- Consolidate constants (tiles, glyphs, physics) in one place.
- Eliminate duplication by extracting helpers and data tables.

## Typing Strategy
- Use `// @ts-check` + JSDoc types for strict checks without a build step.
- Add `badlogic-game/tsconfig.json` with `checkJs`, `strict`, `noEmit`.
- Typecheck command: `npx tsc --noEmit -p badlogic-game/tsconfig.json` (record results).

## Verifiability Standard
- Unit tests: physics tick, jump apex, collision resolution, serialization.
- Integration tests: deterministic input sequences -> expected positions/collisions/state transitions.
- E2E tests: scripted input -> render frames or HUD/state snapshots; compare to golden fixtures.
- Manual checks: milestone smoke test in a live TUI session (M1..M4).

## Feature Checklist
- [x] Story 0: Test harness + engine/core separation
  - Decide runner (node:test vs custom) and structure
  - Deterministic RNG + headless renderer
- [x] Quality: strict typing setup (tsconfig + @ts-check)
- [x] Story 1: Core loop (map, movement, gravity, collision, camera clamp, Level 1)
- [x] Story 2: Enemies + stomp + hazards
- [x] Story 3: Blocks + coins + scoring + HUD
- [x] Story 4: Power-ups (mushroom) + big state
- [x] Story 5: Save/resume + pause/quit
- [x] Story 6: Polish (particles, text cues, camera dead-zone)
- [x] Docs + wiring: `/badlogic-game` command registration and README update
- [ ] Final: full test run + manual E2E checks; update harness logs

## Milestone Gates
- [x] M1: Story 1 + test harness + E2E scenario
- [x] M2: Story 2 + tests + E2E scenario
- [x] M3: Story 3/4 + tests + E2E scenario
- [ ] M4: Story 5/6 + tests + manual run

## References
- Spec: `badlogic-game/spec.md`
- Existing WIP: `arcade/wip/badlogic-game.ts`

## Reflection (Iteration 31)
1. What has been accomplished so far?
   - Added levelIndex save regression test and item-in-viewport E2E fixture.
   - Verification: `node --test badlogic-game/tests/*.test.js` -> 70 pass; `npx tsc --noEmit -p badlogic-game/tsconfig.json` -> ok.
2. What's working well?
   - Level index persistence and viewport item rendering are covered deterministically.
3. What's not working or blocking progress?
   - Manual M4 run still pending (interactive UI required).
4. Should the approach be adjusted?
   - No; keep manual run as final gate.
5. What are the next priorities?
   - M4 manual run.
   - Final: update harness logs.
