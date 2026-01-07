# Ralph Wiggum - Long-Running Development Loops

Long-running iterative development loops with pacing control.

## When to Use

- Complex tasks requiring multiple iterations
- Tasks with many discrete steps that build on each other
- Work that benefits from periodic reflection

Do NOT use for simple one-shot tasks or quick fixes.

## Agent Tool

Call `ralph_start` to begin a loop on yourself:

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

1. Task content is saved to `.ralph/<name>.md`
2. Each iteration: work on task, update file
3. Call `ralph_done` tool to proceed to next iteration
4. When complete: output `<promise>COMPLETE</promise>`
5. Loop ends on completion or max iterations

## User Commands

- `/ralph stop` - Pause loop (when agent idle)
- `/ralph resume <name>` - Resume loop
- `/ralph status` - Show loops
- `/ralph cancel <name>` - Delete loop
- Type `ralph-stop` during streaming - Pauses the loop (ESC won't work)

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

## Notes
(Update with progress, decisions, blockers)
```

## Best Practices

1. **Clear checklist**: Break work into discrete items
2. **Update as you go**: Mark items complete, add notes
3. **Reflect when stuck**: Use reflection to reassess approach
4. **Complete properly**: Only output completion marker when truly done
