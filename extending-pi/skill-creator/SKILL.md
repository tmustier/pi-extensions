---
name: skill-creator
description: Create or update Agent Skills (SKILL.md plus optional scripts, references, or assets). Use when someone asks to design a new Agent Skill, refine an existing one, or structure skills for Pi discovery, packaging, or other Agent Skills-compatible clients.
---

# Skill Creator

Provide guidance for creating effective **Agent Skills** that Pi and other compatible agent clients can load.

## Principles

- **Activation**: in Pi, automatic skill loading is driven by the frontmatter `description`; "when to use" details in the body come too late for auto-triggering.
- **Interoperability**: call these artifacts Agent Skills, not client-specific skill names. Keep Pi-specific discovery or packaging notes clearly scoped to Pi.

## Agent Skills format (Pi-compatible)

- Required frontmatter: `name`, `description`. Directory name must equal `name`.
- Name rules: 1–64 chars, lowercase letters/digits/hyphens, no leading/trailing/consecutive hyphens.
- Optional frontmatter: `license`, `compatibility`, `metadata` (arbitrary key-value pairs for tooling), `allowed-tools` (experimental; support varies by client).
- `disable-model-invocation`: when set, Pi will not auto-trigger the skill; the user must invoke it explicitly with `/skill:name`.
- Paths are relative to the skill directory; `{baseDir}` placeholders are not supported.
- Pi loads Agent Skills from `~/.pi/agent/skills/`, `~/.agents/skills/`, `.pi/skills/`, `.agents/skills/`, package `skills` entries, settings `skills`, or `--skill <path>`.

## Recommended structure

```
agent-skill/
├── SKILL.md
├── README.md         # Optional: human summary + installation
├── scripts/          # Optional executables
├── references/       # Optional docs loaded on demand
└── assets/           # Optional templates/assets
```

## Workflow

### 1) Clarify use cases

2–4 concrete example requests usually suffice to scope triggers and functionality.

### 2) Plan reusable resources

For each example, decide if you need:
- **scripts/** for deterministic tasks
- **references/** for long docs or schemas
- **assets/** for templates or boilerplate

### 3) Create the skeleton

An Agent Skill needs a directory containing a `SKILL.md`. Only add resource sub-directories that are actually needed.

```bash
mkdir -p ~/.pi/agent/skills/my-skill
touch ~/.pi/agent/skills/my-skill/SKILL.md
```

Use `.agents/skills/` when you want the same skill directory to be naturally discoverable by other Agent Skills-compatible clients too.

### 4) Optional: Write README.md (humans + installation)

If you plan to share the skill with humans, a README.md helps discovery and installation. If you have a README, installation info can live there to save space in SKILL.md.

```markdown
# My Skill

Short summary for humans discovering the skill.

## Installation
`pi install git:github.com/org/my-skill`
```

### 5) Write frontmatter

Use only the fields you need.

```markdown
---
name: my-skill
description: What it does + when to use it.
---
```

If you need to hide auto-invocation in Pi, set:

```yaml
disable-model-invocation: true
```

### 6) Write the body

- Imperative phrasing works well for procedural instructions; context framing works better for guidance (see Principles).
- ~500 lines is a practical ceiling for SKILL.md; beyond that, split content into references.
- The agent will not know a reference file exists unless SKILL.md says when to read it.

### 7) Add resources

SKILL.md is the agent's interface to the skill — usage examples and input/output descriptions let it call scripts without needing to understand internals.

- **scripts/**: usage examples in SKILL.md inform the agent how to call them; scripts should be executable.
- **references/**: a table of contents helps the agent navigate files longer than ~100 lines. References work best one level deep from SKILL.md, and each fact should live in one place (SKILL.md or a reference, not both).
- **assets/**: templates, boilerplate, or data used in final output — typically not loaded into context.

### 8) Validate and test

- Run the bundled validator at `scripts/validate_skill.py` from this `skill-creator` directory (uses [`uv`](https://docs.astral.sh/uv/) via a PEP 723 shebang, so PyYAML is provisioned in an ephemeral environment — no system install needed):

```bash
scripts/validate_skill.py /path/to/my-skill
# or, equivalently:
uv run scripts/validate_skill.py /path/to/my-skill
```

- Load only the skill in Pi to spot warnings:

```bash
pi --no-skills --skill /path/to/my-skill
```

- Invoke it explicitly:

```bash
/skill:my-skill
```

- After edits, use `/reload`.

### 9) Publish (optional)

When the user wants to share an Agent Skill with Pi users, read `references/PUBLISHING.md`. In short: make it installable with `pi install` from npm, git, or a local source; use either a `package.json` `pi.skills` manifest or the conventional `skills/` directory; Pi does not use `.skill` archives.
