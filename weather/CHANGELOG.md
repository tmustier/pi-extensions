# Changelog

## [0.1.2] - 2026-05-07

### Changed
- Update Pi extension imports and peer dependencies to the new `@earendil-works` namespace.

## 0.1.1 - 2026-02-12
- Added an embedded demo GIF in the README that links to the MP4 demo hosted on GitHub.
- Kept demo media out of npm installs while improving README preview on GitHub/npm.

## 0.1.0 - 2026-02-12
- Initial release of `/weather` weather widget extension.
- Added native Rust bridge (`native/weathr-bridge`) with automatic shell fallback.
- Added ANSI color preservation in the weather widget output.
- Fixed shell fallback PTY bootstrap under Bun by binding `script` stdin to `/dev/null` (avoids socket `tcgetattr` errors without stealing ESC input from Pi).
- `/weather-config` now warns when `location.auto=true` (which overrides manual latitude/longitude).
- Added optional dependency support for platform prebuilt native bridge packages (`@tmustier/pi-weather-bridge-*`).
- Added release automation workflow for publishing native bridge platform packages (`.github/workflows/weather-native-bridge.yml`).
- `/weather` now renders in the main custom UI area (above the editor) instead of centered overlay mode.
- Added `/weather-config` command and isolated config at `~/.pi/weather-widget/weathr/config.toml`.
