# Native cmux browser for Pi

Control a real cmux `WKWebView` pane from Pi through cmux's documented CLI. The extension owns one browser surface at a time, opens it without moving keyboard focus from Pi, and exposes a deliberately narrow set of model tools.

## Requirements

- macOS with [cmux](https://cmux.com) 0.64.13 or newer
- cmux browser automation enabled (`cmux browser enable`)
- Pi launched directly from a cmux terminal, with access to the live cmux workspace and socket

No Codex installation, browser extension, CDP port, or extra runtime dependency is required.

## Install and open

```bash
pi install git:github.com/tmustier/pi-extensions
```

To test only this extension from a checkout:

```bash
pi --no-extensions -e ./cmux-browser/index.ts
```

Then, from a fresh Pi session inside cmux:

```text
/browser https://example.com
```

The user-supplied slash command authorizes that initial origin. Model-initiated origin changes require confirmation in Pi. Navigation permits only absolute `http:`/`https:` URLs or exactly `about:blank`; URL credentials and credential-like query parameters are rejected.

## Model tools

| Tool | Exposed operations |
|---|---|
| `browser_navigate` | Open, go to an approved URL, reload, read the approved origin, close |
| `browser_inspect` | Accessibility snapshot; bounded text/count/box/safe-attribute reads; screenshot; console/errors; highlight |
| `browser_interact` | Click/double-click/hover/focus, allowlisted key press, check/uncheck, bounded scroll, ref/load-state wait |
| `browser_download` | Wait for a cmux-managed download; returns readiness only, never a host path |

Recommended loop:

1. Open or navigate.
2. Request an interactive snapshot.
3. Act on a fresh snapshot ref such as `e3`.
4. Re-snapshot after navigation or a substantial DOM change.

Arbitrary CSS selectors, JavaScript evaluation, automated text/value entry, file upload, tabs, cookie/storage access, state import/export, profile mutation, and caller-selected host paths are intentionally not exposed. Enter text, passwords, tokens, one-time codes, selections, and file choices directly in the visible native pane.

## Authentication and profile boundary

cmux 0.64.13 does not provide a documented per-open profile selector. An automation-opened pane therefore uses cmux's currently selected browser profile, which may be shared with other cmux panes. Pi requires explicit confirmation before the extension opens its first surface.

For stronger separation, cancel the prompt, select a dedicated profile in cmux, and retry. The extension does not list, read, create, switch, clear, delete, export, or import profiles, cookies, local storage, or browser state. It never reads Chrome, Safari, Codex, or system credential stores.

## Ownership, output, and files

- A client may control only the strict top-level UUID returned by its own successful `browser open` call.
- Only one extension-owned surface is active. There is no tab enumeration, arbitrary surface/workspace parameter, stale-handle recovery, or session resurrection.
- Command failures expose fixed operation/exit metadata only; raw cmux stdout/stderr and raw argv are never copied into tool errors or session details.
- Successful mutation results are fixed synthetic metadata. Only explicit read operations can return bounded captured output.
- Snapshot refs must match `e` followed by a positive decimal integer. Arbitrary selectors are rejected before cmux invocation.
- Screenshots are written under a private per-session temporary directory, opened with `O_NOFOLLOW`, checked as a regular file with restrictive permissions, bounded to 10 MiB, and deleted after display.
- Download waiting returns `{ "ok": true, "download_ready": true }`; destination handling remains in cmux and no path is returned to the model.

## Public cmux limits

The WKWebView backend reports several CDP-only operations as unsupported, including viewport/geolocation/offline emulation, tracing/screencast, network interception, and raw low-level input. This extension does not expose or claim those operations.

## Recovery and rollback

The owned surface exists only for the current Pi extension instance. If cmux restarts, the pane closes, or the Pi session reloads, open a new surface explicitly. The extension never adopts an existing pane or silently opens a replacement.

For socket failures:

```bash
cmux ping
cmux browser status
cmux browser enable   # only when status is disabled
```

To roll back:

```bash
pi remove git:github.com/tmustier/pi-extensions
```

Then run `/reload` or restart Pi. Installation does not modify Pi core, cmux binaries/configuration, Codex, browser profiles, signing identity, or macOS permissions.

## Verification

```bash
npm run test:cmux-browser
npm run typecheck:cmux-browser
```

From a fresh Pi launched directly inside a healthy cmux workspace:

```bash
scripts/test-cmux-browser-e2e.sh
```

The E2E uses a local synthetic page and a private temporary directory. See [ARCHITECTURE.md](ARCHITECTURE.md) for the route audit and security design.
