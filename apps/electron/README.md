# `@deepseek-ai/dsh-electron`

English | [中文](README.zh.md)

The self-contained Electron desktop application for DeepSeek Harness. It packages the built `dsh` CLI, Web frontend, and production dependency tree. At startup the Electron runtime launches its packaged CLI as `dsh web --host 127.0.0.1 --port 0` in a hidden background process, waits for the existing `dsh web:` readiness line, and loads that unchanged WebUI in a native window. Electron does not reproduce the Web server, API, session, storage, or plugin runtime.

## Development

From the repository root:

```sh
pnpm run dev:electron
```

Source development uses the repository root as the Web profile's working directory. A packaged application uses the current user's home directory by default. Set `DSH_ELECTRON_CWD` to choose another initial working directory.

Set `DSH_ELECTRON_URL` to an HTTP or HTTPS URL to skip the background command and connect the window to an already-running WebUI.

## Packaging

Build an unpacked application for the current platform:

```sh
pnpm run pack:electron
```

Build the macOS ARM64 DMG installer:

```sh
pnpm run dist:electron:mac
```

Build the Windows x64 NSIS installer:

```sh
pnpm run dist:electron:win
```

Outputs land under `dist/electron/`. Both platforms use the DeepSeek Harness product icon. The Windows installer provides an installation-directory step plus desktop and Start menu shortcuts. The installed application does not require a Harness checkout, Node.js, or pnpm on the target machine. Signing, macOS notarization, and publishing remain release work.

The Windows desktop application uses the in-app directory browser. The native Win32 picker depends on a Koffi/COM worker that is not compatible with the packaged Electron Node runtime. macOS and Linux retain the Web profile's adaptive native picker.

Cross-building the Windows installer on Apple Silicon requires Rosetta 2 because electron-builder's bundled NSIS compiler is an x86_64 macOS executable. The workspace installs the Windows x64 optional native dependencies needed by the packaged Harness runtime.

## Process And Security Model

The Electron main process owns the window and the background WebUI process tree. The child uses the packaged Electron executable in Node mode to run the packaged CLI on an operating-system-assigned loopback port. The window loads only the URL from the profile's readiness output. Application shutdown terminates and joins the complete process tree with bounded escalation.

The renderer has Node integration disabled, context isolation and Chromium sandboxing enabled, no preload bridge, and no WebView capability. The app window accepts navigation only within the exact WebUI origin. HTTP and HTTPS links for other origins open in the operating system browser; other schemes are rejected.

Electron Chromium data uses a dedicated `DeepSeek Harness` application-data directory. Harness sessions, settings, credentials, profiles, and workspace behavior remain owned by `dsh web`.

## Model Experience

The desktop window adds no model-visible input. The model receives the same Web-surface context and session log as `dsh web`.
