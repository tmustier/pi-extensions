import assert from "node:assert/strict";
import test from "node:test";
import tetris from "../arcade/tetris.ts";
import invaders from "../arcade/spice-invaders.ts";

// Exercise registered commands and UI components, with deterministic interval callbacks.
function arcade(t, extension) {
  const timers = new Map();
  let nextTimer = 1;
  t.mock.method(globalThis, "setInterval", (callback) => {
    const id = nextTimer++;
    timers.set(id, callback);
    return id;
  });
  t.mock.method(globalThis, "clearInterval", (id) => timers.delete(id));
  let handler;
  let saved;
  let closed;
  extension({
    registerCommand: (_name, command) => { handler = command.handler; },
    appendEntry: (_type, state) => { saved = structuredClone(state); },
  });
  return {
    async open(state) {
      saved = undefined;
      closed = false;
      let component;
      await handler("", {
        hasUI: true,
        sessionManager: { getEntries: () => state ? [{ type: "custom", customType: extension === tetris ? "tetris-save" : "spice-invaders-save", data: structuredClone(state) }] : [] },
        ui: { custom: (factory) => { component = factory({ requestRender() {} }, null, null, () => { closed = true; }); } },
      });
      t.after(() => component.dispose());
      return component;
    },
    tick(count = 1) {
      for (let i = 0; i < count; i++) for (const callback of [...timers.values()]) callback();
    },
    snapshot(component) {
      component.handleInput("\x1b");
      assert.equal(closed, true);
      return saved;
    },
    get timerCount() { return timers.size; },
  };
}

async function initial(game) {
  return game.snapshot(await game.open());
}

for (const key of ["a", "d", "s", "w", "z", "c", " "]) {
  test(`Tetris ignores ${JSON.stringify(key)} during row clearing`, async (t) => {
    const game = arcade(t, tetris);
    const state = await initial(game);
    state.board[19].fill("33");
    state.board[19][5] = state.board[19][6] = null;
    state.current = { type: "O", row: 18, col: 5, rotation: 0 };
    const component = await game.open(state);
    component.handleInput(" "); // Lock into a full row through public input.
    const before = component.render(100);
    component.handleInput(key);
    assert.deepEqual(component.render(100), before);
    game.tick(6);
    const after = game.snapshot(component);
    assert.equal(after.lines, 1);
    assert.deepEqual(after.clearingRows, []);
    assert.equal(after.held, null);
    assert.equal(after.current.type, state.queue[0]);
  });
}

test("Tetris session controls work while clearing, and pause freezes the animation", async (t) => {
  const game = arcade(t, tetris);
  const state = await initial(game);
  state.board[19].fill("33");
  state.clearingRows = [19];
  const component = await game.open(state);
  component.handleInput("p");
  assert.match(component.render(100).join("\n"), /PAUSED/);
  game.tick(10);
  component.handleInput("p");
  const saved = game.snapshot(component);
  assert.equal(saved.clearAnimTicks, 0);
  assert.deepEqual(saved.clearingRows, [19]);
});

test("Tetris held spawn checks collision and preserves high score", async (t) => {
  const game = arcade(t, tetris);
  const state = await initial(game);
  state.held = "O";
  state.board[0][5] = "33";
  state.score = 123;
  const component = await game.open(state);
  component.handleInput("c");
  assert.match(component.render(100).join("\n"), /GAME OVER/);
  component.handleInput("r");
  assert.equal(game.snapshot(component).highScore, 123);
});

test("Tetris held spawn resets grounded lock delay", async (t) => {
  const game = arcade(t, tetris);
  const state = await initial(game);
  state.held = "O";
  state.current = { type: "O", rotation: 0, row: 18, col: 0 };
  state.lockDelay = 9;
  state.board[2][5] = state.board[2][6] = "33";
  const component = await game.open(state);
  component.handleInput("c");
  game.tick();
  const saved = game.snapshot(component);
  assert.equal(saved.current.type, "O");
  assert.equal(saved.lockDelay, 1);
  assert.equal(saved.canHold, false);
  assert.equal(saved.board[0][5], null);
});

for (const phase of ["scatter", "descend"]) {
  for (const key of ["p", " ", "a", "r"]) {
    test(`sPIce Invaders resumes saved ${phase} with ${JSON.stringify(key)}`, async (t) => {
      const game = arcade(t, invaders);
      const component = await game.open();
      for (const char of "clawd") component.handleInput(char);
      let saved = game.snapshot(component);
      if (phase === "descend") {
        saved.scatterInvaders = [{ x: 24, y: 0, vx: 1, vy: 1 }];
        const scattering = await game.open(saved);
        scattering.handleInput("p");
        game.tick();
        saved = game.snapshot(scattering);
      }
      assert.equal(saved.bossIntroPhase, phase);
      const restored = await game.open(saved);
      assert.equal(game.timerCount, 0);
      restored.handleInput(key);
      assert.equal(game.timerCount, 1);
      game.tick(30);
      const after = game.snapshot(restored);
      assert.equal(after.bossIntroPhase, null);
      assert.equal(after.boss.active, true);
    });
  }
}

test("sPIce Invaders can pause the intro and cannot complete a cheat while paused", async (t) => {
  const game = arcade(t, invaders);
  const component = await game.open();
  for (const char of "claw") component.handleInput(char);
  component.handleInput("p");
  component.handleInput("d"); // Resume only; must not complete the cheat.
  assert.equal(game.timerCount, 1);
  assert.equal(game.snapshot(component).bossIntroPhase, null);

  const intro = await game.open();
  for (const char of "clawd") intro.handleInput(char);
  intro.handleInput("p");
  assert.equal(game.timerCount, 0);
  assert.match(intro.render(100).join("\n"), /PAUSED/);
  intro.handleInput("p");
  assert.equal(game.timerCount, 1);
  assert.equal(game.snapshot(intro).bossIntroPhase, "scatter");
});

for (const restart of ["r", " "]) {
  test(`sPIce Invaders ignores game-over cheat and restarts with ${JSON.stringify(restart)}`, async (t) => {
    const game = arcade(t, invaders);
    const state = await initial(game);
    state.lives = 1;
    state.invaderBullets = [{ x: state.playerX, y: 15, from: "invader" }];
    const component = await game.open(state);
    component.handleInput("p");
    game.tick();
    assert.match(component.render(100).join("\n"), /GAME OVER/);
    for (const char of "clawd") component.handleInput(char);
    component.handleInput(restart);
    assert.doesNotMatch(component.render(100).join("\n"), /GAME OVER/);
    const saved = game.snapshot(component);
    assert.equal(saved.gameOver, false);
    assert.equal(saved.bossIntroPhase, null);
    assert.equal(saved.lives, 3);
  });
}
