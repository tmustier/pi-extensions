import importlib.util
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "validate_skill.py"
SPEC = importlib.util.spec_from_file_location("validate_skill", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class ValidateSkillTests(unittest.TestCase):
    def make_skill(self, root: Path, readme: str | None = None) -> Path:
        skill = root / "minimal-skill"
        skill.mkdir()
        (skill / "SKILL.md").write_text(
            "---\n"
            "name: minimal-skill\n"
            "description: A minimal valid Agent Skill fixture.\n"
            "---\n\n"
            "# Minimal skill\n"
        )
        if readme is not None:
            (skill / "README.md").write_text(readme)
        return skill

    def test_readme_is_optional_for_agent_skill_validation(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            errors, warnings = MODULE.validate_skill(self.make_skill(Path(tempdir)))
        self.assertEqual(errors, [])
        self.assertEqual(warnings, [])

    def test_publishing_mode_requires_readme(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            errors, _ = MODULE.validate_skill(
                self.make_skill(Path(tempdir)), require_readme=True
            )
        self.assertEqual(errors, ["README.md not found"])

    def test_existing_readme_keeps_installation_contract(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            errors, _ = MODULE.validate_skill(
                self.make_skill(Path(tempdir), "# Minimal skill\n\nSummary only.\n")
            )
        self.assertEqual(errors, ["README.md is missing an Installation section"])

    def test_valid_publishing_readme_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            errors, warnings = MODULE.validate_skill(
                self.make_skill(
                    Path(tempdir),
                    "# Minimal skill\n\nSummary.\n\n## Installation\n\nInstall it.\n",
                ),
                require_readme=True,
            )
        self.assertEqual(errors, [])
        self.assertEqual(warnings, [])


if __name__ == "__main__":
    unittest.main()
