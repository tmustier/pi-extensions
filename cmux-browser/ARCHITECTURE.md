# Native cmux browser for Pi — architecture

Issue: [#53](https://github.com/tmustier/pi-extensions/issues/53)

## Outcome and supported route

A Pi session launched directly in a cmux terminal can open and operate a visible native cmux `WKWebView` pane while keyboard focus remains in Pi. The implementation uses only public extension and CLI surfaces:

```text
Pi command / model tool
        │
        ▼
strict TypeBox schema + origin/profile approval
        │
        ▼
fixed argv builder (no shell or passthrough)
        │
        ▼
pi.exec("cmux", argv, { signal, timeout })
        │
        ▼
documented cmux browser CLI → owned native WKWebView surface
```

## Route audit

### Codex

Codex CLI 0.143.0 advertises browser/computer-use feature keys, but its public app-server v2 protocol does not expose a supported browser-control request surface. The browser implementation is part of Codex Desktop/plugin runtime machinery. Loading bundled private scripts, connecting to internal pipes, copying credentials, imitating app identity, or patching a binary would be unsupported and violates issue #53's safety boundary.

### Pi

Pi's documented extension API provides typed model tools, commands, renderers, confirmation UI, abort-aware `pi.exec`, and lifecycle hooks. Its terminal UI cannot embed AppKit `WKWebView`. A terminal-only imitation would not provide the requested native renderer.

### cmux

cmux 0.64.13 documents a `cmux browser` CLI backed by the visible native pane. It supports background surface creation, navigation, accessibility snapshots and refs, DOM-level interaction, screenshots, downloads, console/errors, and other broader operations. This extension uses a security-reduced subset rather than exposing the CLI wholesale.

The WKWebView backend does not claim full CDP parity. Viewport/geolocation/offline emulation, tracing/screencast, network interception, and raw input remain explicit non-goals.

## Security design

### Surface ownership

`CmuxBrowserClient.open()` accepts only a documented top-level `surface_id` matching a strict UUID. Nested/fallback values are rejected. The client owns one surface at a time, never accepts caller-selected surface/workspace identifiers, never adopts an existing surface, and never restores a persisted handle. Close removes ownership before another surface can be used.

### Profile boundary

cmux 0.64.13 has no documented profile selector on `browser open`. A new pane uses cmux's currently selected profile and may share its data store with other cmux panes. The extension discloses this and requires Pi TUI confirmation before first use. Users needing stronger isolation must select a dedicated cmux profile before opening.

The extension does not expose profile listing/mutation, cookies, storage, state save/load, tabs, or browser-state import/export.

### Origin approval

Navigation accepts only absolute `http:`/`https:` URLs or exactly `about:blank`. Userinfo and credential-like query keys are rejected. A slash-command URL is an explicit user authorization; model-originated new origins require Pi confirmation. Before inspect/interact actions, the extension reads the active URL internally, reduces it to an origin, and refuses unapproved, opaque, local, or custom-scheme origins. Cross-origin changes therefore stop automation until approved.

### Ref and input restrictions

Interaction and element inspection require fresh snapshot refs matching `^e[1-9][0-9]*$`. Arbitrary CSS selectors are rejected. Automated text/value entry, arbitrary keyboard input, selection, JavaScript evaluation, script injection, and upload are absent. Users enter sensitive values and choose files directly in the visible pane.

### Output classification

Every `BrowserCommandResult` is classified as:

- `captured`: bounded output from an explicit read operation and intentionally model-visible; or
- `synthetic`: fixed extension metadata whose raw cmux stdout/stderr is discarded.

Only snapshot/get/console/errors operations may request capture in the client. Synthetic tool output is rebuilt from a small boolean/number key allowlist. Failures include a fixed operation label and exit code only; raw stdout/stderr, selectors, URLs, paths, scripts, and values are never interpolated into errors or retained command metadata.

### File boundary

The extension creates a private `0700` per-session directory with `mkdtemp`. Screenshot names are extension-generated UUIDs under that root. Reads use `O_NOFOLLOW`, require a regular single-link file owned by the current user, restrict it to mode `0600`, and enforce a 10 MiB limit. The temporary file is removed after rendering and the root is removed on shutdown. Callers cannot provide screenshot, download, state, or upload host paths.

Download wait requires explicit confirmation and returns readiness metadata only. cmux owns destination selection; no destination path or event payload enters model context.

## Exposed capability map

| User outcome | Exposed route |
|---|---|
| Native rendering | extension-owned cmux browser surface opened with `--focus false` |
| Navigation | approved `http(s)`/`about:blank` open/goto; reload; approved-origin read; close |
| Inspection | accessibility snapshot; ref-scoped text/safe attribute/count/box; screenshot; console/errors; highlight |
| Interaction | fresh-ref click/double-click/hover/focus/check/uncheck/scroll; allowlisted key press; ref/load-state wait |
| Authentication | manual entry in native pane; current cmux profile only after explicit shared-profile disclosure |
| Downloads | native cmux wait with synthetic readiness result; no returned host path |
| Lifecycle | one in-memory owned UUID; explicit open/close; best-effort shutdown cleanup |
| Rollback | remove/disable one Pi resource; no cmux/Codex/system mutation |

Not exposed: eval/addscript/addinitscript, fill/type/select, arbitrary selectors/keys, tabs, profiles, cookies/storage, state files, upload, arbitrary paths/surfaces/workspaces, existing-surface adoption, or stale-handle recovery.

## Verification strategy

Deterministic client tests use a fake cmux executor to prove strict top-level UUID parsing, single-surface ownership, fixed failure diagnostics, pre-subprocess rejection of removed value-bearing capabilities, captured-output bounds, synthetic-output allowlisting, terminal close behavior, origin reduction, navigation policy, snapshot-ref grammar, and absence of dangerous tool-schema fields. Separate entrypoint-level tests load the real extension and invoke registered tools to verify approval denial, exact cmux argv, origin-change refusal, bounded private screenshot handling, and cleanup.

The real E2E must run from a fresh Pi process launched directly inside a healthy cmux workspace. It uses a local synthetic page to prove native open, load, snapshot/ref interaction, screenshot, console/errors, and cleanup. Passing fake-client tests alone is not end-to-end proof.

## Explicit non-goals

- No Codex-private runtime, socket, plugin, credential, or identity reuse.
- No binary patching, process injection, TCC/config bypass, or permission weakening.
- No claim of unsupported CDP features.
- No private/customer-data fixture.
- No silent profile, surface, workspace, or filesystem access.
