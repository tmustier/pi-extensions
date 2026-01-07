---
name: ralph-wiggum
description: Long-running iterative development loops with pacing control. Use when a task requires sustained multi-turn work, has multiple steps that build on each other, or benefits from periodic reflection. Call ralph_start to begin a loop on yourself. Do NOT use for simple one-shot tasks or quick fixes.
---

# Ralph Wiggum

Run iterative loops on yourself for complex, multi-step tasks.

## Tool: ralph_start

```typescript
ralph_start({
  name: "feature-name",
  taskContent: "# Task\n...",     // Markdown with goals + checklist
  itemsPerIteration: 5,           // Process 5 items per turn, then stop
  reflectEveryItems: 50,          // Reflect every 50 items
  maxIterations: 100              // Safety limit (default: 50)
})
```

## Pacing

- `itemsPerIteration`: Controls how many checklist items per turn
- `reflectEveryItems`: Reflect every N items (not iterations)
- Each iteration = 1 agent turn processing N items

Example: 100 items, 5 per iteration, reflect every 50:
- 20 iterations total
- Reflection at iterations 10 and 20

## Task Content Format

```markdown
# Task: [Title]

[What needs to be done]

## Checklist
- [ ] Item 1
- [ ] Item 2
... (many items)

## Notes
(Update as you work)
```

## Loop Behavior

1. Each iteration: process N items, update task file, stop
2. Check off completed items in `.ralph/<name>.md`
3. When all done, output: `<promise>COMPLETE</promise>`

## User Commands

- `/ralph stop` - Pause loop
- `/ralph resume <name>` - Resume loop
- `/ralph status` - Show loops
- `/ralph cancel <name>` - Delete loop
- `ctrl+shift+r` - Stop loop (works during streaming)
