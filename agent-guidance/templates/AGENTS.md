# AGENTS.md

Universal guidelines for all AI coding agents.

## Communication
- Be concise and direct
- Show file paths clearly when working with files
- When summarizing actions, output plain text directly

## Code Quality
- Fix root cause, not band-aids
- Keep files under ~500 LOC; split/refactor as needed
- Bugs: add regression test when it fits
- New deps: quick health check (recent releases/commits, adoption)

## Git
- Safe by default: `git status/diff/log` freely
- Push only when asked
- Branch changes require user consent
- Destructive ops forbidden unless explicit (`reset --hard`, `clean`, `restore`)
- No repo-wide search/replace scripts; keep edits small/reviewable
- Commits: use Conventional Commits (`feat|fix|refactor|build|ci|chore|docs|style|perf|test`)

## Build / Test
- Before handoff: run full gate (lint/typecheck/tests)
- CI red: fix and push until green

## Critical Thinking
- Unsure: read more code; if still stuck, ask with short options
- Conflicts in instructions: call out; pick safer path
- Don't delete/rename unexpected stuff; stop and ask
