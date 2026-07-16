# Native cmux browser for Pi

Control a real cmux `WKWebView` pane from Pi through cmux's documented CLI. The extension owns one browser surface at a time, opens it without moving keyboard focus from Pi, and exposes a deliberately narrow set of model tools.

## Requirements

- macOS with exactly [cmux](https://cmux.com) 0.64.13 (the extension checks this before every model operation)
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

The user-supplied slash command authorizes that initial origin. Model-initiated origin changes require confirmation in Pi. To keep all credentials and signed links out of process arguments by construction, navigation accepts only an `http(s)` origin root (for example, `https://example.com/`) or exactly `about:blank`. Any non-root path, query, fragment, or URL userinfo is rejected; navigate deeper manually in the visible pane.

## Model tools

| Tool | Exposed operations |
|---|---|
| `browser_navigate` | Open/go to an approved origin root, read the current origin, close |
| `browser_inspect` | Bounded, element-name-redacted structural accessibility snapshot tied atomically to its reported origin |

The public cmux 0.64.13 CLI cannot atomically require an expected origin before an interaction, screenshot, generic property read, console/error read, reload, or download wait. A page could navigate between a separate origin check and those operations. They are therefore not model tools: perform interactions, reloads, credential entry, downloads, screenshots, and debugging manually in the visible native pane.

Arbitrary selectors, JavaScript evaluation, automated text/value entry, file operations, tabs, cookie/storage access, state import/export, profile mutation, and caller-selected host paths are intentionally not exposed.

## Authentication and profile boundary

cmux 0.64.13 does not provide a documented per-open profile selector. An automation-opened pane therefore uses cmux's currently selected browser profile, which may be shared with other cmux panes. Pi requires explicit confirmation before the extension opens its first surface.

For stronger separation, cancel the prompt, select a dedicated profile in cmux, and retry. The extension does not list, read, create, switch, clear, delete, export, or import profiles, cookies, local storage, or browser state. It never reads Chrome, Safari, Codex, or system credential stores.

## Ownership, output, and files

- A client may control only the strict top-level UUID returned by its own successful `browser open` call.
- Only one extension-owned surface is active. Client operations are queued and all model tools execute sequentially, preventing parallel opens or shared-state races. An uncertain/interrupted open blocks retries. Close discards ownership only after a non-interrupted cmux 0.64.13 response repeats the exact owned top-level `surface_id`; failure or malformed output retains ownership. A process-wide fail-closed marker carries unresolved lifecycle state across `/reload`, `/new`, resume, and fork. There is no tab enumeration, arbitrary surface/workspace parameter, stale-handle recovery, or session resurrection.
- Command failures expose fixed operation/exit metadata only; raw cmux stdout/stderr and raw argv are never copied into tool errors or session details.
- Successful mutation results use a synthetic result variant that cannot contain subprocess stdout, stderr, or parsed output; this is redaction by construction. Only explicit read operations can return bounded captured page output.
- Raw cmux snapshot JSON is never forwarded: the extension projects only bounded accessibility snapshot text and authoritative ref keys, discarding `page.text`, `page.html`, full URL, the standalone title field, ref metadata, and other fields.
- cmux 0.64.13 may use a live input value as an accessibility name even when an input declares a misleading ARIA role. Every ref-bearing accessible name and the document title are therefore removed before output. Structural roles and body-text fallback remain, but element labels are intentionally absent.
- Each snapshot's top-level URL is privately reduced to an origin from the same cmux response. Unapproved origins require confirmation; after a new approval, a fresh same-origin snapshot is required before any text is released.

## Public cmux limits

The WKWebView backend reports several CDP-only operations as unsupported, including viewport/geolocation/offline emulation, tracing/screencast, network interception, and raw low-level input. This extension does not expose or claim those operations.

## Recovery and rollback

The owned surface exists only for the current Pi extension instance and is closed best-effort on shutdown. The extension never adopts an existing pane or silently opens a replacement. If an open is uncertain, or shutdown cannot confirm the exact surface closed, the process-wide lifecycle marker prevents replacement extension instances from opening another pane. Close any possibly unowned native pane manually and restart Pi to reset that fail-closed state.

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

The E2E pins cmux 0.64.13 and uses a local synthetic page to prove background native open, atomically origin-bound structural accessibility snapshot, and exact acknowledged cleanup. See [ARCHITECTURE.md](ARCHITECTURE.md) for the route audit and security design.
