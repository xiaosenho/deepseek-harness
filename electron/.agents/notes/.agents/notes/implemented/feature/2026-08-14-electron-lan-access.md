# Agent Note: Electron LAN access uses an ephemeral bearer URL

Status: implemented

English | [中文](2026-08-14-electron-lan-access.zh.md)

## Problem

The Electron application owns a complete local WebUI process, but a loopback-only listener cannot serve a phone on the same LAN. Publishing an ordinary all-interfaces WebUI is not a display-only change: the ordinary agent API can drive tools that execute commands and access the host workspace.

The general `dsh web` command deliberately rejects `--host 0.0.0.0` because the Web carrier has no deployment authentication or TLS. Electron needs a narrower access path whose address and credential share the lifetime of its owned background process without reopening that general CLI mode.

## Decision

Every Electron-owned WebUI starts on loopback with port `0`, with no LAN overlay or remote-access token. Remote access is therefore disabled at every application launch. When Electron owns that backend, main adds a **Remote Access** section to the native application menu; its commands are the only control surface for enabling, inspecting, copying, and disabling LAN access. `DSH_ELECTRON_URL` mode omits that menu section because the external WebUI owns its network and authentication policy. No WebUI renderer receives a remote-access preload or renderer IPC bridge.

Electron main serializes each enablement change as a background-process replacement. It stops the active process, starts the requested mode on a new operating-system-assigned port, waits for readiness, and loads the replacement process's loopback URL in `BrowserWindow`. The WebUI then boots against the new origin and establishes fresh HTTP and WebSocket connections without an operator reload. If the requested mode fails to start, the controller attempts to restore the previous mode, loads that replacement origin when recovery succeeds, and reports the failure without claiming the requested state. Failure to stop the active process, failure to restore a usable previous mode, or failure to load a ready replacement origin is fatal: Electron shows one native error and requests application exit after acknowledgement. The exit barrier runs shutdown, permits another attempt after cleanup failure, and allows process exit only after the owned WebUI process tree has stopped. A later application launch starts from the loopback-only default rather than persisting the requested state.

Enabling applies the Electron-only profile overlay that binds `0.0.0.0` on port `0` while preserving the general `dsh web --host 0.0.0.0` rejection. Electron main generates `randomBytes(9).toString('base64url')`, producing a fresh 12-character token for that LAN process, and derives `http://LAN-IP:port/#dsh-access=TOKEN` from the first external IPv4 address. After a successful start, main presents this complete bearer URL in a native details dialog with a copy action. The credential never enters the managed renderer, native window title, or an application-menu label. Disabling stops the LAN process before starting its loopback-only replacement, which invalidates the old token and makes its URL and cookie value unusable. A later enablement creates another token.

Remote-access controls do not cross browser IPC. Native start and stop commands show confirmation dialogs, then re-check authoritative controller state before changing the backend. While a change is active, the menu reports a changing state and disables every remote command. Details and copy commands operate only on a settled enabled state. The details dialog offers to copy exactly the URL it displayed; if the credential rotates while that dialog is open, main refuses the stale copy and asks the operator to reopen the details. Electron main performs every operating-system clipboard write.

For one non-empty token fragment, the phone browser first expires any legacy `dsh_remote_access` cookie at `Path=/`, stores the bearer in a `SameSite=Strict` session cookie named `dsh_remote_access` at `Path=/api`, and tries to write the token-free `dsh_remote_access_present=1` marker to per-origin `sessionStorage`. When the marker write succeeds, `location.replace(cleanUrl)` uses a same-origin replacement navigation to the same path, query, and remaining fragment parameters without the token. The formal WebUI document starts only after those writes, so its first protected API and WebSocket connections include the cookie instead of racing credential bootstrap. If session storage is absent or its write throws, the client uses `history.replaceState` to remove the token and continues the current document; the successful fragment result therefore preserves this load's local Host-authority hint without depending on a marker that could not be stored. The root page cannot read the `/api` cookie and uses only the marker on later loads; the marker neither contains the bearer nor authenticates requests. A URL fragment is not sent in the initial HTTP request, so the credential does not enter that request target, intermediary logs, or a referrer before the browser stores it.

Cookie scope does not include a port. `Path=/api` materially narrows delivery, but an `/api` service on another port of the same IP literal or hostname may receive the bearer cookie. The deployment trust scope for this feature must therefore include every such service. The session marker is isolated by origin, including port, but does not alter cookie delivery.

The connection carrier applies the access token in addition to the existing [carrier-level Host, Origin, and media-type checks](../architecture/2026-07-28-api-browser-trust-boundary.md). While the LAN mode is active, non-loopback `/api` HTTP and RPC requests and WebSocket upgrades must present its current token; loopback traffic is exempt.

The WebUI's primary API and generic logical RPC paths mint browser-side correlation UUIDs from `crypto.getRandomValues()`, and the conversation client uses that primitive for browser-local draft attachment ids. These LAN paths do not depend on the secure-context-only `crypto.randomUUID()`.

The loopback exemption from `trustedHosts` and token checks has a second condition at every Node HTTP, RPC, and WebSocket entry: the TCP peer must be in `127.0.0.0/8`, be `::1`, or be an IPv4-mapped form of `127.0.0.0/8` such as `::ffff:127.0.0.1`. A non-loopback peer that supplies a loopback `Host` is refused before dispatch even when it carries the correct token; HTTP and RPC receive 403, and a WebSocket upgrade is rejected. After the Node entry passes, the Fetch bridge drops socket metadata, so downstream Fetch checks rely on the established peer/Host invariant.

