# Agent Skill Creator

Guidelines and templates for creating Agent Skills that follow the Agent Skills format and can be loaded by Pi and other compatible agent clients.

## Installation
`pi install npm:@tmustier/pi-skill-creator`

## Validator script

`scripts/validate_skill.py` uses a [PEP 723](https://peps.python.org/pep-0723/) `uv run --script` shebang so PyYAML is provisioned in an ephemeral environment — no system-wide Python packages required.

Prerequisite: install [`uv`](https://docs.astral.sh/uv/getting-started/installation/) (e.g. `brew install uv` or `curl -LsSf https://astral.sh/uv/install.sh | sh`), then:

```bash
scripts/validate_skill.py /path/to/my-skill
# or, equivalently:
uv run scripts/validate_skill.py /path/to/my-skill
```
