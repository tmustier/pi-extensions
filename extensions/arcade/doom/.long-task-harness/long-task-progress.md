# ASCII Doom - Progress Log

## Project Overview

**Started**: 2026-01-07
**Status**: In Progress  
**Repository**: git@github.com:tmustier/pi-extensions.git (extensions/arcade/doom)

### Key Decisions

- **[D1]** Single-file extension (~450 lines)
- **[D2]** ASCII-only rendering
- **[D3]** 60° FOV, DDA raycasting
- **[D4]** 38 features in 5 tiers
- **[D5]** Frame buffer approach for sprite compositing

---

## Current State

**Last Updated**: 2026-01-07

### What's Working
- Full 3D raycasted view with depth shading
- Player movement (WASD) with wall sliding
- Enemies spawn, chase player, attack when close
- Shooting with hit detection
- Damage system with game over
- Sprites render in 3D with distance scaling
- Minimap shows enemies as red !
- Kill counter in HUD
- Title, help, pause, game over, victory screens

### TODO
- Pickups (health, ammo)
- Doors
- Multiple levels
- More enemy types active in levels
- Save/resume state

---

## Session Log

### Session 1 | 2026-01-07

**Goal**: Initialize project and plan features
**Accomplished**: 38 features defined, organized into 5 tiers

---

### Session 2 | 2026-01-07 | Commits: 48f9a48..d8d3702

**Goal**: Implement MVP features
**Accomplished**: 
- Extension scaffold, map system, movement, raycasting, rendering
- HUD, minimap, crosshair, title/help/pause screens
- Wall sliding collision
- Refactored from 870 → 300 lines

---

### Session 3 | 2026-01-07 | Commits: d8d3702..02947f9

**Goal**: Implement Combat tier

**Accomplished**:
- [x] doom-008: Enemy Data & Spawning (Z marks in level)
- [x] doom-008b: Enemy AI (chase player, attack when close)
- [x] doom-018: Sprite Rendering (distance scaling, wall clipping)
- [x] doom-009: Combat Shooting (hitscan, 25 damage)
- [x] doom-010: Combat Damage (enemy attacks, game over)
- [x] doom-023: Game Over Screen (shows kills)

**Technical Details**:
- Enemies defined as types (zombie/imp/demon) with stats
- Simple chase AI with wall collision
- Sprites sorted far-to-near for proper overlap
- Hit detection uses ray projection + perpendicular distance
- Frame buffer compositing for sprite rendering

**Next Steps**:
1. doom-011: Pickups (health, ammo)
2. doom-017: Doors
3. doom-014: Multiple Levels
4. doom-026: Activate more enemy types
5. doom-025: Enemy Projectiles (imps throw fireballs)

---
