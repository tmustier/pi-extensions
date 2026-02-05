# Output Patterns

Use these patterns when a skill needs consistent output quality.

## Template pattern (strict)

Provide a fixed structure when format matters:

```markdown
## Report structure

ALWAYS follow this exact template:

# [Title]

## Executive summary
[One paragraph]

## Key findings
- Finding 1
- Finding 2
- Finding 3

## Recommendations
1. Actionable recommendation
2. Actionable recommendation
```

## Template pattern (flexible)

Provide a default structure but allow adaptation:

```markdown
## Report structure

Use this as a default, but adjust as needed:

# [Title]

## Summary
[Overview]

## Findings
[Adapt sections based on evidence]

## Recommendations
[Tailor to the context]
```

## Examples pattern

Show input/output pairs to lock in style:

```markdown
Input: Add caching to API responses
Output:
feat(api): add response caching

Cache GET /reports for 10 minutes to reduce load
```
