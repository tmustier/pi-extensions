# pi-extensions

Small set of personal extensions for the Pi coding agent.

## Extensions

- `extensions/tab-status.ts`: updates the terminal tab title with Pi run status.
- `extensions/space-invaders.ts`: Lobster Invaders (Space Invaders-style) game extension (`/space-invaders`).
- `extensions/ping.ts`: Ping (Pong-style) game extension (`/ping`).
- `extensions/pacman.ts`: Pac-Man game extension (`/pacman`).
- `extensions/tetris.ts`: Tetris game extension (`/tetris`).

## Install

Add the extension path(s) to `~/.pi/agent/settings.json`:

```
{
  "extensions": [
    "~/pi-extensions/extensions/tab-status.ts",
    "~/pi-extensions/extensions/space-invaders.ts",
    "~/pi-extensions/extensions/ping.ts",
    "~/pi-extensions/extensions/pacman.ts",
    "~/pi-extensions/extensions/tetris.ts"
  ]
}
```
