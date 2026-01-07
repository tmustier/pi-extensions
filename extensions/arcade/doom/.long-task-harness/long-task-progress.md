# ASCII Doom - Progress Log

## Project Overview

**Started**: 2026-01-07
**Status**: In Progress
**Repository**: git@github.com:tmustier/pi-extensions.git (doom subdirectory)

### Project Goals

- Build a playable first-person ASCII Doom clone as a Pi extension
- Raycasting 3D engine rendered in terminal characters
- WASD movement, combat, enemies, pickups
- Multiple levels with progression

### Architecture

```
doom/
├── .long-task-harness/     # Session tracking
├── doom.ts                 # Main extension file
└── README.md               # Usage instructions
```

### Technical Approach

1. **Raycasting**: Cast rays from player position across FOV, calculate wall distances
2. **ASCII Rendering**: Use character gradients (█▓▒░ ) for depth shading
3. **Game Loop**: Tick-based updates (~100ms), same pattern as other arcade games
4. **TUI Integration**: ctx.ui.custom() for interactive component with keyboard input

### Key Decisions

- **[D1]** Single-file extension for simplicity (can split later if needed)
- **[D2]** ASCII-only rendering (no Unicode/emoji for terminal compatibility)
- **[D3]** 60° FOV, adjustable based on terminal width
- **[D4]** 38 features organized into 5 tiers (mvp, combat, items, progression, polish)

---

## Current State

**Last Updated**: 2026-01-07

### What's Working
- Project structure initialized
- 38 features defined and tracked in features.json
- Long-task-harness configured for session continuity

### What's Not Working
- All features pending implementation (0/38 complete)

### Blocked On
- Nothing - ready to start implementation

---

## Feature Summary

| Tier | Count | Description |
|------|-------|-------------|
| MVP | 14 | Core 3D world, movement, rendering, HUD, menus |
| Combat | 9 | Enemies, AI, shooting, damage, projectiles |
| Items | 6 | Pickups, doors, keys, barrels, wall variation |
| Progression | 7 | Multiple levels/weapons, automap, secrets, stats |
| Polish | 5 | Save state, visual FX, difficulty, audio, sprint |
| **Total** | **38** | |

---

## Session Log

### Session 1 | 2026-01-07 | Commits: (pending)

#### Goal
Initialize project structure and comprehensively plan all features.

#### Accomplished
- [x] Created doom subdirectory in pi-extensions
- [x] Initialized long-task-harness for session tracking
- [x] Defined 38 features covering complete Doom experience
- [x] Organized features into 5 tiers (mvp → polish)
- [x] Added AGENTS.md for auto-invoking harness in future sessions

#### Decisions
- **[D1]** 38 features total, organized by tier for incremental development
- **[D2]** MVP tier (14 features) delivers playable 3D world before combat
- **[D3]** Split complex features: Enemy System → Data + AI, HUD → Stats + Minimap
- **[D4]** Added Pause Menu and Controls Help to MVP (essential UX)

#### Features Defined

**MVP (14):** Extension Scaffold, Map System, Player Movement, Raycasting Engine, ASCII Rendering, HUD Stats, HUD Minimap, Level Design, Weapon Sprite, Crosshair, Menu/Title Screen, Wall Sliding Collision, Pause Menu, Controls Help

**Combat (9):** Enemy Data & Spawning, Enemy AI, Combat Shooting, Combat Damage, Sprite Rendering System, Game Over Screen, Enemy Projectiles, Multiple Enemy Types

**Items (6):** Pickups, Doors, Wall Variation, Explosive Barrels, Keys & Locked Doors

**Progression (7):** Multiple Levels, Multiple Weapons, Automap, Victory Screen, Secrets, End-Level Stats

**Polish (5):** Save/Resume State, Visual Effects, Difficulty Settings, Terminal Bell Audio, Sprint

#### Next Steps
1. Implement doom-001 (Extension Scaffold) → /doom command, game loop, TUI component
2. Implement doom-002 (Map System) → 2D grid, wall detection
3. Implement doom-003 (Player Movement) → WASD, rotation, basic collision
4. Implement doom-004 (Raycasting Engine) → Ray casting, distance calculation
5. Implement doom-005 (ASCII Rendering) → 3D view with depth shading

---
