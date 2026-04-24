# files-widget

In-terminal file browser and diff viewer widget for Pi. Navigate files, view diffs, select code, and send comments to the agent without leaving the terminal and without interrupting your agent.

Directory symlinks are shown with a `↗` marker and can be expanded like normal folders.

<video controls autoplay loop muted playsinline>
  <source src="demo.mp4" type="video/mp4" />
</video>

## Install

**Quick install (Pi package manager):**

```bash
pi install npm:@tmustier/pi-files-widget
```

Required deps (needed for /readfiles):

```bash
# macOS (Homebrew)
brew install bat git-delta glow

# Ubuntu/Debian
sudo apt-get install -y bat git-delta glow
```

```bash
pi install git:github.com/tmustier/pi-extensions
```

Then add to `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    {
      "source": "git:github.com/tmustier/pi-extensions",
      "extensions": ["files-widget/index.ts"]
    }
  ]
}
```

**Local clone:**

Add to your Pi extensions list:

```json
{
  "extensions": [
    "~/pi-extensions/files-widget"
  ]
}
```

If you prefer symlinking into `~/.pi/agent/extensions`:

```bash
ln -sfn ~/pi-extensions/files-widget ~/.pi/agent/extensions/files-widget
```

Then reference it in your settings:

```json
{
  "extensions": [
    "~/.pi/agent/extensions/files-widget"
  ]
}
```

## Dependencies (required)

- `bat`: syntax highlighting
- `delta`: formatted diffs
- `glow`: markdown rendering

The `/readfiles` browser requires these tools and will refuse to open until they are installed.

## Commands

- `/readfiles` - open the file browser and viewer

Diff viewing is built into the file viewer: open a changed tracked file and press `d` to toggle the git diff view.

## Browser Keybindings

- `j/k` or `↑/↓`: move
- `Enter`: open file / expand folder
- `h/l` or `←/→`: collapse/expand folder
- `PgUp/PgDn`: page up/down
- `c`: toggle changed-only view
- `]` / `[`: next/prev changed file
- `/`: search (type to filter, `Esc` to exit)
- `+` / `-`: increase/decrease browser height
- `q`: close

## Viewer Keybindings

- `j/k` or `↑/↓`: scroll
- `PgUp/PgDn`: page up/down
- `g/G`: top/bottom
- `d`: toggle diff (tracked files only)
- `m`: toggle rendered/raw view for Markdown files
- `/`: search (type to search)
- `n` / `N`: next/prev match
- `v`: select mode (line selection)
- `c`: comment on selected lines (inline prompt)
- `Enter`: new line in the comment editor
- `Ctrl+Enter` or `Ctrl+D`: send the comment (`Alt+Enter` also works when supported)
- `]` / `[`: next/prev changed file
- `+` / `-`: increase/decrease viewer height
- `q`: back to browser

## Notes

- Untracked files show as `[UNTRACKED]` and open in normal view.
- Searching in rendered Markdown switches to raw mode first, and selecting from rendered Markdown first switches you back to raw so line-based matches and comments stay aligned with the source file.
- Folder LOCs are shown only when the folder is collapsed (expanded folders would duplicate counts).
- Line counts load asynchronously; the header shows activity while counts are computed.
- Large non-git folders load progressively and may show `[partial]` while loading in safe mode.
- Git status refreshes every 3 seconds while `/readfiles` is open.
