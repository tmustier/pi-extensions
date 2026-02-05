# Skill Design Patterns

Read this when deciding how to structure a skill's instructions or how to gather requirements from the user.

## Degrees of freedom

Match instruction specificity to how fragile or variable the task is. Think of the agent exploring a path: a narrow bridge with cliffs needs guardrails; an open field allows many routes.

**High freedom (prose instructions)** — multiple valid approaches, context-dependent decisions.

```markdown
## Code review
Review for correctness, readability, and performance.
Flag potential security issues. Suggest improvements.
```

**Medium freedom (pseudocode / parameterised scripts)** — a preferred pattern exists but some variation is acceptable.

```markdown
## Deploy
1. Build the project (`build_cmd` depends on framework).
2. Run smoke tests.
3. Push to the staging environment.
4. If smoke tests pass, promote to production.
```

**Low freedom (exact scripts, few parameters)** — operations are fragile, consistency is critical, or a specific sequence must be followed.

```markdown
## Rotate a PDF
Run the bundled script — do not rewrite the logic:
\`\`\`bash
python scripts/rotate_pdf.py --input "$FILE" --angle 90
\`\`\`
```

Default to high freedom unless you have evidence that the task is fragile.

## Progressive disclosure

Skills use three loading tiers to manage context:

1. **Frontmatter** (always loaded, ~100 words) — name + description trigger the skill.
2. **SKILL.md body** (loaded on trigger, aim for <500 lines) — core workflow.
3. **Bundled resources** (loaded on demand, unlimited) — scripts, references, assets.

### Pattern 1: High-level guide with references

```markdown
# PDF Processing

## Quick start
Extract text with pdfplumber:
[code example]

## Advanced features
- **Form filling**: See [references/forms.md](references/forms.md)
- **API reference**: See [references/api.md](references/api.md)
```

The agent loads each reference only when needed.

### Pattern 2: Domain-specific organisation

Organise by domain (or framework, provider, etc.) so the agent loads only the relevant slice:

```
bigquery-skill/
├── SKILL.md              # overview + navigation
└── references/
    ├── finance.md        # revenue, billing metrics
    ├── sales.md          # opportunities, pipeline
    └── product.md        # API usage, features
```

```
cloud-deploy/
├── SKILL.md              # workflow + provider selection
└── references/
    ├── aws.md
    ├── gcp.md
    └── azure.md
```

### Pattern 3: Conditional details

Show the basics inline; link to advanced content:

```markdown
# DOCX Processing

## Creating documents
Use docx-js. See [references/docx-js.md](references/docx-js.md).

## Editing documents
For simple edits, modify the XML directly.
- **Tracked changes**: See [references/redlining.md](references/redlining.md)
- **OOXML details**: See [references/ooxml.md](references/ooxml.md)
```

### Guidelines

- Keep references **one level deep** from SKILL.md — no chains of references pointing to further references.
- Add a **table of contents** to any reference file longer than ~100 lines.
- Information should live in SKILL.md **or** a reference file, not both.

## Gathering requirements

Before writing or updating a skill, collect 2–4 concrete example requests from the user. Good clarifying questions:

- "What functionality should the skill support?"
- "Can you show me example prompts that should trigger it?"
- "What would a good result look like for each example?"
- "Are there edge cases or things the skill should explicitly *not* do?"

Avoid asking too many questions at once — start with the most important ones and follow up as needed. Conclude when you have a clear picture of scope and trigger conditions.
