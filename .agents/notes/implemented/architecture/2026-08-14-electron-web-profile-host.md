# Agent Note: Electron wraps the existing WebUI

Status: implemented

English | [中文](2026-08-14-electron-web-profile-host.zh.md)

## Problem

DeepSeek Harness has a browser application and a `dsh web` composition but no native desktop window. A desktop wrapper must reuse that application without creating a second client composition, transport, storage implementation, or privileged renderer runtime.

## Decision

`apps/electron` is a product host over the published `@deepseek-ai/dsh` dependency closure. Its main process starts the packaged CLI with `web --host 127.0.0.1 --port 0` in a hidden detached process tree, waits for the existing loopback readiness line, and loads that origin in `BrowserWindow`. Source runs use the repository root as the command working directory; packaged runs default to the user's home. `DSH_ELECTRON_CWD` selects another directory, and `DSH_ELECTRON_URL` deliberately bypasses process startup for an already-running HTTP or HTTPS WebUI.

The process is an ordinary operating-system child rather than an Electron utility process. It uses the packaged Electron executable with `ELECTRON_RUN_AS_NODE=1` and `--expose-internals`, so the CLI uses the packaged runtime and Electron-rebuilt native dependencies without requiring an external Node installation. Electron shutdown sends `SIGTERM` to the detached process group on POSIX, escalates to `SIGKILL` after a bounded grace period, and waits for group absence; Windows uses `taskkill /T /F` and waits for the child exit edge.

On Windows, the child also applies an Electron-owned profile overlay that replaces the adaptive directory picker with the complete browse interaction. The native Win32 picker runs its Koffi/COM dialog in a child of the host runtime; under the packaged Electron Node runtime that worker can terminate before sending its protocol result. The browse composition keeps directory selection inside the existing WebUI and avoids a native-module dependency in that child-of-child path. Other platforms retain the adaptive picker.

The renderer receives no Electron bridge. Node integration and WebView support are disabled; context isolation and Chromium sandboxing are enabled. Main-window navigation is restricted to the exact WebUI origin. Other HTTP and HTTPS origins open through the operating system, while non-Web schemes are rejected. The dedicated Chromium user-data directory prevents Electron storage and single-instance locks from colliding with unrelated Electron applications.

The Electron package is not a Cordis plugin and contributes no session event, prompt section, tool, API route, or client slot. Its production dependencies on `@deepseek-ai/dsh` and the CLI host's required `@deepseek-ai/cordis-plugin-group` peer make electron-builder include the CLI, Web frontend, bundles, plugins, and their runtime dependencies in the application. Those files remain an ordinary dependency tree under the application resources rather than an ASAR archive because profile module fallback creates real filesystem links to installed packages. The Web profile continues to own every host and browser plugin, workspace operation, credential read, setting, and durable session write.

## Alternatives considered

**Reimplement the Web transport in Electron.** Rejected because the Web application depends on HTTP routes, WebSocket streams, boot-manifest injection, and dynamic client bundles already provided by `dsh web`.

**Run the CLI inside an Electron utility process.** Rejected because its module-loader behavior and lifecycle are coupled to the main Electron instance. A separate Electron executable in Node mode supplies the same packaged ABI while preserving an independently terminable process tree.

**Expose Electron APIs through preload.** Rejected because the existing Web application needs no privileged renderer API. A bridge would grant unnecessary authority to dynamically loaded browser plugins.

**Require the user to start WebUI separately.** Retained as the explicit `DSH_ELECTRON_URL` mode, but not the default because the desktop application should open with one command.

## Consequences

The desktop application presents the same UI and model-visible context as `dsh web`. Development startup is one command, application shutdown stops the owned WebUI, and packaged applications require no external source tree, Node.js, or package manager. Distribution produces a product-icon-branded macOS ARM64 DMG and Windows x64 NSIS installer. Cross-packaging installs the Windows x64 optional native dependency variants and uses their prebuilt binaries instead of attempting node-gyp cross-compilation. Apple Silicon builders require Rosetta 2 for electron-builder's x86_64 NSIS compiler; release jobs still need signing and macOS notarization.
