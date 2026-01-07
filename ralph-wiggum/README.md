# ralph-wiggum

Run arbitrarily-long tasks without diluting model attention. Inspired by Geoffrey Huntley's [ralph-loop](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-loop).

```
/ralph start my-feature --max-iterations 50 --reflect-every 10
```

The loop:
1. Reads a task file (markdown, json, whatever)
2. Sends it to the agent with instructions
3. Agent works, updates the file as it progresses
4. Agent says `<promise>COMPLETE</promise>` when done
5. Repeat until complete or max iterations

## Install

```bash
ln -s ~/pi-extensions/ralph-wiggum ~/.pi/agent/extensions/
```

Or add to `~/.pi/agent/settings.json`:

```json
{
  "extensions": ["~/pi-extensions/ralph-wiggum"]
}
```

## Commands

| Command | Description |
|---------|-------------|
| `/ralph start <name\|path>` | Start a new loop |
| `/ralph stop` | Pause current loop |
| `/ralph resume <name>` | Resume a paused loop |
| `/ralph status` | Show all loops with status |
| `/ralph cancel <name>` | Delete a loop's state file |
| `/ralph archive <name>` | Move completed/paused loop to archive |
| `/ralph clean` | Remove state files for completed loops |
| `/ralph clean --all` | Remove all files for completed loops |
| `/ralph list --archived` | Show archived loops |

### Stopping During Streaming

To stop a loop while the agent is streaming, type `stop` (just the word). The message will be queued and processed after the current turn, pausing the loop.

## Loop Lifecycle

Loops have three states:

| Status | Description |
|--------|-------------|
| `▶ active` | Currently running |
| `⏸ paused` | Stopped mid-work (can resume) |
| `✓ completed` | Finished naturally or hit max iterations |

### Cleanup Workflow

```bash
# After completing a task:
/ralph status                # See what's done
/ralph archive my-feature    # Move to .ralph/archive/
# or
/ralph clean                 # Remove state files for completed (keeps .md)
/ralph clean --all           # Remove all files for completed loops
```

## Options

| Option | Description |
|--------|-------------|
| `--max-iterations N` | Stop after N iterations (default: unlimited) |
| `--reflect-every N` | Reflection checkpoint every N iterations |
| `--reflect-instructions "..."` | Custom reflection prompt |

## Examples

```bash
/ralph start refactor
/ralph start bugfix --max-iterations 20
/ralph start big-feature --max-iterations 100 --reflect-every 10
/ralph start ./long-task-harness/features.json
```

## Multiple Loops

Multiple loops supported (one active at a time):

```bash
/ralph start feature-a    # Starts feature-a
/ralph stop               # Pauses it
/ralph start feature-b    # Starts feature-b
/ralph resume feature-a   # Switches back
```

Active loops are detected on session start but NOT auto-resumed.

## Files

| Path | Description |
|------|-------------|
| `.ralph/<name>.md` | Task file (created if not exists) |
| `.ralph/<name>.state.json` | Loop state (iteration, settings, status) |
| `.ralph/archive/` | Archived loops |
