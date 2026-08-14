# @deepseek-ai/dsh-client-directory-picker-flows

English | [中文](README.zh.md)

Shared directory-picker presentation library. It owns the renderless native flow, the in-app directory browser, that browser's locale dictionaries, and the two installer functions that transactionally fill ui-workspace's directory-flow slots. The native, browse, and Electron directory-picker plugins inline this package into their own client bundles; this package has no `dsh.client` declaration, Cordis service, module-table entry, or shared runtime identity.

`installNativeDirectoryFlow(ctx)` binds `ctx.workspaces.pickDirectory()`. `installBrowseDirectoryFlow(ctx)` binds directory listing and creation plus the `directory-browser` locale namespace. Both installers register the conversation and sidebar slots as one nested `slots.inject()` effect, so declaration replacement and plugin disposal remove the pair together.

## Model Experience

None, as this browser presentation library registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Inline-only browser library** — a client plugin must call exactly one installer and let the shared client bundler inline this package; mounting it as a Loader row provides no UI.
