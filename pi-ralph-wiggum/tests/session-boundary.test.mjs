import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ralphExtension from '../index.ts';

function makeCtx(cwd, sessionId = 'fresh-session') {
  return {
    cwd,
    sessionManager: { getSessionId: () => sessionId },
    hasUI: true,
    ui: {
      notify() {},
      setStatus() {},
      setWidget() {},
      confirm: async () => false,
      theme: {
        fg(_name, text) { return text; },
        bold(text) { return text; },
      },
    },
    isIdle: () => true,
    hasPendingMessages: () => false,
  };
}

function makePi() {
  const events = new Map();
  return {
    events,
    sentUserMessages: [],
    commands: new Map(),
    tools: new Map(),
    on(name, handler) { events.set(name, handler); },
    registerCommand(name, command) { this.commands.set(name, command); },
    registerTool(tool) { this.tools.set(tool.name, tool); },
    sendUserMessage(message, options) { this.sentUserMessages.push({ message, options }); },
  };
}

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-session-boundary-'));
fs.mkdirSync(path.join(cwd, '.ralph'), { recursive: true });
fs.writeFileSync(path.join(cwd, '.ralph', 'old-loop.md'), '# Old loop\n', 'utf8');
fs.writeFileSync(path.join(cwd, '.ralph', 'old-loop.state.json'), JSON.stringify({
  name: 'old-loop',
  taskFile: '.ralph/old-loop.md',
  iteration: 12,
  maxIterations: 1000,
  itemsPerIteration: 3,
  reflectEvery: 10,
  reflectInstructions: 'reflect',
  active: true,
  status: 'active',
  startedAt: '2026-07-08T11:54:18.989Z',
  lastReflectionAt: 0,
}, null, 2), 'utf8');

const pi = makePi();
ralphExtension(pi);
const ctx = makeCtx(cwd);

await pi.events.get('session_start')({}, ctx);
const result = await pi.events.get('before_agent_start')({ systemPrompt: 'base prompt' }, ctx);

assert.equal(
  result,
  undefined,
  'a fresh unrelated session must not bind repo-local active Ralph state or inject loop instructions before explicit /ralph resume',
);


const ownedCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-session-owned-'));
fs.mkdirSync(path.join(ownedCwd, '.ralph'), { recursive: true });
fs.writeFileSync(path.join(ownedCwd, '.ralph', 'owned-loop.md'), '# Owned loop\n', 'utf8');
fs.writeFileSync(path.join(ownedCwd, '.ralph', 'owned-loop.state.json'), JSON.stringify({
  name: 'owned-loop',
  taskFile: '.ralph/owned-loop.md',
  iteration: 4,
  maxIterations: 50,
  itemsPerIteration: 1,
  reflectEvery: 0,
  reflectInstructions: 'reflect',
  active: true,
  status: 'active',
  startedAt: '2026-07-08T11:54:18.989Z',
  lastReflectionAt: 0,
  ownerSessionId: 'same-session',
}, null, 2), 'utf8');

const ownedPi = makePi();
ralphExtension(ownedPi);
const ownedCtx = makeCtx(ownedCwd, 'same-session');
await ownedPi.events.get('session_start')({}, ownedCtx);
const ownedResult = await ownedPi.events.get('before_agent_start')({ systemPrompt: 'base prompt' }, ownedCtx);

assert.match(
  ownedResult?.systemPrompt ?? '',
  /RALPH LOOP - owned-loop - Iteration 4\/50/,
  'the originating session should still rehydrate its own active Ralph loop after reload or compaction',
);

console.log('session boundary test passed');