When LAN mode configures `remoteAccessToken`, a valid token on its trusted LAN authority receives the same programmable Host access as loopback except for explicitly loopback-only interactions such as the desktop-native directory chooser. Token-eligible access includes settings, credentials, Host path opening, agent-preset authoring, `llm.discoverModels`, and registered `authority: loopback` RPC. [The Electron token Host authority decision](2026-08-14-electron-token-host-authority.md) owns that privilege rule; this note owns bearer delivery and lifecycle. `trustedHosts` without a valid token remains non-privileged.

The token is a bearer secret over plain HTTP, not a user identity or a general remote-deployment authentication system. Anyone who sees the complete URL in the native details dialog, reads the desktop clipboard after a copy, captures the cookie in transit, or controls a same-host `/api` service that receives the cookie can operate the agent. The supported environment is a trusted company network where phone and desktop share the intended LAN and every cookie-receiving service is trusted with the bearer. The operating-system firewall must allow DeepSeek Harness inbound traffic on the trusted or private network profile, or the phone cannot reach the listener; client isolation or equivalent controls must exclude untrusted peers. The Electron host relationship remains owned by the [desktop wrapper decision](../architecture/2026-08-14-electron-web-profile-host.md).

## Verification

The assembled browser regression resolves a non-local `.test` authority to the loopback test server, proves the page is a non-secure HTTP origin with no `crypto.randomUUID()` and an available `crypto.getRandomValues()`, then exercises bearer bootstrap plus Host sessions, settings, and filesystem access through browser-originated requests. Electron tests cover owned-versus-external menu composition, controller-state projection without a URL in menu labels, native confirmation and detail flows, replacement-origin navigation, main-owned clipboard writes, credential rotation, and cleanup retry behavior.

## Alternatives considered

**Start every Electron-owned WebUI with remote access enabled.** Rejected because the Host would accept LAN traffic whenever the desktop application runs, even when the operator needs only the local window. The explicit native menu command keeps exposure opt-in for each application launch.

**Keep Electron loopback-only and require a separately managed Web server.** Rejected because the desktop application would no longer provide the requested one-application phone access, and the operator would have to discover and secure a second server manually.

**Re-enable `dsh web --host 0.0.0.0` for every caller.** Rejected because it would restore a general unauthenticated remote-code-execution surface. The Electron overlay couples all-interface reachability to an explicitly enabled process and its fresh token.

**Use a persistent shared secret or a complete user-authentication system.** Rejected for this trusted-LAN feature because persistent credential storage, recovery, rotation, and user identity are separate deployment concerns. A process-lifetime token limits persistence without claiming to solve remote deployment.

**Carry the token in a query parameter.** Rejected because the browser would send it in the HTTP request target and retain it in more logs and navigation records. The fragment-to-cookie handoff keeps it out of the initial request. Its normal marker-bearing path replaces that history entry with a token-free same-origin URL before the formal WebUI boots, while the storage-failure fallback cleans the current entry in place.

**Scope the bearer cookie to `/` so the root page can read it.** Rejected because every same-host path would receive the credential. `Path=/api` confines normal delivery to API paths, while the token-free session marker lets the root page remember that bootstrap occurred without reading or duplicating the bearer.

**Advertise the bearer URL in the native window title or a menu label.** Rejected because the credential would remain visible outside the deliberate native details dialog. The title retains ordinary WebUI copy, while menu labels expose only state and actions.

**Put remote-access controls in Web Settings through a narrow preload bridge.** Rejected because backend lifecycle, credential disclosure, and clipboard access are Electron-owned operations. Keeping the workflow in native main-process UI gives dynamically composed Web plugins no remote-control API or bearer value.

## Consequences

A phone on the same reachable LAN can open the exact URL shown in the native details dialog without a separate login step. Enabling or disabling access interrupts work in the replaced WebUI process, but Electron loads the replacement origin automatically. A recoverable start failure also loads a newly restored origin. An unsafe stop, failed rollback, or failed replacement load produces a fatal native error and requests exit; the application exits only after owned-process cleanup succeeds. Reopening starts a loopback-only backend. The cookie has no persistent expiration time, but stopping the LAN process invalidates its token; disabling access or restarting Electron therefore revokes the previous URL and restores a loopback-only backend.

The process token grants complete programmable Harness Host authority but cannot trigger the desktop-native directory chooser. Phone uploads read files selected in the phone browser, while workspace paths and the in-app workspace browser refer to the Host filesystem.

There is no confidentiality against the local network: neither the page nor the cookie is protected by TLS. Displayed and copied URLs must be treated as credentials, and firewall, network isolation, and the trustworthiness of same-host `/api` services remain parts of the operating environment rather than application guarantees. A copied URL can remain in the operating-system or synchronized clipboard after access is disabled or Electron exits, where other applications may read it; it must be replaced after use. Disabling access or restarting Electron invalidates the copied URL but does not clear the clipboard.

Only the first external IPv4 address is displayed. A multihomed host may show an address outside the phone's LAN, and Electron provides no interface chooser or IPv6 address.
