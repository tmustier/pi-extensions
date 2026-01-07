# ASCII Doom - Progress Log

## Project Overview

**Location**: `extensions/arcade/doom/doom.ts` (~550 lines)
**Command**: `/doom` in Pi
**Repository**: git@github.com:tmustier/pi-extensions.git

---

## Current State

### Implemented (22/38 features)

**Core Game:**
- DDA raycasting engine with depth shading (█▓▒░)
- WASD movement with wall sliding collision
- Q/E rotation, crosshair, minimap overlay
- Title, help, pause, game over, victory screens

**Combat:**
- 3 enemy types: Z=zombie, I=imp, D=demon
- Enemy AI: chase player, attack when close
- Hitscan shooting, 25 damage per shot
- Damage flash, muzzle flash effects

**Levels & Items:**
- 3 progressive levels with increasing difficulty
- H=health (+25), A=ammo (+15) pickups
- Automatic doors (=) that open when player approaches
- E=exit to complete level, stats carry over

**HUD:** Health bar, ammo count, kills, items, level number

### Not Yet Implemented (16 features)

- Enemy projectiles (imps should shoot)
- Multiple weapons (pistol/shotgun/chaingun)
- Automap (TAB key)
- Colored keys + locked doors
- Wall texture variation
- Explosive barrels
- Secrets
- Sprint (Shift)
- Save/resume state
- Difficulty settings
- Terminal bell audio

---

## Technical Notes

**Level format:** String array, each char = cell type
```
#=wall .=floor ==door E=exit P=player
Z=zombie I=imp D=demon H=health A=ammo
```

**Key functions:**
- `castRay()` - DDA raycasting, returns dist/side/isDoor
- `getSprites()` - Calculates screen position for enemies/pickups
- `render3DView()` - Frame buffer compositing
- `updateEnemies()` - AI tick
- `updateDoors()` - Auto-open/close logic

**Entity definitions:** `ENEMY_DEFS`, `PICKUP_DEFS` objects for easy expansion

---

## Next Steps

1. `doom-025`: Enemy projectiles
2. `doom-021`: Automap (TAB)
3. `doom-033`: Sprint (Shift)
4. `doom-034`: Keys + locked doors
5. `doom-020`: Multiple weapons

---

## Session History

| Session | Commits | Features Added |
|---------|---------|----------------|
| 1 | 3d9ecdf | Project init, 38 features planned |
| 2 | 48f9a48..d8d3702 | MVP: raycasting, movement, screens |
| 3 | 02947f9..d16aa2f | Combat, pickups, 3 levels, doors |

---
