# Workflow Patterns

Use these patterns when a skill needs repeatable, multi-step guidance.

## Sequential workflows

Give a short overview, then list steps in order:

```markdown
Process overview:
1. Analyze inputs
2. Prepare configuration
3. Run the main script
4. Validate outputs
```

## Conditional workflows

Provide a decision point, then branch to the right flow:

```markdown
1. Decide the task type:
   **Creating new content?** → Follow “Creation workflow” below
   **Editing existing content?** → Follow “Editing workflow” below

2. Creation workflow: [steps]
3. Editing workflow: [steps]
```

Keep each branch focused and include the exact commands or scripts to run when applicable.
