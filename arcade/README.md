# arcade

[Snake](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/snake.ts) is cool, but have you tried:

- **sPIce-invaders** (`/space-invaders`) - type `clawd` for a special challenge that gets harder every level
- **picman** (`/picman`)
- **ping** (`/ping`) - in a similar vein to [patriceckhart's](https://github.com/patriceckhart/pi-ng-pong)
- **tetris** (`/tetris`)

![spice-invaders](assets/spice-invaders.png)
![picman](assets/picman.png)
![ping](assets/ping.png)
![tetris](assets/tetris.png)

## Install

```bash
# All games
ln -s ~/pi-extensions/arcade/*.ts ~/.pi/agent/extensions/

# Or individual games
ln -s ~/pi-extensions/arcade/space-invaders.ts ~/.pi/agent/extensions/
ln -s ~/pi-extensions/arcade/pacman.ts ~/.pi/agent/extensions/
ln -s ~/pi-extensions/arcade/ping.ts ~/.pi/agent/extensions/
ln -s ~/pi-extensions/arcade/tetris.ts ~/.pi/agent/extensions/
```

Or add to `~/.pi/agent/settings.json`:

```json
{
  "extensions": [
    "~/pi-extensions/arcade/space-invaders.ts",
    "~/pi-extensions/arcade/pacman.ts",
    "~/pi-extensions/arcade/ping.ts",
    "~/pi-extensions/arcade/tetris.ts"
  ]
}
```

## WIP / Coming Soon

- not-mario (`wip/badlogic-game.ts`)
- ASCII doom (`wip/doom-ascii.ts`)
