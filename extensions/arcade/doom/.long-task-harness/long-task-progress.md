# ASCII Doom - Progress Log

## Project Overview

**Started**: 2026-01-07
**Status**: In Progress
**Repository**: git@github.com:tmustier/pi-extensions.git (extensions/arcade/doom)

### Project Goals

- Build a playable first-person ASCII Doom clone as a Pi extension
- Raycasting 3D engine rendered in terminal characters
- WASD movement, combat, enemies, pickups
- Multiple levels with progression

### Architecture

```
extensions/arcade/doom/
├── .long-task-harness/     # Session tracking
├── doom.ts                 # Main extension file (~750 lines)
└── AGENTS.md               # Auto-invoke harness
```

### Technical Approach

1. **Raycasting**: DDA algorithm casting rays from player across FOV
2. **ASCII Rendering**: Character gradients (█▓▒░) for depth shading
3. **Game Loop**: 50ms tick-based updates via setInterval
4. **TUI Integration**: ctx.ui.custom() for interactive component

### Key Decisions

- **[D1]** Single-file extension for simplicity
- **[D2]** ASCII-only rendering (no Unicode emoji)
- **[D3]** 60° FOV, DDA raycasting algorithm
- **[D4]** 38 features organized into 5 tiers
- **[D5]** Wall sliding collision for smooth movement

---

## Current State

**Last Updated**: 2026-01-07

### What's Working
- Extension scaffold with /doom command
- Title screen with ASCII art
- Help screen with controls
- Pause menu (P key)
- 3D raycasted view with depth shading
- Player movement (WASD) with wall sliding
- Player rotation (Q/E and arrow keys)
- Crosshair overlay
- Minimap in corner
- HUD with health/ammo
- Basic weapon sprite
- Muzzle flash on shoot
- Level exit detection → victory screen
- Game over screen

### What's Not Working / TODO
- Enemies not implemented yet
- Shooting doesn't hit anything yet
- No pickups yet
- Only 1 level
- Minimap overlay positioning needs work
- Save/resume not implemented

### Blocked On
- Nothing

---

## Feature Summary

| Tier | Count | Status |
|------|-------|--------|
| MVP | 14 | 14 implemented, needs testing |
| Combat | 9 | 0 implemented |
| Items | 6 | 0 implemented |
| Progression | 7 | 0 implemented |
| Polish | 5 | 0 implemented |
| **Total** | **38** | **14 in progress** |

---

## Session Log

### Session 1 | 2026-01-07 | Commits: 3d9ecdf

#### Goal
Initialize project structure and comprehensively plan all features.

#### Accomplished
- [x] Created doom subdirectory in pi-extensions
- [x] Initialized long-task-harness for session tracking
- [x] Defined 38 features covering complete Doom experience
- [x] Organized features into 5 tiers (mvp → polish)
- [x] Moved to extensions/arcade/doom/

#### Decisions
- **[D1]** 38 features total, organized by tier
- **[D2]** MVP tier delivers playable 3D world before combat

---

### Session 2 | 2026-01-07 | Commits: (pending)

#### Metadata
- **Features**: doom-001 through doom-007, doom-015, doom-016, doom-022, doom-024, doom-035, doom-036 (all implemented)
- **Files Changed**:
  - `doom.ts` (+new, ~750 lines) - Full MVP implementation

#### Goal
Implement all MVP features for a walkable 3D world.

#### Accomplished
- [x] doom-001: Extension scaffold with /doom command
- [x] doom-002: Map system with wall detection
- [x] doom-003: Player movement (WASD, Q/E rotation)
- [x] doom-004: Raycasting engine (DDA algorithm)
- [x] doom-005: ASCII rendering with depth shading
- [x] doom-006: HUD stats (health, ammo, level)
- [x] doom-006b: Minimap overlay
- [x] doom-007: First level with rooms and exit
- [x] doom-015: Weapon sprite with muzzle flash
- [x] doom-016: Crosshair at screen center
- [x] doom-022: Title screen with ASCII art
- [x] doom-024: Wall sliding collision
- [x] doom-035: Pause menu (P key)
- [x] doom-036: Help screen (H key)

#### Technical Details
- DDA raycasting for accurate wall detection
- Perpendicular distance calculation (no fisheye)
- Side-based shading (N/S vs E/W walls)
- Wall sliding by trying X then Y movement separately
- 5 shade levels based on distance
- Arrow direction indicator on minimap

#### Decisions
- **[D5]** Use DDA algorithm over simple ray stepping (more accurate)
- **[D6]** 50ms tick rate for smooth updates
- **[D7]** Minimap size 7x7 cells around player

#### Context & Learnings
- TUI custom component needs layout/render/handleInput methods
- Arrow keys come as escape sequences (\x1b[A, etc.)
- ANSI reset needed after each colored character

#### Next Steps
1. **Test /doom** to validate MVP features work
2. Implement doom-018 (Sprite Rendering System) - foundation for enemies
3. Implement doom-008 (Enemy Data & Spawning)
4. Implement doom-008b (Enemy AI)
5. Implement doom-009 (Combat - Shooting with hit detection)

---
