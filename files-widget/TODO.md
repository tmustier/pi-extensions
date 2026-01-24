# Editor Extension - Implementation Checklist

## Pre-requisites
- [x] Check for required tools (`bat`, `delta`, `glow`, `fd`) and document install commands
- [ ] Verify pi-tui capabilities for widget sizing and keyboard handling

## Phase 1: File Browser Widget

### Scaffold
- [x] Create `index.ts` extension entry point
- [ ] Register `Ctrl+E` toggle shortcut
- [x] Basic widget rendering with placeholder content

### File Tree
- [x] Build file tree from current directory
- [ ] Respect `.gitignore` (use `fd` or manual parsing)
- [x] Collapse/expand directories
- [x] Navigation with `j/k` and arrow keys
- [x] Enter to expand dir or open file

### Git Integration
- [x] Parse `git status --porcelain` output
- [x] Show indicators: M (modified), ? (untracked), A (added), D (deleted)
- [x] Color coding: green (staged), yellow (unstaged), grey (untracked)

### Search
- [x] `/` to enter search mode
- [ ] Fuzzy match file names
- [ ] Highlight matches, Enter to jump

## Phase 2: File Viewer

### Basic Viewer
- [x] `ctx.ui.custom()` full-screen component
- [x] Load file content
- [x] Line numbers
- [x] Scroll with `j/k`, `PgUp/PgDn`, `g/G`
- [x] `q` to close

### Syntax Highlighting
- [x] Detect `bat` availability
- [x] Shell out to `bat` for highlighting
- [x] Parse ANSI output for display
- [x] Fallback to plain text with line numbers

### Markdown Rendering
- [x] Detect `glow` availability
- [x] Shell out to `glow` for .md files
- [ ] Toggle between rendered and raw (`m` key?)
- [x] Fallback to syntax-highlighted raw

### Diff View
- [x] `d` to toggle diff mode
- [x] Shell out to `git diff HEAD -- <file>`
- [x] Use `delta` if available for nicer output
- [x] Show only if file has changes

## Phase 3: Select + Comment + Send

### Selection Mode
- [x] `v` to enter selection mode
- [x] Track start line and current line
- [x] Visual highlight of selected range
- [x] `j/k` to extend selection
- [x] `Esc` to cancel

### Comment Dialog
- [x] `c` to open comment input
- [ ] Multi-line text input
- [x] `Enter` or `Ctrl+Enter` to confirm
- [x] `Esc` to cancel

### Send to Agent
- [x] Format message with file path, line range, code snippet, comment
- [x] Use `pi.sendUserMessage()` with `deliverAs: "followUp"`
- [x] Handle case when agent is idle vs streaming
- [ ] Show confirmation notification

## Phase 4: tuicr Integration (Optional)

### Setup
- [x] Check for tuicr availability (`which tuicr`)
- [x] Document install: `brew install agavra/tap/tuicr`

### /review Command
- [x] Register `/review` command
- [x] Spawn tuicr with `stdio: "inherit"` (takes over terminal)
- [x] After exit, read clipboard (`pbpaste` on macOS, `xclip` on Linux)
- [x] Detect tuicr export format (contains `## Review Summary` or structured markdown)
- [x] Send review to agent via `pi.sendUserMessage()`
- [x] Show confirmation notification

### UX
- [ ] `/review` - review all unstaged changes
- [ ] `/review --staged` - review staged changes
- [ ] `/review HEAD` - review last commit

## Phase 5: critique Integration (Optional)

### Setup
- [ ] Check for critique availability (requires Bun)
- [ ] Document install: `bun install -g critique`

### /diff Command
- [x] Register `/diff` command
- [x] Spawn critique for quick diff viewing
- [ ] `/diff --watch` for live monitoring while agent works
- [x] `/diff <file>` for specific file

### Web Preview
- [ ] `/diff --web` generates shareable URL
- [ ] Useful for async review or sharing with others

## Phase 6: Agent Awareness

### Track Modifications
- [x] Subscribe to `tool_result` events
- [x] Filter for `write` and `edit` tools
- [x] Extract file paths from tool inputs
- [ ] Store in extension state with timestamps

### Visual Indicators
- [x] Badge files in tree with "agent modified" icon (e.g., 🤖)
- [ ] Different indicator for "agent modified this session" vs "human modified"
- [ ] Persist across session reload via `pi.appendEntry()`

### Per-Line Attribution (Stretch - Cursor Blame style)
- [ ] Parse edit tool diffs to get line ranges
- [ ] Store line-level attribution metadata (which model, which tool call)
- [ ] Show in file viewer gutter
- [ ] Differentiate: Tab completions vs agent runs vs human edits

## Polish

- [x] Error handling for missing tools
- [x] Graceful degradation (no git, no bat, etc.)
- [ ] Performance: cache file tree, lazy load
- [ ] Help overlay (`?` key)
- [ ] Configurable keybindings
- [x] Theme integration (use pi theme colors)
- [x] Linux clipboard support (`xclip -selection clipboard`)
