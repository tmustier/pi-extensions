# Update notes

Pi 1.5 and later use this file for startup notices. The full history is in
`CHANGELOG.md`. Releases without an entry here do not need a startup notice.

Keep entries short and explain what changes for the user or what they need to
do. Omit internal refactors, tests, metadata and routine dependency updates.
Use released package versions in `## [x.y.z]` headings. Do not add empty version
headings, an Unreleased section, or a notice about these notices.

## [0.2.4]

- Opening `/readfiles` and refreshing git information no longer freeze Pi.
- Files with spaces, non-ASCII names and staged renames now show the right git status.
- After searching in the viewer, press `n` or `N` to move between matches.
