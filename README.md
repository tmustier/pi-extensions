# pi-extensions

Small set of personal extensions for the Pi coding agent.

## Extensions

### Utilities
- `extensions/tab-status.ts`: updates the terminal tab title with Pi run status.

### Arcade Games
- `extensions/arcade/space-invaders.ts`: Lobster Invaders (`/space-invaders`)
- `extensions/arcade/ping.ts`: Ping - Pong-style (`/ping`)
- `extensions/arcade/pacman.ts`: Picman - Pi-themed Pac-Man (`/picman`)
- `extensions/arcade/tetris.ts`: Tetris (`/tetris`)
- `extensions/arcade/doom/doom.ts`: ASCII Doom - first-person raycaster (`/doom`)

## Install

Add the extension path(s) to `~/.pi/agent/settings.json`:

```json
{
  "extensions": [
    "~/pi-extensions/extensions/tab-status.ts",
    "~/pi-extensions/extensions/arcade/space-invaders.ts",
    "~/pi-extensions/extensions/arcade/ping.ts",
    "~/pi-extensions/extensions/arcade/pacman.ts",
    "~/pi-extensions/extensions/arcade/tetris.ts",
    "~/pi-extensions/extensions/arcade/doom/doom.ts"
  ]
}
```
