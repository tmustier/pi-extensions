# Ralph Wiggum Extension

Long-running agent loops for iterative development. Port of Geoffrey Huntley's approach.

## Commands

| Command | Description |
|---------|-------------|
| `/ralph start <name\|path>` | Start a new loop |
| `/ralph stop` | Pause current loop |
| `/ralph resume <name>` | Resume a paused loop |
| `/ralph status` | Show all loops |
| `/ralph cancel <name>` | Delete a loop |

### Options for start

| Option | Description |
|--------|-------------|
| `--max-iterations N` | Stop after N iterations |
| `--items-per-iteration N` | Suggest N items per turn (prompt hint) |
| `--reflect-every N` | Reflect every N iterations |

### Stopping During Streaming

To stop a loop while the agent is streaming, type `ralph-stop`. The message will be queued and processed when the turn ends, pausing the loop.

**Note:** ESC/abort won't stop the loop - you must type `ralph-stop`.

## How It Works

1. Create or use a markdown task file with goals and checklist
2. Agent works through the task iteratively
3. Task file is updated as progress is made
4. Agent outputs `<promise>COMPLETE</promise>` when done
5. Loop ends on completion or max iterations

## Agent Tool

The agent can self-start loops using `ralph_start`:

```
ralph_start({
  name: "refactor-auth",
  taskContent: "# Task\n\n## Checklist\n- [ ] Item 1",
  maxIterations: 50,
  itemsPerIteration: 3,
  reflectEvery: 10
})
```

## Credits

Based on Geoffrey Huntley's Ralph Wiggum approach for long-running agent tasks.
