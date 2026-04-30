---
name: pi-ralph-wiggum
description: Long-running iterative development loops with pacing control and verifiable progress. Use when tasks require multiple iterations, many discrete steps, or periodic reflection with clear checkpoints; avoid for simple one-shot tasks or quick fixes.
---

# Ralph Wiggum - Long-Running Development Loops

Use the `ralph_start` tool to begin a loop:

```
ralph_start({
  name: "loop-name",
  taskContent: "# Task\n\n## Goals\n- Goal 1\n\n## Checklist\n- [ ] Item 1\n- [ ] Item 2",
  maxIterations: 50,        // Default: 50
  itemsPerIteration: 3,     // Optional: suggest N items per turn
  reflectEvery: 10          // Optional: reflect every N iterations
})
```

## Loop Behavior

1. **Write the task file**: Create `.ralph/<name>.md` with the task content. The tool does NOT create this file—you must write it yourself using the Write tool.
2. Work on the task and update the file each iteration.
3. Record verification evidence (commands run, file paths, outputs) in the task file.
4. Call `ralph_done` to proceed to the next iteration.
5. Before outputting `<promise>COMPLETE</promise>`, run a final verification command that an external monitor can rerun from the same worktree.
6. Stop when complete or when max iterations is reached (default 50).

## Completion Gate

For build/test/refactor tasks, do not mark complete based only on checked checklist items.

Before emitting `<promise>COMPLETE</promise>`:

- Preserve any build artifacts, generated files, virtualenvs, or environment setup required by the final verification command.
- Record the exact final command, working directory, relevant environment variables, and output summary in the task file.
- Ensure the command can be rerun by a separate monitor in a fresh shell from the same worktree.
- If a test cannot be rerun externally, mark the item blocked or deferred instead of complete.
- If cleanup removes required verification artifacts, recreate them or update the final command before completion.

## User Commands

- `/ralph start <name|path>` - Start a new loop.
- `/ralph resume <name>` - Resume loop.
- `/ralph stop` - Pause loop (when agent idle).
- `/ralph-stop` - Stop active loop (idle only).
- `/ralph status` - Show loops.
- `/ralph list --archived` - Show archived loops.
- `/ralph archive <name>` - Move loop to archive.
- `/ralph clean [--all]` - Clean completed loops.
- `/ralph cancel <name>` - Delete loop.
- `/ralph nuke [--yes]` - Delete all .ralph data.

Press ESC to interrupt streaming, send a normal message to resume, and run `/ralph-stop` when idle to end the loop.

## Task File Format

```markdown
# Task Title

Brief description.

## Goals
- Goal 1
- Goal 2

## Checklist
- [ ] Item 1
- [ ] Item 2
- [x] Completed item

## Verification
- Commands run, working directories, relevant environment variables, outputs, and whether artifacts required for reruns were preserved

## Final Verification
- Exact monitor-rerunnable command: `<command>`
- Working directory: `<path>`
- Required preserved artifacts: `<paths>`
- Result: `<output summary>`

## Notes
(Update with progress, decisions, blockers)
```

## Best Practices

1. Write a clear checklist with discrete items.
2. Update checklist and notes as you go.
3. Capture verification evidence for completed items.
4. Reflect when stuck to reassess approach.
5. Preserve the environment needed to rerun final verification.
6. Output the completion marker only when truly done and externally rerunnable.
