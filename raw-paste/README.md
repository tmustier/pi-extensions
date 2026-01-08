# Raw Paste Extension

Arm a one-shot raw paste so large clipboard content stays fully editable in the editor (no paste markers).

## Usage

- Command: `/paste`
- No default keybinding

After arming, paste normally (for example `Cmd+V` on macOS).

Optional: add your own keybinding in `raw-paste/index.ts` if your terminal supports it.

## Notes

- Terminal.app and Warp intercept `Cmd+V` and `Cmd+Shift+V`, so the extension cannot see those keys.
- Use `/rawpaste` before pasting in those terminals.
