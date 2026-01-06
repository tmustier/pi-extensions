# pi-extensions

Small set of personal extensions for the Pi coding agent.

## Extensions

- `extensions/tab-status.ts`: updates the terminal tab title with Pi run status.
- `extensions/space-invaders.ts`: Space Invaders game extension (`/space-invaders`).
- `extensions/paddle-ball.ts`: Paddle Ball (Pong-style) game extension (`/ping`, alias `/paddle-ball`).

## Install

Add the extension path(s) to `~/.pi/agent/settings.json`:

```
{
  "extensions": [
    "~/pi-extensions/extensions/tab-status.ts",
    "~/pi-extensions/extensions/space-invaders.ts",
    "~/pi-extensions/extensions/paddle-ball.ts"
  ]
}
```
