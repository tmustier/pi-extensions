# Pi Editor Extension

A Pi extension that provides an in-terminal file browser, viewer, and review workflow - enabling you to navigate, view, and comment on files without leaving Pi or interrupting the agent.

## Problem Statement

When working with coding agents in Pi:
- Viewing files requires either putting full content into context (`cat`) or leaving the terminal
- Reviewing diffs and agent changes means context-switching to an external editor
- No way to easily browse the project structure while the agent works
- No feedback loop for "I see this line, let me comment on it and send to agent"

## Goals

### MVP (v0.1)
1. **File Tree Widget** - Toggleable file browser showing project structure
2. **File Viewer** - View files with syntax highlighting, scroll, search
3. **Diff View** - Toggle diff vs HEAD for modified files
4. **Markdown Rendering** - Render .md files nicely (via `glow` or similar)
5. **Select + Comment + Send** - Select text, add comment, send to agent as steering message

### Future Enhancements
- Agent vs human edit attribution (Cursor Blame style)
- Word-level diff for prose (not just line-level git diff)
- Multiple comments before sending (queue workflow)
- Per-model attribution for agent edits
- Side-by-side diff view

## Architecture

### Extension Type
Pi extension (`~/.pi/agent/extensions/editor/index.ts`) using:
- `ctx.ui.setWidget()` for the file browser panel
- `ctx.ui.custom()` for the file viewer modal
- `pi.registerShortcut()` for hotkeys
- `pi.on("tool_result")` to track agent file modifications

### External Dependencies
- `bat` - Syntax highlighting for code files (falls back to `cat`)
- `delta` - Pretty git diff output (falls back to `git diff`)
- `glow` - Markdown rendering (falls back to plain text)
- `fd` or `find` - Fast file discovery
- `git` - Status, diff operations

### UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│ [Agent output / streaming...]                               │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ 📁 File Browser (widget, toggleable with Ctrl+E)            │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ > src/                                                  │ │
│ │   ├── index.ts          M                               │ │
│ │   ├── utils.ts          M                               │ │
│ │   └── types.ts                                          │ │
│ │ > tests/                                                │ │
│ │   README.md             ?                               │ │
│ └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│ [Your input editor]                                         │
└─────────────────────────────────────────────────────────────┘
```

When you press Enter on a file, it opens the **File Viewer** (full-screen via `ctx.ui.custom()`):

```
┌─────────────────────────────────────────────────────────────┐
│ src/index.ts                              [Diff: ON] [q]uit │
├─────────────────────────────────────────────────────────────┤
│   1 │ import { foo } from './utils';                        │
│   2 │ import { Bar } from './types';                        │
│   3 │                                                       │
│   4 │+export function main() {           <- added line      │
│   5 │+  console.log('hello');                               │
│   6 │+}                                                     │
│   7 │                                                       │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ j/k: scroll  v: select  d: toggle diff  g: glow (md)  q: quit│
└─────────────────────────────────────────────────────────────┘
```

Selection mode (`v` to enter):

```
┌─────────────────────────────────────────────────────────────┐
│ src/index.ts                    [SELECT MODE] lines 4-6     │
├─────────────────────────────────────────────────────────────┤
│   1 │ import { foo } from './utils';                        │
│   2 │ import { Bar } from './types';                        │
│   3 │                                                       │
│ ▌ 4 │ export function main() {           <- selected        │
│ ▌ 5 │   console.log('hello');            <- selected        │
│ ▌ 6 │ }                                  <- selected        │
│   7 │                                                       │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ j/k: extend  c: comment  Esc: cancel                        │
└─────────────────────────────────────────────────────────────┘
```

After pressing `c`, comment dialog appears, then sends to agent:

```
Steering message sent to agent:

In `src/index.ts` (lines 4-6):
```ts
export function main() {
  console.log('hello');
}
```

User comment: "This should take a name parameter and greet by name"
```

## Keybindings

| Key | Context | Action |
|-----|---------|--------|
| `Ctrl+E` | Global | Toggle file browser widget |
| `j/k` | File browser | Navigate files |
| `Enter` | File browser | Open file viewer |
| `/` | File browser | Fuzzy search |
| `q` | File viewer | Close viewer, return to pi |
| `j/k` | File viewer | Scroll up/down |
| `g/G` | File viewer | Go to top/bottom |
| `d` | File viewer | Toggle diff view |
| `v` | File viewer | Enter selection mode |
| `j/k` | Selection mode | Extend selection |
| `c` | Selection mode | Add comment to selection |
| `Esc` | Selection mode | Cancel selection |

## Implementation Plan

### Phase 1: File Browser Widget
- [ ] Create extension scaffold
- [ ] Implement file tree data structure (respect .gitignore)
- [ ] Git status integration (modified, untracked, staged indicators)
- [ ] Widget rendering with `ctx.ui.setWidget()`
- [ ] Toggle hotkey `Ctrl+E`
- [ ] Navigation (j/k, Enter to open)
- [ ] Fuzzy search (/)

### Phase 2: File Viewer
- [ ] Full-screen viewer via `ctx.ui.custom()`
- [ ] Syntax highlighting via `bat` (with fallback)
- [ ] Scroll, go to line
- [ ] Markdown rendering via `glow` (with fallback)
- [ ] Diff toggle via `delta`/`git diff`

### Phase 3: Select + Comment + Send
- [ ] Selection mode (v to enter, j/k to extend)
- [ ] Comment input dialog
- [ ] Format and send as steering message via `pi.sendUserMessage()`
- [ ] Handle mid-stream delivery (`deliverAs: "steer"`)

### Phase 4: Agent Awareness (Future)
- [ ] Track agent file modifications via `tool_result` events
- [ ] Badge files in tree with "agent modified" indicator
- [ ] Store modification metadata in session via `pi.appendEntry()`
- [ ] Per-line attribution (which tool call modified which lines)

## Technical Notes

### File Tree Performance
- Use `fd` if available (respects .gitignore by default, fast)
- Fall back to `find` + manual .gitignore parsing
- Cache tree, invalidate on file system events or manual refresh

### Syntax Highlighting
```bash
# Check for bat
bat --style=numbers,changes --color=always "$file"

