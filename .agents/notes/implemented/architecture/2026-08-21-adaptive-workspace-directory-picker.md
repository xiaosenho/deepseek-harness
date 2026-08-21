# Agent Note: Adaptive workspace-directory picking across desktop and remote web

Status: implemented

English | [中文](2026-08-21-adaptive-workspace-directory-picker.zh.md)

## Problem

The workspace-directory picker seam ([2026-07-28-directory-picker-capability-seam.md](2026-07-28-directory-picker-capability-seam.md)) ships two interaction kinds: `native` opens one OS chooser on the host display; `browse` provides in-app listing and creation for clients that cannot reach an OS chooser. A remote browser under `dsh-plugin-remote-access` mounted the native backend, whose `pick()` opens the host's OS file chooser — invisible and unusable to the remote operator. The WebUI had to keep browse on every deployment because no composition could offer the OS chooser locally and the in-app browser remotely at the same time.

A second gap sat in the privileged gate. `host.pickDirectory` sits in `PRIVILEGED_METHODS`, pinned to loopback requests. The remote-access proxy rewrites the `Host` header to `127.0.0.1:<upstreamPort>` and stamps `x-dsh-remote-access-proxy` on every forwarded request, so possession of the LAN bearer token could invoke the privileged method from a remote page. The marker was documented for host-only consumers but no harness gate consumed it.

## Decision

The seam gains a third kind, `native-browse`, declared in the seam's merge-extensible `DirectoryPickerCapabilities` map: `pick(signal)` opens the OS chooser, `list(path?, signal)` and `createDirectory(path, name)` provide the browse primitives. Consumers branch on the kind exactly as before; the apiproxy gateway accepts the kind for `host.pickDirectory`, `host.listDirectory`, and `host.createDirectory`.

`@deepseek-ai/dsh-host-directory-picker-electron` implements the kind. It inherits the browse backend, so listing and creation use Node's native filesystem APIs inside the web-host child on every platform. `pick(signal)` sends a correlated request over the existing parent-process IPC channel; the Electron main process owns the OS dialog through a dedicated helper relaunch and replies with a picked path, cancellation, or failure. The provider requires a connected parent IPC channel at load and rejects every pending pick when the channel disconnects.

`@deepseek-ai/dsh-client-ui-directory-picker-electron` routes on the page-stable `ctx.connection.isLoopback` value once during activation: loopback pages install the native flow (`ctx.workspaces.pickDirectory`), non-loopback pages install the in-app browser (`ctx.workspaces.listDirectory` / `createDirectory`). Exactly one flow transaction fills both ui-workspace single slots, so the two implementations never compete for the same slot. The shared presentation, locale dictionaries, and both installers moved into `@deepseek-ai/dsh-client-directory-picker-flows`, a presentation library with no `dsh.client` declaration or Cordis identity that each picker client bundle inlines through the shared css-modules-inline plugin; the browse and native client packages slimmed to thin installers that call the flows installers. WebUI composition is unchanged: the web profile keeps the auto/browse/native rows and never sees the electron packages.

The privileged gate now rejects proxied requests. `packages/client/connection` reads `x-dsh-remote-access-proxy` on requests to `PRIVILEGED_METHODS` and denies them regardless of the loopback pin, closing the remote-access bypass: a LAN bearer token authorizes ordinary remote API traffic but never `host.pickDirectory`. `listDirectory` and `createDirectory` stay unprivileged — they are safe browse primitives the remote browser still needs.

The Electron app composes the two overlay rows through `electron/resources/electron-directory-picker.cordis.patch.yml`, which disables the auto row and mounts the electron host and client rows in its place. Both packages are declared as dependencies by the shell (`electron/package.json`, so electron-builder ships them and the main-process bridge resolves them) and by the web-app bundle (`packages/bundle/web-app`, so the profile module fallback mirrors them for the CLI child's Loader).

## Alternatives considered

- **Keep native locally and hard-fail remotely.** The composition could not branch per page; remote clients would lose directory picking entirely. Rejected because the in-app browser already serves them.
- **Reuse the auto backend with a client-side URL or header hint.** The auto row inspects the host once at boot, not per connection; a per-page choice belongs in the client, and a hint would have to survive the proxy rewrite. The loopback client route is the direct expression of the same rule the proxy already documents.
- **Reject the marker only at the plugin boundary.** The remote-access plugin could refuse to forward `host.pickDirectory`; the harness would then depend on a third-party plugin's good behavior for a privileged method. The connection gate enforces the invariant in the product.
- **Let the electron client install both flows unconditionally.** Both installers fill the same two single slots; the second install would fail or displace the first. One route per page is the only composition that satisfies the slot model.

## Consequences

- The desktop app and remote browsers each get the interaction that works for them: OS chooser locally, in-app browser remotely, from one composition.
- The seam and the apiproxy contract gain a third kind; existing consumers keep branching on `kind` with a documented unknown-kind default.
- LAN bearer tokens remain incapable of invoking `host.pickDirectory`; the remote-access marker is now load-bearing in the harness.
- The flows library is inline-only: mounting it as a Loader row provides no UI, and the css-modules-inline plugin keeps its sheet in inlined consumers.
- The two electron picker packages must be declared by both the shell and the web-app bundle; a future removal must drop both declarations.
- Verification: the electron composition test boots the shipped overlay through the real Loader and asserts both rows activate; the bridge and helper specs cover IPC correlation and cancellation; the connection trust spec covers marker rejection.
