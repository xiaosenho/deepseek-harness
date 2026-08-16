# Agent Note: Electron owns the Windows native directory picker

Status: implemented

English | [中文](2026-08-14-electron-owned-native-directory-picker.zh.md)

## Problem

The Windows Electron application must let its local operator choose a workspace through the operating system dialog. The general Web profile's Win32 backend runs a Koffi/COM worker below the Node host process, but that worker can exit without a result under the packaged Electron Node runtime. Always using the in-app browser avoids that failure but removes the expected desktop interaction. The same Electron-owned Web server also admits token-authenticated LAN browsers, which must not gain authority to open a dialog on the desktop. Finally, the directory-picker seam requires caller abort to stop an outstanding chooser, while Electron's asynchronous dialog API has no close operation.

## Decision

The Windows Electron overlay mounts `dsh-host-directory-picker-electron`, whose stable `native-browse` capability combines `pick(signal)` with the browse backend's `list(path, signal)` and `createDirectory(path, name)`. Listing and creation continue to call Node's native filesystem APIs in the Web-host child; model-facing file tools remain on their existing filesystem seam. The matching client plugin occupies each existing single directory-flow slot once and selects the native flow for a loopback connection or the browse flow for a non-loopback connection.

The Web-host child sends branded, correlated picker requests over the private IPC channel it already has to its owning Electron main process. Both ends validate the exact message fields. Disconnect and plugin teardown reject pending requests, cancellation removes the pending request before a best-effort cancel message, and unrelated or late messages have no effect. The IPC channel is not exposed through preload or renderer APIs.

Electron main launches a dedicated Electron helper process for each accepted native pick. The helper owns one `dialog.showOpenDialog` call and emits one validated result over stdout. Cancellation, backend exit, or application shutdown aborts the request and terminates the helper process tree, which also closes a visible dialog. A long-lived main-process dialog cannot meet that lifecycle requirement because Electron provides no API to dismiss an asynchronous chooser after it opens.

The existing `host.pickDirectory` authorization remains loopback-only, including its socket-peer and Host-header checks. Possession of the Electron LAN bearer token authorizes ordinary remote API traffic but never this method. Consequently, a phone receives the in-app browser and cannot trigger the desktop chooser even by issuing the native RPC directly. The general [`directory-picker-native`](../feature/2026-07-27-native-workspace-directory-picker.md) backend remains available to non-Electron Web compositions; packaged Windows Electron avoids only its incompatible Koffi/COM execution path.

## Alternatives considered

**Expose Electron's dialog API through preload.** Rejected because every dynamically loaded browser plugin would gain a privileged renderer path, while the owned backend child already provides a narrower authenticated carrier.

**Open the dialog directly in the long-lived Electron main process.** Rejected because `showOpenDialog` cannot be programmatically closed. Ignoring a late result would release the request but leave an ownerless dialog visible after cancellation or shutdown.

**Keep the packaged Koffi/COM child.** Rejected because its missing-result failure is the defect this provider removes. The implementation remains valid for ordinary Node-hosted Web compositions.

**Use the in-app browser for every Electron client.** Rejected because it gives the local desktop operator a Web file-browser interaction despite Electron already owning an OS-native dialog API. The browse path remains necessary for remote clients.

**Advertise one capability kind per connection over the wire.** Rejected because the Electron host can expose both operation sets as one stable capability and the existing connection service already supplies the trusted loopback fact needed to select one client flow. A new advertisement would duplicate that fact and revive the cross-plugin branching removed by the directory-picker seam.

## Consequences

The Windows desktop window opens a native operating-system directory chooser without granting Node or Electron access to its renderer. LAN browsers continue to browse and create directories through direct Node filesystem operations in the host child, while native-dialog authority remains local. The implementation adds a private parent-process protocol and one short-lived Electron process per native chooser so cancellation has a real process owner. macOS, Linux, and general Web deployments retain their existing adaptive or pinned directory-picker compositions.

The [directory-picker seam](2026-07-28-directory-picker-capability-seam.md), [adaptive default](../feature/2026-07-29-directory-picker-adaptive-default.md), and [Electron Web host](2026-08-14-electron-web-profile-host.md) notes remain active: they still own the general capability, boot-time selection, and desktop process/security decisions. This note owns only the Electron-specific mixed interaction and chooser lifecycle, so none of those records is superseded or archived.