# Fallback
cat -n "$file"
```

### Diff Display
```bash
# Check for delta
git diff HEAD -- "$file" | delta --side-by-side

# Fallback
git diff HEAD -- "$file"
```

### Markdown Rendering
```bash
# Check for glow
glow "$file"

# Fallback: just show raw markdown with bat
bat "$file"
```

### Git Status
```bash
git status --porcelain
# M  = modified (staged)
# _M = modified (unstaged)  
# ?? = untracked
# A  = added
# D  = deleted
```

## Research Notes

### Cursor Blame (Cursor 2.4, Jan 2025)

Cursor introduced "Cursor Blame" which provides per-line attribution:
- Distinguishes code from **Tab completions**, **agent runs** (broken down by model), and **human edits**
- Gutter annotations showing who/what wrote each line
- Addresses the "which model made this change?" problem
- Users on Reddit specifically requested this to compare model performance

**Relevance**: The "agent vs human" distinction we want for Phase 4 is similar. We can track this via `tool_result` events for `write` and `edit` tools.

### tuicr (Rust, `cargo install tuicr`)

GitHub: https://github.com/agavra/tuicr

A TUI for reviewing AI-generated diffs like a GitHub PR:
- **Infinite scroll diff view** - all changed files in one continuous scroll
- **Vim keybindings** - j/k, Ctrl-d/u, g/G, {/} for file jumping
- **Comments** - file-level or line-level with types (Note, Suggestion, Issue, Praise)
- **Visual mode** - select line ranges with v/V, comment on multiple lines
- **Session persistence** - reviews auto-save and reload
- **Clipboard export** - structured Markdown optimized for LLM consumption
- Supports git, jujutsu, mercurial

**Sample export format**:
```markdown
In `src/index.ts` (lines 4-6):
```ts
export function main() {
  console.log('hello');
}
```
[Issue] This should take a name parameter
```

**Relevance**: The "select + comment + export for LLM" workflow is exactly what we want. Could either integrate tuicr or replicate the pattern.

### critique (Bun/TypeScript, `bunx critique`)

GitHub: https://github.com/remorses/critique

Beautiful terminal diff viewer:
- **Word-level diff** - not just line-level, shows exactly what changed within lines
- **Split view** - side-by-side comparison
- **Syntax highlighting** - via tree-sitter
- **Watch mode** - `critique --watch` auto-refreshes on file changes
- **AI-powered explanation** - `critique review` uses Claude Code or OpenCode to explain changes
- **Web preview** - `critique web` generates shareable URL
- **Lazygit integration** - can be used as custom pager
- **Branch comparison** - `critique main feature-branch` for PR-style diffs

Commands:
```bash
critique              # View unstaged changes
critique --staged     # View staged changes
critique HEAD         # View last commit
critique --watch      # Auto-refresh on changes
critique review       # AI-powered explanation
critique web          # Generate shareable web preview
```

**Relevance**: Word-level diff is important for prose/markdown review. Could shell out to critique for diff viewing, or adopt their approach.

### Integration Options Considered

| Approach | Pros | Cons |
|----------|------|------|
| Shell out to tuicr/critique | Battle-tested, feature-rich | Context switch, lose pi output visibility |
| Embed in pi widget | No context switch, agent-aware | More work, rebuild existing features |
| Hybrid (tree in pi, diff in external) | Best of both | Still some context switch |

**Decision**: Build file browser in pi (stays visible), use external tools for complex diff viewing if user wants, but provide basic in-pi diff view for quick checks.

### tuicr Integration Analysis

**Value**: High - tuicr was built specifically for the "review AI changes and send feedback" workflow we want.

**Key Features**:
- Clipboard export in LLM-optimized markdown format
- Comment types (Note, Suggestion, Issue, Praise)
- Session persistence (reviews survive restarts)
- Visual mode for multi-line selection

**Integration Approach**:
```bash
# User triggers review mode from pi
# 1. Pi extension spawns tuicr
tuicr

