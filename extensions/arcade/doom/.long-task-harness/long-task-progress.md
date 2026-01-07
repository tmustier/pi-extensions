# ASCII Doom - Progress Log

## Project Overview

**Started**: 2026-01-07
**Status**: In Progress  
**Repository**: git@github.com:tmustier/pi-extensions.git

---

## Current State (Session 3)

### Implemented Features (~22/38)

**MVP (14/14)** ✅
- Extension scaffold, map system, player movement, raycasting
- ASCII rendering, HUD stats, minimap, crosshair
- Title/help/pause screens, wall sliding collision

**Combat (7/9)**
- ✅ Enemy spawning (Z=zombie, I=imp, D=demon)
- ✅ Enemy AI (chase, attack)
- ✅ Shooting with hit detection
- ✅ Damage system, game over
- ✅ Sprite rendering with depth
- ✅ Multiple enemy types
- ❌ Enemy projectiles

**Items (2/6)**
- ✅ Pickups (H=health, A=ammo)
- ✅ Doors (auto-open, yellow render)
- ❌ Wall variation, barrels, keys

**Progression (4/7)**
- ✅ 3 levels with progression
- ✅ Victory screen with stats
- ✅ Level complete tracking
- ❌ Multiple weapons, automap, secrets

**Polish (1/5)**
- ✅ Visual effects (damage/muzzle flash)
- ❌ Save state, difficulty, audio, sprint

### What's Playable
- Full 3-level campaign
- 3 enemy types (zombie/imp/demon)
- Health and ammo pickups
- Automatic doors
- Kill/item tracking
- Level progression with carry-over stats

---

## Session Log

### Session 3 | 2026-01-07 | Commits: d8d3702..fbcc3cd

**Features Implemented:**
- doom-008, 008b: Enemies + AI
- doom-009, 010: Combat system
- doom-018: Sprite rendering
- doom-011: Pickups
- doom-014: 3 levels
- doom-017: Automatic doors
- doom-026: All enemy types

**Technical:**
- Frame buffer compositing for sprites
- DDA raycasting handles doors
- Entity definitions for easy expansion
- Level data uses simple character codes

**Next Session:**
1. doom-025: Enemy projectiles (imps shoot)
2. doom-019: Wall variation (textures)
3. doom-021: Automap (TAB)
4. doom-033: Sprint (Shift)
5. doom-034: Colored keys + locked doors

---
