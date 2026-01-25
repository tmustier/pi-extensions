# Raw Paste Extension

/paste to arm a one-shot raw paste so large clipboard content stays fully editable in the editor (no paste markers).
Useful for template prompts that need slight edits or when you need to refer to the text you pasted.

## Without /paste -> the text is condensed
<img width="1487" height="104" alt="Screenshot 2026-01-09 at 17 38 31" src="https://github.com/user-attachments/assets/d6a0793e-3ef3-4c3b-83c8-f6ca10f0db51" />

## With /paste -> you can see raw text
<img width="1487" height="387" alt="Screenshot 2026-01-09 at 17 39 35" src="https://github.com/user-attachments/assets/292c059a-8b06-40c2-abdd-795c0699336a" />


## Install

```bash
pi install npm:@tmustier/pi-raw-paste
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
      "extensions": ["raw-paste/index.ts"]
    }
  ]
}
```

## Usage

- Command: `/paste`
- No default keybinding

After arming, paste normally (for example `Cmd+V` on macOS).

Optional: add your own keybinding in `raw-paste/index.ts` if your terminal supports it.

## Notes

- Terminal.app and Warp intercept `Cmd+V` and `Cmd+Shift+V`, so the extension cannot see those keys.
- Use `/paste` before pasting in those terminals.

## Changelog

See `CHANGELOG.md`.