# 2. User reviews, adds comments, presses :wq or y (copy to clipboard)
# 3. tuicr exits, clipboard contains structured review

# 4. Pi extension reads clipboard and sends to agent
pbpaste | pi.sendUserMessage(...)
```

**Feasibility**: Medium
- tuicr is a full TUI that takes over the terminal (can't see pi output while reviewing)
- No stdout/file output mode - only clipboard (would need to read clipboard after exit)
- User must quit tuicr to return to pi
- But: the workflow is natural - "let me review these changes" → review → return with feedback

**Proposed UX**:
```
You: [working with agent]
Agent: [makes changes to multiple files]
You: /review                          # or Ctrl+R
     [tuicr opens, shows all unstaged changes]
     [user navigates, adds comments]
     [user presses :wq]
     [tuicr exits, review copied to clipboard]
     [pi reads clipboard, sends as steering message]
Agent: [receives structured feedback, addresses comments]
```

**Implementation**:
```typescript
pi.registerCommand("review", {
  description: "Open tuicr to review changes, send feedback to agent",
  handler: async (args, ctx) => {
    // Check if tuicr is installed
    if (!hasCommand("tuicr")) {
      ctx.ui.notify("Install tuicr: brew install agavra/tap/tuicr", "error");
      return;
    }

    // Spawn tuicr (takes over terminal)
    const result = await ctx.exec("tuicr", [], { stdio: "inherit" });

    // Read clipboard after tuicr exits
    const review = execSync("pbpaste", { encoding: "utf-8" });

    if (review.includes("## Review Summary") || review.includes("```")) {
      // Looks like a tuicr export, send to agent
      pi.sendUserMessage(review, { deliverAs: "steer" });
      ctx.ui.notify("Review sent to agent", "success");
    }
  },
});
```

### critique Integration Analysis

**Value**: High for diff viewing, medium for review workflow (no built-in comment system).

**Key Features**:
- Word-level diff (great for prose/markdown)
- `--watch` mode for live updates
- `--stdin` for piping (lazygit integration)
- `critique review` uses AI to explain changes
- `critique web` for shareable URLs

**Integration Approaches**:

1. **As diff viewer only** (simple):
   ```bash
   # View specific file diff
   critique --filter "src/index.ts"

   # Watch mode while agent works
   critique --watch
   ```

2. **As lazygit pager** (if user has lazygit):
   ```yaml
   # ~/.config/lazygit/config.yml
   git:
     paging:
       pager: critique --stdin
   ```

3. **Web preview for sharing** (useful for async review):
   ```bash
   critique web --title "Agent changes for review"
   # Returns URL like critique.work/v/abc123
   ```

**Feasibility**: High
- `--watch` mode is ideal for "keep an eye on changes while agent works"
- No comment system, but pairs well with our in-pi select+comment flow
- Requires Bun (not Node.js)

**Proposed UX**:
```
You: /diff                            # Quick diff view
     [critique opens showing current changes]
     [user reviews, presses q to quit]
     [returns to pi]

You: /diff --watch                    # Live watch mode
     [critique opens in watch mode]
     [updates as agent modifies files]
     [user presses q when done]
```

### Recommended Integration Strategy

**Phase 1 (MVP)**: Built-in basic diff
- Simple `git diff` via `delta` in pi's file viewer
- No external dependencies required
- Good enough for quick checks

**Phase 2**: Optional tuicr integration
- `/review` command spawns tuicr
- Clipboard capture sends review to agent
- Requires `brew install agavra/tap/tuicr`

**Phase 3**: Optional critique integration
- `/diff` command spawns critique
- `/diff --watch` for live monitoring
- Requires Bun + `bun install -g critique`

**Phase 4**: Deep integration
- Track which tool calls modified which files
- Pass this metadata to tuicr/critique
- Show "agent modified" vs "human modified" in diff view

### Tools for Syntax Highlighting / Rendering

| Tool | Purpose | Install |
|------|---------|---------|
| `bat` | Syntax highlighting, line numbers | `brew install bat` |
| `delta` | Git diff beautifier, side-by-side | `brew install git-delta` |
| `glow` | Markdown rendering | `brew install glow` |
| `fd` | Fast file finder (respects .gitignore) | `brew install fd` |

These are standalone tools. This extension aims to provide similar functionality *inside* Pi without context switching, while optionally leveraging these tools for rendering.

### Pi Extension Capabilities Used
- `ctx.ui.setWidget()` - Persistent widget above/below editor
- `ctx.ui.custom()` - Full-screen custom TUI component
- `pi.registerShortcut()` - Custom keybindings
- `pi.sendUserMessage()` - Send steering messages to agent
- `pi.on("tool_result")` - Track file modifications
- `pi.appendEntry()` - Persist state in session

## Open Questions

1. **Widget height** - Fixed height or percentage of terminal? Collapsible?
2. **Multi-file comments** - Queue comments across files before sending, or send immediately?
3. **Diff base** - Always vs HEAD, or configurable (vs staged, vs specific commit)?
4. **File watcher** - Auto-refresh tree when files change, or manual refresh?
