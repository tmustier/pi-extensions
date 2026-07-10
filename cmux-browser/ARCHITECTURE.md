# Native cmux browser for Pi — architecture

Issue: [#53](https://github.com/tmustier/pi-extensions/issues/53)

## User-visible behavior

A Pi session running in a cmux terminal can create and operate cmux's real browser surfaces without moving focus away from Pi. The model gets structured navigation, snapshot/inspection, interaction, session/tab, upload/download, screenshot, and diagnostics tools; the user sees the same native `WKWebView` browser pane used by cmux itself.

## Evidence and route audit

### Codex surfaces inspected

- Codex CLI 0.143.0 publicly reports stable `browser_use`, `browser_use_external`, `browser_use_full_cdp_access`, `computer_use`, and `in_app_browser` feature keys.
- `codex app-server generate-json-schema` succeeds, but its public v2 protocol contains configuration requirements for computer use, not a public browser-control request surface.
- Codex's browser implementation is delivered through Codex Desktop/plugin runtime machinery. Reusing private bundled plugin scripts, internal pipes, credentials, signatures, or app identity would be unsupported and would cross the issue's explicit safety boundary.

Conclusion: there is no supported public Codex browser protocol that a Pi extension can directly embed today. This extension must not load Codex-private plugin files or imitate app identity.

### Pi public extension points inspected

The current Pi README, `docs/extensions.md`, `docs/tui.md`, `docs/keybindings.md`, `docs/packages.md`, extension examples, and installed types support:

- typed model-callable tools (`registerTool`), custom renderers, commands, and status UI;
- abort-aware child processes through `pi.exec`;
- session reconstruction from persisted tool-result `details`;
- startup/shutdown hooks and package installation.

Pi's TUI can render terminal components and images, but cannot host an AppKit `WKWebView`. A TUI browser would therefore be a reduced imitation and fails the requested native rendering/interaction outcome.

### cmux public browser route

cmux 0.64.13 exposes a documented, supported `cmux browser` CLI backed by the browser pane the user actually sees. It includes:

- native surface creation with `--focus false`;
- navigation and full WebKit rendering;
- accessibility/DOM snapshots and ref-based interaction;
- tabs, profiles, cookies/storage, state save/load;
- screenshots, downloads, console/errors, highlighting, and JavaScript evaluation.

The browser defaults to the caller's `CMUX_WORKSPACE_ID`, which keeps the pane beside the originating Pi session even if another workspace is focused. Its browser profile/data store preserves authentication according to cmux's supported profile behavior.

Known public cmux/WKWebView limits are reported honestly: viewport/geolocation/offline emulation, tracing/screencast, network interception, and raw low-level input currently return `not_supported`. The extension does not claim CDP parity for those operations.

## Selected architecture

A normal Pi package extension delegates only allowlisted operations to the public `cmux browser` CLI:

```text
Pi model / user command
        │
        ▼
strict TypeBox tool schema
        │
        ▼
argument builder (no shell, no arbitrary passthrough)
        │
        ▼
pi.exec(cmux, argv, { signal, timeout })
        │
        ▼
cmux socket API → native browser surface / WKWebView
```

Design constraints:

1. **Native, not simulated.** Rendering and direct user interaction stay in cmux's browser pane.
2. **No focus theft.** Every surface-creation path explicitly passes `--focus false`; automation never calls `focus-webview`.
3. **Origin workspace.** New surfaces rely on `CMUX_WORKSPACE_ID` or an explicit workspace argument, never the currently focused workspace.
4. **Supported auth.** The extension uses cmux profiles/state/cookies APIs. It never reads browser or Codex credential stores and never returns cookie values unless the caller explicitly invokes the cookie-read operation.
5. **Safe execution.** Commands are spawned as argv, not through a shell. Output is truncated before entering model context. File paths are resolved; upload requires an explicit regular file plus interactive approval, and profile deletion is also confirmed.
6. **Lifecycle and recovery.** The last successful surface UUID is stored in tool-result details and reconstructed on `session_start`; commands can override it. Stale/missing surfaces fail with a recovery instruction rather than silently opening or focusing a replacement.
7. **Rollback.** Remove/disable only `cmux-browser/index.ts` (or filter it from the package) and restart/reload Pi. The extension does not modify cmux, Codex, browser profiles, Pi core, or system settings.

## Upload approach

cmux supports native user drag/drop into file inputs but currently has no documented `browser upload` automation command. For agent-driven uploads, the extension uses the supported `browser eval` command to construct a DOM `File`, assign it through `DataTransfer`, and dispatch `input`/`change` on an explicitly selected file input. Bytes are transferred in bounded base64 chunks and the temporary page global is cleared in `finally`.

This is normal page-level WebKit automation, not a permission bypass. It may not work on sites that intentionally reject synthetic file-input events; the tool reports that boundary. It never prints file contents.

## Acceptance mapping

| Requirement | Route |
|---|---|
| Navigation/rendering | cmux native browser surface + navigation operations |
| Interaction | snapshot refs/CSS plus click, fill, type, key, select, check, scroll, wait |
| Sessions/tabs | surface UUID recovery; tabs; profile/state APIs |
| Auth-preserving behavior | cmux profile/data store; state/cookie/storage operations |
| Uploads/downloads | bounded DOM file upload; native download wait/path result |
| Screenshots | cmux browser screenshot to explicit/default path |
| Debug/inspect | snapshot/get/eval/console/errors/highlight |
| Lifecycle/recovery | persisted surface details, lazy validation, actionable stale-surface errors |
| Background behavior | `--focus false`; no webview focus command |
| Fresh install | package manifest entry, no runtime dependency |
| Rollback | disable/remove one manifest resource; no external mutations |
| E2E | real cmux browser smoke from fresh Pi plus deterministic fake-cmux tests |

## Explicit non-goals and blockers

- No reuse of Codex-private plugin scripts, internal pipes, credentials, or signing identity.
- No binary patching, injection, TCC changes, or protective-measure bypass.
- No claim that WKWebView offers unsupported CDP-only features.
- No private/customer-data E2E fixture; tests use local/public synthetic pages.
