# Badlogic Game Spec

## Goal
Create a comprehensive Mario-style TUI extension spec in `badlogic-game/spec.md` with list-based outline and detailed, verifiable content. Each sub-subsection must include design intent + implementation guidance so it is directly actionable for engineering.

## Requirements
- Use list items + subitems for the outline and content.
- Draft section-by-section via ralph loop iterations.
- Iterate at the level of every sub-subsection (e.g., target size, scroll rules).
- After completing each sub-section (e.g., Player Experience & Feel), reflect on coherence and adjust if needed.
- Final coherence reflection at end of doc; adjust as needed.
- Commit after each major section: Core Gameplay, Presentation, Tech + Delivery.

## Planned Sections
1) Core Gameplay
  - Player Experience & Feel
    - Time-to-fun / quick boot
    - Pace / difficulty ramp
    - Failure/respawn cadence
    - Feel targets vs SMB1
  - Controls & Input
    - Key mapping
    - Input buffering
    - Pausing/quitting/restart
  - Game Loop & States
    - State machine
    - Transitions
  - Level Design
    - Tile palette
    - Layout rules
    - Level 1 (short)
  - Entities & Interactions
    - Player
    - Blocks
    - Items
    - Enemies
    - Hazards
  - Physics & Movement
    - Gravity / accel / friction
    - Jump (variable)
    - Collision resolution

2) Presentation
  - Camera & Viewport
    - Target size
    - Scroll rules
    - Bounds/edges
  - Rendering & Palette
    - 256-color plan
    - Glyphs / tiles
  - HUD & Scoring
    - HUD layout
    - Score/lives/time/coins
  - FX & Feedback (optional)
    - Particles
    - Text cues

3) Tech + Delivery
  - Save/Resume
    - Autosave cadence
    - Persisted fields
    - Resume behavior
  - Technical Architecture
    - Data model
    - Update order
    - Collision handling
    - Input handling
    - Serialization
  - Feature Stories & Sequencing
  - Test Plan
  - Milestones
  - Open Questions

## Checklist
- [x] Create `badlogic-game/spec.md` with list-based scaffold
- [x] Draft Core Gameplay subsections (reflect + adjust after each)
  - [x] Player Experience & Feel > Time-to-fun / quick boot
  - [x] Player Experience & Feel > Pace / difficulty ramp
  - [x] Player Experience & Feel > Failure/respawn cadence
  - [x] Player Experience & Feel > Feel targets vs SMB1
  - [x] Controls & Input > Key mapping
  - [x] Controls & Input > Input buffering
  - [x] Controls & Input > Pausing/quitting/restart
  - [x] Game Loop & States > State machine
  - [x] Game Loop & States > Transitions
  - [x] Level Design > Tile palette
  - [x] Level Design > Layout rules
  - [x] Level Design > Level 1 (short)
  - [x] Entities & Interactions > Player
  - [x] Entities & Interactions > Blocks
  - [x] Entities & Interactions > Items
  - [x] Entities & Interactions > Enemies
  - [x] Entities & Interactions > Hazards
  - [x] Physics & Movement > Gravity / accel / friction
  - [x] Physics & Movement > Jump (variable)
  - [x] Physics & Movement > Collision resolution
- [x] Commit Core Gameplay section
- [x] Draft Presentation subsections (reflect + adjust after each)
  - [x] Camera & Viewport > Target size
  - [x] Camera & Viewport > Scroll rules
  - [x] Camera & Viewport > Bounds/edges
  - [x] Rendering & Palette > 256-color plan
  - [x] Rendering & Palette > Glyphs / tiles
  - [x] HUD & Scoring > HUD layout
  - [x] HUD & Scoring > Score/lives/time/coins
  - [x] FX & Feedback > Particles
  - [x] FX & Feedback > Text cues
- [x] Commit Presentation section
- [x] Draft Tech + Delivery subsections (reflect + adjust after each)
  - [x] Save/Resume > Autosave cadence
  - [x] Save/Resume > Persisted fields
  - [x] Save/Resume > Resume behavior
  - [x] Technical Architecture > Data model
  - [x] Technical Architecture > Update order
  - [x] Technical Architecture > Collision handling
  - [x] Technical Architecture > Input handling
  - [x] Technical Architecture > Serialization
  - [x] Feature Stories & Sequencing
  - [x] Test Plan
  - [x] Milestones
  - [x] Open Questions
- [x] Commit Tech + Delivery section
- [x] Final coherence reflection; adjust doc as needed

## Reflection (Iteration 46)
1. What has been accomplished so far?
   - Completed final coherence pass; clarified player glyph sizing.
2. What's working well?
   - All sections align on sizes, timings, and rendering constraints.
3. What's not working or blocking progress?
   - Nothing blocked.
4. Should the approach be adjusted?
   - No; spec is complete.
5. What are the next priorities?
   - None; ready to stop loop.

## Coherence Checks
- Physics & Movement: collision ordering aligns with stomp and head-bump rules.

## Tech + Delivery Coherence Check (Iteration 45)
- Save cadence aligns with resume behavior and pause/quit rules.
- Data model fields cover persisted fields list.
- Serialization versioning aligns with SaveState schema.
- Stories/milestones reflect the same delivery order.

## Final Coherence Check (Iteration 46)
- Glyph sizing clarified for player big state (1x3 tiles).
- Run modifier, jump buffer, and physics values are consistent.
- Save/resume flow matches input and state machine rules.

## Presentation Coherence Check (Iteration 32)
- Viewport size supports HUD lines and 2-char tile grid without wrap.
- Camera rules align with bounds clamp and no vertical scroll assumption.
- Glyphs/tiles use ASCII and 2-char width consistent with rendering plan.
- HUD fields (score/coins/lives/time) match scoring spec values.
- FX cues are lightweight and don't conflict with HUD overlays.

## Core Gameplay Coherence Check (Iteration 22)
- Consistency: run modifier defined in Controls; referenced in Physics and feel targets.
- Timing: coyote/jump buffer values consistent between Input and Jump sections.
- Level 1: pacing, layout rules, and hazards align with speed/jump targets.
- Death loop: hazards, enemies, and respawn cadence agree on invuln timing and lives.
- Tile palette: blocks/items/hazards align with symbols; ensure rendering uses same glyphs.
