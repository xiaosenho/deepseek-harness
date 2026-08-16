# @deepseek-ai/dsh-client-ui-desktop-electron

English | [中文](README.zh.md)

Electron-only browser controls for desktop remote access and application updates. The Host entry is intentionally empty; the `/client` plugin registers only when the managed local window exposes the complete `window.dshElectron` preload API. Generic WebUI deployments, remote browsers, and Electron windows pointed at `DSH_ELECTRON_URL` receive none of these contributions.

## Contributions

The plugin contributes the **Remote Access** Settings section, where the operator selects LAN or public FRP, edits FRP preferences only while access is off, confirms each enable or disable operation, sees the credential-free public endpoint, and asks Electron main to copy the complete bearer URL. The `frpc` executable and required trusted CA use purpose-specific native file selectors; their path fields are read-only, cancellation leaves the draft unchanged, and the selectors exist only in the managed local window. The form validates the bare server address, control and public ports, optional public origin, selected files, optional certificate server name, explicit authentication-token operation, and plaintext acknowledgement before it sends one complete configuration update. The [Electron application README](../../../apps/electron/README.md#remote-access) owns transport behavior, `frpc` requirements, failure recovery, and security guidance.

The plugin also contributes **Software information** to General Settings and an update badge beside the sidebar product mark. Both project Electron main's updater state. The General row exposes the installed version, current status, release notes, manual check, and prepared-install action; the badge appears only for a prepared update and opens the same release notes and install action.

## Preload API

`ElectronDesktopBridge` is the JSON-safe interface shared by Electron main, the sandboxed preload, and this client plugin. `DesktopControlController` validates every returned field, serializes renderer commands, and polls at one-second intervals only while remote access is enabled or transitioning or an update check is active. A bridge read failure moves the contributions to a failed state instead of accepting a partial or malformed response.

Electron main remains authoritative for backend replacement, native FRP file dialogs, configuration persistence, secret encryption, clipboard writes, update download, and installation. The bridge accepts only the two file purposes and returns a selected absolute path or cancellation; it does not expose a general filesystem API. The renderer receives the stored `frps` token only as `authTokenConfigured`, sends explicit keep/replace/clear operations, and receives only a credential-free public endpoint. `copyRemoteAccessUrl()` returns success or failure after Electron main writes the current token-bearing URL; the bearer never crosses back into renderer state.

## Model Experience

None, as this browser-side Electron settings and update plugin registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No push channel** — the controller observes main-process changes by bounded polling, so an unexpected tunnel exit or updater transition can take up to one polling interval to appear in an already-loaded page.
- **Configuration is disabled while exposed** — changing the transport or FRP fields requires disabling remote access first; each enable or disable operation restarts the Electron-owned WebUI and can interrupt active browser work.
