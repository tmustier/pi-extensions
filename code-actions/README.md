# Code Actions extension

/code to pick code blocks (```) or `inline code` from recent assistant messages and then copy or insert them. Helpful for retrieving commands and filepaths mentioned by Pi.

/code opens a menu you can type to search. You can hit enter to copy the snippet, or `right arrow` to insert it in the command line.

<img width="751" height="416" alt="Screenshot 2026-01-09 at 17 09 17" src="https://github.com/user-attachments/assets/0dc10a64-d61f-4b56-9684-5e448c759385" />


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
      "extensions": ["code-actions/index.ts"]
    }
  ]
}
```

## Usage

- Command: `/code`
- Optional args:
  - `all` to scan all assistant messages in the current branch (default: all)
  - `blocks` to hide inline snippets (default: inline + fenced blocks)
  - `limit=50` to cap the number of snippets returned (default: 200)
  - `copy`, `insert`, or `run` to choose an action up front
  - a number to pick a specific snippet (1-based)

Examples:
- `/code`
- `/code blocks`
- `/code copy`
- `/code all`
- `/code limit=50`
- `/code run 2`

## Actions

- Copy: puts the snippet on your clipboard
- Insert: inserts the snippet into the input editor
- Run: executes the snippet in your shell (asks for confirmation)

## Notes

- Only assistant messages are scanned.
- Inline code uses single backticks. Code blocks use triple backticks.
- Inline snippets are filtered to path-like content: `~/...`, `./...`, paths with 2+ slashes, or files with extensions. Use `blocks` to show only code blocks.

## Changelog

See `CHANGELOG.md`.
