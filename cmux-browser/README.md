# Native cmux browser for Pi

Control the real cmux browser pane from Pi. The extension opens native `WKWebView` surfaces beside the calling Pi terminal, keeps focus in Pi, and gives the model structured tools for navigation, page interaction, tabs/state, files, screenshots, and diagnostics.

## Requirements

- macOS with [cmux](https://cmux.com) 0.64.13 or newer
- cmux browser automation enabled (`cmux browser enable`)
- Pi launched from a cmux terminal so `CMUX_WORKSPACE_ID` and the cmux socket are available

No Codex installation, browser extension, CDP port, or extra npm runtime dependency is required.

## Install

Install the repository package:

```bash
pi install git:github.com/tmustier/pi-extensions
```

Or test only this extension from a checkout:

```bash
pi --no-extensions -e ./cmux-browser/index.ts
```

On a fresh Pi session inside cmux:

```text
/browser https://example.com
```

The browser opens in the originating workspace with `--focus false`. Pi remains ready for keyboard input while the page renders in its native pane.

## Model tools

| Tool | Purpose |
|---|---|
| `browser_navigate` | Open, navigate, history, reload, URL/title/status, close |
| `browser_inspect` | Snapshot, DOM inspection, page eval, PNG screenshot, console/errors, highlight |
| `browser_interact` | Click/fill/type/keys/select/check/scroll/wait using refs or CSS |
| `browser_session` | Tabs, profiles, state save/load, upload, download wait |

Recommended loop:

1. `browser_navigate { action: "open", url: "…" }`
2. `browser_interact { action: "wait", load_state: "complete" }`
3. `browser_inspect { action: "snapshot", interactive: true }`
4. Act on a fresh ref with `browser_interact`.
5. Re-snapshot after navigation or major DOM changes.

### Authentication and profiles

The extension uses cmux's own browser profiles/data stores. Sign in normally in the visible native pane, or use `browser_session` state/profile operations for supported continuity. The extension never reads Chrome, Safari, Codex, or system credential stores.

Browser state, cookie/storage exports, and profile artifacts can contain authenticated site state, bearer material, or personal data. Store them outside repositories, restrict filesystem access, never paste them into prompts/logs/issues, and protect them like credentials. The extension redacts sensitive command arguments from failures and tool metadata, but it cannot make an exported artifact safe.

### Uploads

`browser_session { action: "upload", path, selector }` asks for interactive approval, then reads one explicit local regular file (maximum 25 MiB), creates a DOM `File` in the current page through cmux's supported eval operation, and dispatches `input`/`change` on the selected `<input type="file">`. Non-interactive uploads are rejected. File paths, contents, encoded chunks, and eval payloads are omitted from failures and tool-result metadata; only safe command/surface/exit diagnostics are retained.

Some sites deliberately reject synthetic file-input events. For those sites, drag the file into the visible cmux browser pane; cmux supports native HTML5 file drop.

### Downloads

Start the page download, then call `browser_session { action: "download_wait" }`. cmux returns its native download event/path. Download save prompts and destinations follow the user's cmux settings.

## Supported boundaries

cmux's WKWebView backend currently reports these CDP-only operations as `not_supported`:

- viewport/geolocation/offline emulation
- tracing and screencast recording
- network interception/mocking
- low-level raw mouse/keyboard/touch injection

This extension does not expose or claim those operations. High-level DOM/ref interaction, screenshots, downloads, tabs, profiles, console, and page errors are supported.

## Recovery

The last successful surface UUID is persisted in Pi tool-result details and restored when the session resumes/reloads. If cmux restarted or the surface was closed, open a replacement explicitly:

```text
browser_navigate { action: "open", url: "https://example.com" }
```

For socket errors:

```bash
cmux ping
cmux browser status
cmux browser enable   # only if status is disabled
```

The extension does not silently open a replacement because that can put automation in the wrong workspace/profile.

## Rollback

Disable only this resource in the Pi package configuration, remove the local `-e`/extension setting, or uninstall the package:

```bash
pi remove git:github.com/tmustier/pi-extensions
```

Then `/reload` or restart Pi. No Pi core, cmux binary/config, Codex installation, browser profile, signing identity, or macOS permission is modified by installation.

## Verification

Deterministic client tests:

```bash
npx tsx --test cmux-browser/client.test.ts
```

Real E2E from a clean Pi inside a live cmux workspace:

```bash
scripts/test-cmux-browser-e2e.sh
```

The E2E uses only a local synthetic page and temporary files; it does not use private/customer data.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the public-surface audit and acceptance mapping.
