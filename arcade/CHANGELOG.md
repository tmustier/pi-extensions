# Changelog

## [0.1.8] - 2026-11-03

### Fixed
- Tetris ignores hold and drop while full rows are clearing. Before, these could act on the piece that had just locked. Swapping in a held piece now checks it fits, like a normal spawn ([#138](https://github.com/tmustier/pi-extensions/pull/138)).
- sPIce Invaders no longer locks up when a game saved during the boss intro is reopened, or when the cheat is entered after game over or while paused. Pause, resume and restart now work in every phase ([#138](https://github.com/tmustier/pi-extensions/pull/138)).

## [0.1.7] - 2026-09-22

### Changed
- Update game components for Pi 0.87's render and invalidation contracts.
- Restore saved games without mutating Pi's session entry order.

## [0.1.6] - 2026-05-07

### Changed
- Declare the `@earendil-works` Pi peer and development dependencies used by runtime imports.
- Update Pi extension imports to the new `@earendil-works` namespace.

## 0.1.5 - 2026-02-03
- Add preview video metadata for the extension listing.

## 0.1.4 - 2026-01-26
- Fix Tetris pieces locking automatically after landing.

## 0.1.2 - 2026-01-26
- Add demo video to README.

## 0.1.0 - 2026-01-13
- Initial release.
