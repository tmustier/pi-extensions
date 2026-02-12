# Weather Widget Extension

Run the [weathr](https://github.com/veirt/weathr) terminal weather app inside Pi via `/weather`.

It opens in the main widget area above the input box (same interaction style as `/snake`), supports live weather + simulation flags, keeps controls inside Pi, and preserves ANSI colors.

The extension prefers a Rust N-API bridge (`native/weathr-bridge`) and falls back to a shell bridge if native isn't built.

## Demo

https://raw.githubusercontent.com/tmustier/pi-extensions/main/weather/assets/weather-demo.mp4

_Demo media is kept out of npm installs (package `files` whitelist + repo `.npmignore`)._

## Install

### Pi package manager

```bash
pi install npm:@tmustier/pi-weather
```

```bash
pi install git:github.com/tmustier/pi-extensions
```

Then filter to just this extension in `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    {
      "source": "git:github.com/tmustier/pi-extensions",
      "extensions": ["weather/index.ts"]
    }
  ]
}
```

### Local clone

```bash
ln -s ~/pi-extensions/weather ~/.pi/agent/extensions/weather
```

Or add to `~/.pi/agent/settings.json`:

```json
{
  "extensions": ["~/pi-extensions/weather"]
}
```

## Commands

- `/weather` — open live weather widget
- `/weather rain` — shortcut for `--simulate rain`
- `/weather --simulate snow --night`
- `/weather-config` — edit widget config (`config.toml`)

While open:
- `Esc` or `Q` closes the widget
- `R` restarts the weather process

## Requirements

- `weathr` installed and available on PATH (or in `~/.cargo/bin/weathr`)
- `script` command available (macOS default, `util-linux` on Linux)

Install weathr:

```bash
cargo install weathr
```

Build the native Rust bridge locally (optional, for development):

```bash
cd ~/pi-extensions/weather
npm run build:native
```

Requires Rust + Node.

For npm users, the extension can load prebuilt optional packages (`@tmustier/pi-weather-bridge-*`) when published.

Troubleshooting:

- The extension auto-falls back to shell mode if native bridge has no output.
- If no matching prebuilt native package is installed for your platform, it falls back to shell mode.
- It explicitly unsets `NO_COLOR` for the weather child process and sets `COLORTERM=truecolor` when missing.
- Shell fallback binds `script` stdin to `/dev/null` (avoids Bun socket `tcgetattr` issues while preserving ANSI color output and ESC handling in Pi).
- Force shell mode manually:

```bash
PI_WEATHER_NATIVE=0 pi
```

## Config Location

The extension uses an isolated config home:

- `~/.pi/weather-widget/weathr/config.toml`

Use `/weather-config` to edit it.

> If you set custom `latitude`/`longitude`, also set `location.auto = false` or `weathr` will keep auto-detecting your location.

## Publishing native prebuilt packages

To ship `weathr-bridge` without requiring Rust at install time:

- Run GitHub Actions workflow `.github/workflows/weather-native-bridge.yml` (manual `workflow_dispatch`).
- The workflow builds prebuilt `.node` files per target, syncs them into `native/weathr-bridge/npm/*`, and publishes `@tmustier/pi-weather-bridge-*` platform packages.
- Then publish `@tmustier/pi-weather` (this extension) so consumers pick up the matching optional dependency versions.
- Keep versions in sync (`weather/package.json`, `native/weathr-bridge/package.json`, and `native/weathr-bridge/npm/*/package.json`).

Manual fallback (if not using the workflow):

```bash
cd ~/pi-extensions/weather
npm run native:prepare-packages
# build / download per-target pi_weather_bridge.<target>.node files into native/weathr-bridge/artifacts
npm run native:sync-artifacts
npm run native:publish-packages
```

## Changelog

See `CHANGELOG.md`.
