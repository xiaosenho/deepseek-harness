# @deepseek-ai/dsh-client-ui-directory-picker-electron

English | [中文](README.zh.md)

Electron directory-picker surface for a Host that serves both its local window and authenticated LAN browsers. It reads the page-stable `ctx.connection.isLoopback` value once during plugin activation: loopback pages install the operating-system chooser flow, while non-loopback pages install the in-app directory browser. Exactly one flow transaction fills both ui-workspace single slots, so the two implementations never compete for the same slot.

The native branch drives `ctx.workspaces.pickDirectory()` and therefore opens the chooser owned by Electron main. The remote branch drives `ctx.workspaces.listDirectory()` and `ctx.workspaces.createDirectory()` without exposing Electron or Node APIs to the browser. The shared presentation and locale dictionaries live in [`dsh-client-directory-picker-flows`](../directory-picker-flows/README.md).

## Model Experience

None, as this browser-side Electron directory-picker surface registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Dual Host capability required** — the composed Host must serve native picking to loopback callers and directory listing and creation to authorized remote callers; a missing selected operation surfaces through the existing retryable workspace dialog.
