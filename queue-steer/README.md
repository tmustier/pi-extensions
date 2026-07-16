# Queue Steer extension

A Cursor-style follow-up queue for Pi: queued prompts stay visible and can be edited one at a time while the agent continues working.

The extension deliberately keeps Pi's existing delivery keys:

- `Enter` steers the current run at Pi's next safe turn boundary
- `Alt+Enter` queues a follow-up until the current run settles
- `Alt+Up` selects the queued item nearest the editor; press it again to cycle backwards

Press `Enter` on an empty prompt to take the oldest follow-up out of the queue and steer with it now.

While a queued item is selected, edit it in Pi's normal editor. Then:

- press `Alt+Enter` to save it in place
- press `Enter` to remove it from the follow-up queue and steer with it now

Follow-ups run in FIFO order, one at a time. The next queued prompt starts only after the preceding run settles.

## Install

```bash
pi install npm:@tmustier/pi-queue-steer
```

Or enable it from this repository:

```json
{
  "packages": [
    {
      "source": "git:github.com/tmustier/pi-extensions",
      "extensions": ["queue-steer/index.ts"]
    }
  ]
}
```

For a one-off test:

```bash
pi -e ./queue-steer/index.ts
```

## Notes

- Queue state is session-local and intentionally not written into the transcript.
- The extension handles interactive TUI follow-ups. RPC and extension-injected messages retain Pi's native queue behavior.
- If the current editor contains an unrelated draft, `Alt+Up` leaves it intact and asks you to send or clear it first.
