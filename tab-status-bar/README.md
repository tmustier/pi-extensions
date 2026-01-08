# tab-status-bar

Menu bar app for pi tab-status. Reads status JSON files and focuses Warp tabs via UI scripting.

## Requirements

- macOS 13+
- Warp running
- tab-status extension enabled (writes `~/.pi/agent/tab-status/`)
- Accessibility permission for the app (System Settings > Privacy & Security > Accessibility)
- Automation permission to control System Events (System Settings > Privacy & Security > Automation)

## Run

```bash
swift run tab-status-bar
```

## Build

```bash
./scripts/build-app.sh
open build/TabStatusBar.app
```

## Build (binary)

```bash
swift build -c release
./.build/release/tab-status-bar
```
