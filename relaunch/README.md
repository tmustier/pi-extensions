# Relaunch Extension

!!!!!!!WORK-IN-PROGRESS!!!!!!!!
Exit pi and immediately resume the current session.

## Install

```bash
pi install git:github.com/tmustier/pi-extensions
```

Then filter to just this extension in `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    {
      "source": "git:github.com/tmustier/pi-extensions",
      "extensions": ["relaunch/index.ts"]
    }
  ]
}
```

## Usage

- Command: `/relaunch`

## Notes

- Requires a saved session (won't work with `--no-session`).
- Relaunches with the same CLI flags, replacing any session flags with `--session <current>`.
