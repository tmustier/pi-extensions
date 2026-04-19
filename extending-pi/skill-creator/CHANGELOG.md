# Changelog

## 0.3.1 - 2026-04-19
- `validate_skill.py` is now self-contained: uses a PEP 723 `uv run --script` shebang so PyYAML is provisioned in an ephemeral environment instead of requiring a system-wide install. Thanks to @tekumara for reporting ([#20](https://github.com/tmustier/pi-extensions/issues/20)).

## 0.3.0 - 2026-02-05
- Moved under `extending-pi/skill-creator/` (nested skill structure).
- Renamed skill from `pi-skill-creator` to `skill-creator` to match new directory.

## 0.2.0 - 2026-02-05
- Consolidate into standalone SKILL.md: remove references/ directory (design-patterns, workflows, output-patterns).
- Reframe directives as context throughout — add "Context over directives" principle.
- Add Activation principle (description is the sole trigger).
- Fold Pi-specific reference guidelines (one level deep, no duplication) into step 7.
- Clarify optional frontmatter fields, `disable-model-invocation`, and name rules.

## 0.1.0 - 2026-02-05
- Initial release.
