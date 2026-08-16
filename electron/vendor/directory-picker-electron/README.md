# @deepseek-ai/dsh-host-directory-picker-electron

English | [中文](README.zh.md)

The **Electron-hosted backend** of the [directory-picker seam](../directory-picker/README.md) registers one `native` capability. `pick(signal)` sends a correlated request over the web-host child's existing parent-process IPC channel; the Electron main process owns the OS dialog and replies with a picked path, cancellation, or failure. The web renderer receives no Electron or Node bridge. The upstream kernel's single-capability contract serves one interaction shape per process, so the fork's combined native-plus-browse surface is not carried: remote clients get the kernel's browse backend through the standard adaptive composition instead.

The provider requires a connected parent IPC channel at plugin load. It strictly validates inbound messages, ignores unrelated IPC traffic, correlates concurrent requests by branded ids, and rejects every pending pick when the channel disconnects or the plugin leaves. Caller abort sends a best-effort cancel message and rejects immediately with the caller's reason. The bundled Electron bridge handles that cancellation by aborting the dedicated dialog helper and waiting for its complete process tree to exit, which closes an already-visible chooser.

The `./protocol` export contains the child/request and parent/result message unions, validators, and request-id factory used by the Electron main process. `ElectronDirectoryPickerIpcPort` and request-id generation are injectable for deterministic tests.

## Model Experience

None, as this package serves GUI directory selection; nothing reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The Electron parent is required** — loading the provider under a standalone web host fails because no owner exists for the native dialog request.
