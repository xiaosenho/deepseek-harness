# Agent Note: Electron remote tokens grant Host authority

Status: implemented

English | [中文](2026-08-14-electron-token-host-authority.zh.md)

## Problem

The `/api` Host and Origin fence protects the Harness Host from DNS rebinding and cross-site browser requests. A `trustedHosts` entry identifies an authority the deployment serves; it is not authentication and must not grant settings, credentials, native actions, or RPC endpoints declared for loopback authority.

Electron intentionally gives a phone an explicit process credential. The ordinary remote agent surface can already start sessions and invoke tools such as bash under the Host process account, while the phone UI also needs the configuration, credential, model-discovery, preset-authoring, and workspace interactions available in the desktop window. The credential's authority must be stated directly rather than implying a reduced remote tier that does not match either the agent surface or the product behavior.

## Decision

When `ConnectionConfig.remoteAccessToken` is configured, every non-loopback request must present both a trusted Host authority and the exact token. For token-eligible privileged API methods and registered Typert RPC declared with `authority: loopback`, that configured token extends the accepted authority to token-authenticated `trustedHosts`. Methods explicitly classified as loopback-only remain unavailable to remote callers. When no token is configured, `trustedHosts` retains its non-privileged behavior and cannot reach those surfaces.

A valid token therefore grants the remote client the same programmable Harness Host access as loopback, except for explicitly loopback-only interactions. This includes ordinary session and agent operations, settings and credentials, Host path opening, `llm.discoverModels`, agent-preset authoring, and registered loopback-authority RPC. `host.pickDirectory` remains loopback-only because it opens a desktop-native chooser; the remote UI selects Host directories through the in-app browser instead. The bearer is otherwise equivalent to controlling the Harness Host under the desktop user's operating-system account, subject to the same runtime policies and tool sandboxes as the loopback UI.

The token does not weaken the outer Node authority invariant. A loopback `Host` is exempt only when the TCP peer is in `127.0.0.0/8`, is `::1`, or is an IPv4-mapped loopback address. A non-loopback peer that forges a loopback `Host` is rejected before HTTP or RPC dispatch and before WebSocket upgrade even if it presents the valid token. Fetch checks after the bridge rely on that outer invariant because Fetch `Request` objects carry no TCP peer address.

Electron delivers the token through the complete `http://LAN-IP:port/#dsh-access=TOKEN` URL described by the [LAN access decision](2026-08-14-electron-lan-access.md). The phone browser expires any legacy `dsh_remote_access` cookie at `Path=/`, stores the bearer in the `dsh_remote_access` session cookie at `Path=/api`, records a token-free per-origin marker for the root page, and removes the fragment. Opening only the bare IP and port may load the static shell, but API and WebSocket requests receive 403 unless the browser already has the current process cookie; the marker does not grant authority.

File ownership follows the executing client and Host service. Upload, drag, and paste inputs select files from the phone browser and serialize them to the Host. Workspace paths and the in-app directory browser are Host-side: a phone navigates and selects directories on the desktop machine, and the resulting sessions and workspace registry remain Host-owned.

## Alternatives considered

**Keep token-authenticated remote access on a reduced API tier.** Rejected because the ordinary agent surface already permits Host command execution, the phone UI needs the same administrative interactions as the desktop window, and a reduced label would promise a security property the accessible tool surface does not provide.

**Let `trustedHosts` grant the same authority without a token.** Rejected because an authority allowlist is a DNS-rebinding and confused-deputy defense, not proof that the remote caller is authorized. Conflating the two would turn an unauthenticated programmatic all-interface composition into a privileged Host API.

**Add users, scoped permissions, or a persistent login.** Deferred as a separate remote-deployment design. The Electron feature deliberately uses one process-lifetime, all-or-nothing bearer for a trusted LAN and does not claim user identity, confidentiality, or revocation within a running process.

## Consequences

The complete Electron LAN URL and its cookie are Host-control credentials. They travel over plain HTTP without TLS, so anyone who sees or intercepts either value can use the full Harness surface. Cookies do not isolate ports: `Path=/api` narrows delivery, but another `/api` service on the same IP literal or hostname may receive the bearer and must be inside the deployment credential trust scope. The listener is suitable only for a trusted LAN with the operating-system firewall and network isolation configured to exclude untrusted peers; it must not be exposed through public Wi-Fi, port forwarding, or an untrusted proxy.

Restarting Electron rotates the process token and invalidates earlier URLs and cookies. A cookie has no persistent expiration time, but browser session restoration may preserve it until rotation makes its value unusable.

Remote clients with the current token see and modify Host-owned sessions, settings, credentials, presets, and workspace records. Phone-local files enter only when the user selects them for upload; directory browsing and workspace paths refer to the Host filesystem.
