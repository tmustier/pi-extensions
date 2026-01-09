# arcade

[Snake](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/snake.ts) is cool, but have you tried:

- **sPIce-invaders** (`/spice-invaders`) - type `clawd` for a special challenge that gets harder every level
- **picman** (`/picman`)
- **ping** (`/ping`) - in a similar vein to [patriceckhart's](https://github.com/patriceckhart/pi-ng-pong)
- **tetris** (`/tetris`)
- **badlogic-game** (`/badlogic-game`) - Mario-style platformer (experimental)

<table>
  <tr>
    <td><img src="assets/spice-invaders.png" width="400"/></td>
    <td><img src="assets/picman.png" width="400"/></td>
  </tr>
  <tr>
    <td><img src="assets/ping.png" width="400"/></td>
    <td><img src="assets/tetris.png" width="400"/></td>
  </tr>
</table>

## Install

```bash
# All games
ln -s ~/pi-extensions/arcade/*.ts ~/.pi/agent/extensions/
ln -s ~/pi-extensions/arcade/badlogic-game/badlogic-game.ts ~/.pi/agent/extensions/

# Or individual games
ln -s ~/pi-extensions/arcade/spice-invaders.ts ~/.pi/agent/extensions/
ln -s ~/pi-extensions/arcade/picman.ts ~/.pi/agent/extensions/
ln -s ~/pi-extensions/arcade/ping.ts ~/.pi/agent/extensions/
ln -s ~/pi-extensions/arcade/tetris.ts ~/.pi/agent/extensions/
ln -s ~/pi-extensions/arcade/badlogic-game/badlogic-game.ts ~/.pi/agent/extensions/
```

Or add to `~/.pi/agent/settings.json`:

```json
{
  "extensions": [
    "~/pi-extensions/arcade/spice-invaders.ts",
    "~/pi-extensions/arcade/picman.ts",
    "~/pi-extensions/arcade/ping.ts",
    "~/pi-extensions/arcade/tetris.ts",
    "~/pi-extensions/arcade/badlogic-game/badlogic-game.ts"
  ]
}
```

