# Changelog

All notable changes to this extension will be documented in this file.

## [0.1.6] - 2026-01-24

### Added
- Clearer install instructions and dependency notes in README

## [0.1.5] - 2026-01-24

### Added
- Demo recording embedded in README

### Changed
- Comment sending now queues with follow-up delivery in streaming sessions
- Split viewer logic into `viewer.ts` and shared helpers
- Reduced browser render duplication with node format helpers

## [0.1.4] - 2026-01-24

### Changed
- Split viewer logic into `viewer.ts` and shared helpers
- Reduced browser render duplication with node format helpers

## [0.1.3] - 2026-01-24

### Changed
- `c` in viewer now opens an inline comment prompt and sends a follow-up message

## [0.1.2] - 2026-01-24

### Changed
- `c` in viewer now appends selection to editor input instead of sending immediately

## [0.1.1] - 2026-01-24

### Added
- README with install steps, dependencies, and keybindings

### Changed
- Refactored into modular files (browser, git, tree, viewer, utils)

## [0.1.0] - 2026-01-24

### Added
- `/files` command opens full-screen file browser
- File tree with j/k navigation, Enter to open, h/l to collapse/expand
- File viewer with syntax highlighting via `bat`
- Markdown rendering via `glow`
- Git diff view via `delta` with line numbers
- Git status indicators (M, A, D, ?) on files
- Agent-modified file tracking (🤖 indicator)
- Changed files filter (`c` to toggle)
- Jump to next/prev changed file (`]`/`[`)
- Search in file tree (`/` then type)
- Search in file viewer (`/` then type, `n`/`N` for next/prev match)
- Select mode (`v`) to select lines and comment (`c`) to send to agent
- Line counts and diff stats (+/-) on files and collapsed folders
- Auto-refresh git status every 3 seconds (preserves expansion state)
- PageUp/PageDown support in browser and viewer
- Height adjustment (`+`/`-`)
- Works in non-git directories (git features gracefully disabled)

### Dependencies
- `bat` - syntax highlighting (recommended)
- `glow` - markdown rendering (recommended)
- `delta` - diff formatting (recommended)

Install with: `brew install bat git-delta glow`
