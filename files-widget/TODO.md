# Editor Extension - Implementation Checklist

## Pre-requisites
- [ ] Check for required tools (`bat`, `delta`, `glow`, `fd`) and document install commands
- [ ] Verify pi-tui capabilities for widget sizing and keyboard handling

## Phase 1: File Browser Widget

### Scaffold
- [ ] Create `index.ts` extension entry point
- [ ] Register `Ctrl+E` toggle shortcut
- [ ] Basic widget rendering with placeholder content

### File Tree
- [ ] Build file tree from current directory
- [ ] Respect `.gitignore` (use `fd` or manual parsing)
- [ ] Collapse/expand directories
- [ ] Navigation with `j/k` and arrow keys
- [ ] Enter to expand dir or open file

### Git Integration
- [ ] Parse `git status --porcelain` output
- [ ] Show indicators: M (modified), ? (untracked), A (added), D (deleted)
- [ ] Color coding: green (staged), yellow (unstaged), grey (untracked)

### Search
- [ ] `/` to enter search mode
- [ ] Fuzzy match file names
- [ ] Highlight matches, Enter to jump

## Phase 2: File Viewer

### Basic Viewer
- [ ] `ctx.ui.custom()` full-screen component
- [ ] Load file content
- [ ] Line numbers
- [ ] Scroll with `j/k`, `Ctrl+d/u`, `g/G`
- [ ] `q` to close

### Syntax Highlighting
- [ ] Detect `bat` availability
- [ ] Shell out to `bat` for highlighting
- [ ] Parse ANSI output for display
- [ ] Fallback to plain text with line numbers

### Markdown Rendering
- [ ] Detect `glow` availability
- [ ] Shell out to `glow` for .md files
- [ ] Toggle between rendered and raw (`m` key?)
- [ ] Fallback to syntax-highlighted raw

### Diff View
- [ ] `d` to toggle diff mode
- [ ] Shell out to `git diff HEAD -- <file>`
- [ ] Use `delta` if available for nicer output
- [ ] Show only if file has changes

## Phase 3: Select + Comment + Send

### Selection Mode
- [ ] `v` to enter selection mode
- [ ] Track start line and current line
- [ ] Visual highlight of selected range
- [ ] `j/k` to extend selection
- [ ] `Esc` to cancel

### Comment Dialog
- [ ] `c` to open comment input
- [ ] Multi-line text input
- [ ] `Enter` or `Ctrl+Enter` to confirm
- [ ] `Esc` to cancel

### Send to Agent
- [ ] Format message with file path, line range, code snippet, comment
- [ ] Use `pi.sendUserMessage()` with `deliverAs: "steer"`
- [ ] Handle case when agent is idle vs streaming
- [ ] Show confirmation notification

## Phase 4: tuicr Integration (Optional)

### Setup
- [ ] Check for tuicr availability (`which tuicr`)
- [ ] Document install: `brew install agavra/tap/tuicr`

### /review Command
- [ ] Register `/review` command
- [ ] Spawn tuicr with `stdio: "inherit"` (takes over terminal)
- [ ] After exit, read clipboard (`pbpaste` on macOS, `xclip` on Linux)
- [ ] Detect tuicr export format (contains `## Review Summary` or structured markdown)
- [ ] Send review to agent via `pi.sendUserMessage()`
- [ ] Show confirmation notification

### UX
- [ ] `/review` - review all unstaged changes
- [ ] `/review --staged` - review staged changes
- [ ] `/review HEAD` - review last commit

## Phase 5: critique Integration (Optional)

### Setup
- [ ] Check for critique availability (requires Bun)
- [ ] Document install: `bun install -g critique`

### /diff Command
- [ ] Register `/diff` command
- [ ] Spawn critique for quick diff viewing
- [ ] `/diff --watch` for live monitoring while agent works
- [ ] `/diff <file>` for specific file

### Web Preview
- [ ] `/diff --web` generates shareable URL
- [ ] Useful for async review or sharing with others

## Phase 6: Agent Awareness

### Track Modifications
- [ ] Subscribe to `tool_result` events
- [ ] Filter for `write` and `edit` tools
- [ ] Extract file paths from tool inputs
- [ ] Store in extension state with timestamps

### Visual Indicators
- [ ] Badge files in tree with "agent modified" icon (e.g., 🤖)
- [ ] Different indicator for "agent modified this session" vs "human modified"
- [ ] Persist across session reload via `pi.appendEntry()`

### Per-Line Attribution (Stretch - Cursor Blame style)
- [ ] Parse edit tool diffs to get line ranges
- [ ] Store line-level attribution metadata (which model, which tool call)
- [ ] Show in file viewer gutter
- [ ] Differentiate: Tab completions vs agent runs vs human edits

## Polish

- [ ] Error handling for missing tools
- [ ] Graceful degradation (no git, no bat, etc.)
- [ ] Performance: cache file tree, lazy load
- [ ] Help overlay (`?` key)
- [ ] Configurable keybindings
- [ ] Theme integration (use pi theme colors)
- [ ] Linux clipboard support (`xclip -selection clipboard`)
