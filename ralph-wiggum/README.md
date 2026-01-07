# Ralph Wiggum Extension

Long-running agent loops for iterative development. Best for long-running-tasks that are verifiable. Builds on Geoffrey Huntley's ralph-loop for Claude Code and adapts it for Pi.
This implementation for Pi 0.37.x allows:
- self-start by the agent (Pi can define and run the loop on itself in session, or on a 'subagent' Pi via tmux)
- multiple parallel loops in the same repository at the same time
- optional self-reflection at user-specified intervals

## Recommended usage: just ask Pi
Ask Pi to set up a ralph-wiggum loop. 
- Pi will create (or reuse) a task file in `.ralph/<name>.md`. The file can contain literally anything as long as it has goals and a checklist to tick through during the iterations, but Pi has guidance on setting it up in SKILL.md.
- You should let Pi know:
  - What the task is and completion / tests to run
  - How many items to process per iteration
  - How often to commit
  - (optionally) After how many items it should take a step back and self-reflect
- Then, Pi can run `ralph_start`, beginning iteration 1.

Each iteration:
- Pi gets a prompt telling it to work on the task, update the task file, and call ralph_done when it finishes that iteration
- When the agent calls ralph_done, the prompt gets resent and the next iteration starts
- Optionally, every N iterations, the agent is prompted to pause reflect on the work so far and record this in the task file (`--reflect-every N`)
- The loop cancels when either:
  a. The assistant outputs <promise>COMPLETE</promise>
  b. The loop reaches max iterations (default 50)
  c. The user hits `esc` then `/ralph-stop` (`esc` then a normal message like "continue" will resume the loop)

## Commands

| Command | Description |
|---------|-------------|
| `/ralph start <name\|path>` | Start a new loop |
| `/ralph stop` | Pause current loop |
| `/ralph resume <name>` | Resume a paused loop |
| `/ralph status` | Show all loops |
| `/ralph cancel <name>` | Delete a loop |
| `/ralph archive <name>` | Move loop to archive |
| `/ralph clean [--all]` | Clean completed loops |
| `/ralph list --archived` | Show archived loops |
| `/ralph nuke [--yes]` | Delete all .ralph data |
| `/ralph-stop` | Stop active loop (idle only) |

### Options for start

| Option | Description |
|--------|-------------|
| `--max-iterations N` | Stop after N iterations |
| `--items-per-iteration N` | Suggest N items per turn (prompt hint) |
| `--reflect-every N` | Reflect every N iterations |

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
