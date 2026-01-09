# badlogic-game (experimental)

Mario-style TUI platformer. This project is experimental and tuning is in flux.

## Run

- Command: `/badlogic-game`
- Extension entrypoint: `arcade/badlogic-game/badlogic-game.ts`

## Controls

- Move: Left/Right arrows, A/D, L
- Jump: Up, Space, H
- Walk toggle: X (run is default)
- Pause: P
- Stop: S
- Quit: Q or Esc

## Dev

Tests:

```bash
node --test arcade/badlogic-game/tests/*.test.js
npx tsc --noEmit -p arcade/badlogic-game/tsconfig.json
```

Spec:

- `arcade/badlogic-game/spec.md`
