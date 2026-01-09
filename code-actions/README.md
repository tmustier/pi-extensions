# Code Actions Extension

Pick code blocks or inline code from recent assistant messages and then copy, insert, or run them.

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
- Inline snippets are included by default but only if they include at least two `/` characters; use `blocks` to show only code blocks.
