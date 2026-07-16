# Native cmux browser for Pi — architecture

Issue: [#53](https://github.com/tmustier/pi-extensions/issues/53)

## Outcome and supported route

A Pi session launched directly in a cmux terminal can open, navigate, and inspect a visible native cmux `WKWebView` pane while keyboard focus remains in Pi. The implementation uses only public extension and CLI surfaces:

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
pi.exec(Node bounded runner, fixed script + argv)
        │  combined stdout/stderr hard-capped at 10 MiB
        ▼
documented cmux 0.64.13 browser CLI → owned native WKWebView surface
```

## Route audit

### Codex

Codex CLI 0.143.0 advertises browser/computer-use feature keys, but its public app-server v2 protocol does not expose a supported browser-control request surface. The browser implementation is part of Codex Desktop/plugin runtime machinery. Loading bundled private scripts, connecting to internal pipes, copying credentials, imitating app identity, or patching a binary would be unsupported and violates issue #53's safety boundary.

### Pi

Pi's documented extension API provides typed model tools, commands, renderers, confirmation UI, abort-aware `pi.exec`, and lifecycle hooks. Its terminal UI cannot embed AppKit `WKWebView`. A terminal-only imitation would not provide the requested native renderer.

### cmux

cmux 0.64.13 documents a `cmux browser` CLI backed by the visible native pane. The extension requires exactly this version before every model operation because its close, snapshot, and redaction contracts are version-pinned; newer or older versions fail closed. It supports background surface creation, navigation, accessibility snapshots and refs, DOM-level interaction, screenshots, downloads, console/errors, and other broader operations. This extension uses a security-reduced subset rather than exposing the CLI wholesale.

The WKWebView backend does not claim full CDP parity. Viewport/geolocation/offline emulation, tracing/screencast, network interception, and raw input remain explicit non-goals.

## Security design

### Surface ownership

`CmuxBrowserClient.open()` accepts only a documented top-level `surface_id` matching a strict UUID. Nested/fallback values are rejected. The client owns one surface at a time, never accepts caller-selected surface/workspace identifiers, never adopts an existing surface, and never restores a persisted handle. Every client operation passes through one promise queue, so concurrent opens cannot both pass the ownership check or orphan a second pane. Both Pi tools also declare `executionMode: "sequential"` so approval, origin revalidation, and execution stay ordered across sibling tool calls. A failed, aborted, interrupted, or malformed open permanently blocks further opens because cmux may have created a pane whose UUID was never learned. Close requires a non-interrupted zero exit and the cmux 0.64.13 public CLI result shape repeating the exact owned top-level `surface_id`; otherwise ownership is retained. A `globalThis` registry keyed with `Symbol.for` carries unresolved lifecycle state across extension module replacement, so `/reload`, `/new`, resume, or fork cannot sidestep the block. Only a Pi process restart resets it; the extension never adopts a possibly stale surface.

### Profile boundary

cmux 0.64.13 has no documented profile selector on `browser open`. A new pane uses cmux's currently selected profile and may share its data store with other cmux panes. The extension discloses this and requires Pi TUI confirmation before first use. Users needing stronger isolation must select a dedicated cmux profile before opening.

The extension does not expose profile listing/mutation, cookies, storage, state save/load, tabs, or browser-state import/export.

### Origin approval

Navigation accepts only an `http(s)` origin root (normalized to `/`) or exactly `about:blank`. Every non-root path, query, fragment, and URL userinfo value is rejected, so credentials, signed links, OAuth/OIDC/SAML artifacts, magic-link path tokens, and unknown future credential-key families cannot enter process arguments. A slash-command URL is an explicit user authorization; model-originated new origins require Pi confirmation. For inspection, cmux returns the accessibility snapshot and its top-level URL in one response. The extension privately reduces that URL to an origin before releasing text. If the origin is new, it obtains approval and requires a second snapshot reporting the same origin. This closes the cross-origin TOCTOU gap for reads. The public CLI has no atomic expected-origin precondition for actions or other read commands, so interactions, screenshots, generic property reads, console/errors, reload, and download wait are deliberately not registered as model tools.

### Input restrictions

The model has no interaction or ref-targeted inspection tool. Arbitrary selectors, automated text/value entry, keyboard input, selection, JavaScript evaluation, script injection, upload, screenshots, downloads, and debugging reads are absent. Users perform those operations directly in the visible pane.

### Output classification

Every `BrowserCommandResult` is classified as:

- `captured`: bounded output from an explicit read operation and intentionally model-visible; or
- `synthetic`: fixed extension metadata whose raw cmux stdout/stderr is discarded.

The extension exposes capture only for snapshot. A fixed Node child runner streams cmux output through a combined 10 MiB cap before `pi.exec` can accumulate it, killing the child and returning failure at the boundary. Snapshot then has a dedicated projection: the bounded raw cmux JSON is privately parsed, its top-level URL is reduced to an internal origin, and output is reduced to 50 KiB of top-level accessibility `snapshot` text plus validated keys from the top-level `refs` map. `page.text`, `page.html`, full URL, the standalone title field, ref metadata, and every other raw field are discarded before the tool result is built. Because cmux 0.64.13 can use a live input value as an accessibility name even when an input declares a misleading explicit ARIA role, every quoted name on a ref-bearing line and the document title are stripped. The model receives structural roles/refs and body-text fallback, never element labels. Generic capture is forbidden for snapshots. The result type is a discriminated union: its synthetic variant has no stdout, stderr, or parsed subprocess JSON fields at all, only fixed extension-owned boolean metadata. Tool rendering rebuilds that metadata from a small key allowlist as an additional runtime boundary. This is redaction by construction, not pattern-based secret detection. Failures include a fixed operation label and exit code only; raw stdout/stderr, selectors, URLs, paths, scripts, and values are never interpolated into errors or retained command metadata.

### File boundary

No exposed tool accepts or returns a host path. Screenshot, download, state, and upload operations are absent; the extension creates no browser-output files.

## Exposed capability map

| User outcome | Exposed route |
|---|---|
| Native rendering | extension-owned cmux browser surface opened with `--focus false` |
| Navigation | approved `http(s)` origin-root/`about:blank` open/goto; current-origin read; close |
| Inspection | bounded, element-name-redacted structural accessibility snapshot atomically bound to its reported origin |
| Interaction | manual in the visible native pane only |
| Authentication | manual entry in native pane; current cmux profile only after explicit shared-profile disclosure |
| Files/downloads | manual in the visible native pane; no model host paths |
| Lifecycle | one owned UUID; exact close acknowledgement; process-wide fail-closed replacement marker; best-effort shutdown cleanup |
| Rollback | remove/disable one Pi resource; no cmux/Codex/system mutation |

Not exposed: actions, reload, ref/property reads, screenshots, console/errors, downloads, eval/addscript/addinitscript, fill/type/select, arbitrary selectors/keys, tabs, profiles, cookies/storage, state files, upload, arbitrary paths/surfaces/workspaces, existing-surface adoption, or stale-handle recovery.

## Verification strategy

Deterministic client tests use a fake cmux executor to prove strict top-level UUID parsing, single-surface ownership, interrupted/malformed close retention, exact close acknowledgement, fixed failure diagnostics, pre-subprocess rejection of value-bearing capabilities, captured-output bounds, snapshot projection that excludes raw page/HTML fields and editable names, authoritative ref-map validation, synthetic-output allowlisting, terminal close behavior, origin reduction, navigation policy, and absence of dangerous tool-schema fields. Separate entrypoint-level tests load the real extension and invoke registered tools to verify approval denial, atomically origin-bound snapshot release, origin-change refusal, element-name redaction (including misleading explicit roles), and fail-closed behavior after extension replacement.

The real E2E must run from a fresh Pi process launched directly inside a healthy cmux 0.64.13 workspace. It uses a local synthetic page to prove background native open, load, origin-bound structural accessibility snapshot, and exact close acknowledgement. Success is printed only after `closeAll()` reports no retained ownership. Passing fake-client tests alone is not end-to-end proof.

## Explicit non-goals

- No Codex-private runtime, socket, plugin, credential, or identity reuse.
- No binary patching, process injection, TCC/config bypass, or permission weakening.
- No claim of unsupported CDP features.
- No private/customer-data fixture.
- No silent profile, surface, workspace, or filesystem access.
