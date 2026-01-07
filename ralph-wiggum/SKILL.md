---
name: ralph-wiggum
description: Long-running iterative development loops. Use when a task requires sustained multi-turn work, has multiple steps that build on each other, or benefits from periodic reflection. Call ralph_start to begin a loop on yourself. Do NOT use for simple one-shot tasks or quick fixes.
---

# Ralph Wiggum

Run iterative loops on yourself for complex, multi-step tasks.

> **Note**: This skill requires the extension to be loaded in `settings.json`:
> ```json
> "extensions": ["~/.pi/agent/pi-skills/ralph-wiggum/index.ts", ...]
> ```

## Tool: ralph_start

```typescript
ralph_start({
  name: "feature-name",           // Loop identifier
  taskContent: "# Task\n...",     // Markdown with goals + checklist
  maxIterations: 50,              // Safety limit (default: 50)
  reflectEvery: 10                // Optional reflection interval
})
```

## Task Content Format

```markdown
# Task: [Title]

[What needs to be done]

## Goals
- Measurable goal 1
- Measurable goal 2

## Checklist
- [ ] Step 1
- [ ] Step 2

## Notes
(Update as you work)
```

## Loop Behavior

1. Each iteration: receive task content, do work, update task file
2. Check off completed items in `.ralph/<name>.md`
3. After each response, the extension auto-injects the next iteration prompt
4. When done, output: `<promise>COMPLETE</promise>`

## User Commands

- `/ralph start <name>` - Start a new loop
- `/ralph stop` - Pause current loop
- `/ralph resume <name>` - Resume a paused loop
- `/ralph status` - Show all loops
- `/ralph cancel <name>` - Delete a loop

## Troubleshooting

**Loop not auto-continuing?**
- Ensure the extension is in `settings.json` extensions array
- Restart Pi Agent after adding the extension
- Check `/ralph status` to see if loop is active
