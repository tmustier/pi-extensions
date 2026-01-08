# Raw Paste Extension

Arm a one-shot raw paste so large clipboard content stays fully editable in the editor (no paste markers).

## Usage

- Command: `/rawpaste`
- Shortcut: `ctrl+alt+v` (works in Ghostty)

After arming, paste normally (for example `Cmd+V` on macOS).

## Notes

- Terminal.app and Warp intercept `Cmd+V` and `Cmd+Shift+V`, so the extension cannot see those keys.
- Use `/rawpaste` before pasting in those terminals.
