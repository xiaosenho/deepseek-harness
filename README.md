# DeepSeek Harness Desktop

English | [中文](README.zh.md)

An Electron desktop application that packages the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI. The desktop shell starts the bundled `dsh web` in a hidden background process and loads the unchanged WebUI in a native window. Electron does not reproduce the Web server, API, session, storage, or plugin runtime.

## Repository layout

```
electron/               Desktop shell (this project's own code)
  src/                  main process, backend process ownership, auto-update
  tests/                shell unit tests
  vendor/               fork-only Web packages (desktop pickers, DOCX tool, resume preset)
deepseek-harness-web/   Web kernel — git submodule pinned to deepseek-ai/deepseek-harness
```

The desktop shell is the subject of this repository. The Web kernel is a pinned upstream snapshot consumed through the `workspace:` dependency protocol; see [electron/README.md](electron/README.md) for shell development and [deepseek-harness-web/README.md](deepseek-harness-web/README.md) for the kernel.

## Requirements

### Build and development environment

| Requirement | Version / value |
| --- | --- |
| Node.js | `^22.19.0` or `>=24.0.0` (inherited from the Web kernel) |
| pnpm | `11.7.0` (Corepack-pinned; `corepack enable` to activate) |
| Git | `>= 2.26` |

### Supported target platforms

| Target | Architecture | Installer |
| --- | --- | --- |
| macOS | `arm64` (Apple Silicon) | DMG |
| Windows | `x64` | NSIS (installation-directory step, desktop + Start menu shortcuts) |
| Linux | `x64` (electron-builder default) | AppImage / deb |

### Platform build notes

- The macOS build is **ARM64 only**; it does not run on Intel Macs.
- Cross-building the Windows installer **on Apple Silicon requires Rosetta 2** (electron-builder's bundled NSIS compiler is an x86_64 macOS executable).
- The workspace installs the Windows x64 optional native binaries needed by the packaged Harness runtime (`pnpm-workspace.yaml` `supportedArchitectures`).
- A packaged application requires **no Node.js, pnpm, or Harness checkout** on the target machine.

## Run

### From source

```sh
git clone --recurse-submodules <this repository>
pnpm install
pnpm run dev:electron
```

`pnpm run dev:electron` builds the pinned Web kernel and shell, then opens the desktop window against a `dsh web` started from the repository root. The first run can take several minutes; later builds reuse generated artifacts and pnpm's package store. Set `DSH_ELECTRON_CWD` to choose another initial working directory, or `DSH_ELECTRON_URL` to connect the window to an already-running WebUI.

### Desktop application

The self-contained Electron application starts the same Web UI and packages its local runtime for macOS and Windows. See [electron/README.md](electron/README.md) for development, auto-update, the About panel's upstream-update check, and platform limitations.

## Packaging

All packaging commands run from the repository root and build the Web kernel first (`build:web-kernel`), then package the shell.

### Unpacked application (current platform)

```sh
pnpm run pack:electron
```

Output: `dist/electron/<platform>-<arch>/`.

### Installers

```sh
pnpm run dist:electron:mac     # macOS ARM64 DMG
pnpm run dist:electron:win     # Windows x64 NSIS
pnpm run dist:electron:linux   # Linux AppImage + deb
```

Outputs land under `dist/electron/`. Both macOS and Windows use the DeepSeek Harness product icon. The Windows installer offers an installation-directory step plus desktop and Start menu shortcuts. Automatic updates (PocketBase OTA + electron-updater) are documented in [electron/README.md](electron/README.md).

## Syncing the Web kernel

The Web kernel is a git submodule pinned to upstream `deepseek-ai/deepseek-harness`. To pick up a newer upstream release:

```sh
pnpm run web-kernel:update    # fetch upstream, bump the pointer, verify the CLI contract
```

or manually:

```sh
cd deepseek-harness-web
git fetch origin
git checkout <tag-or-commit>
cd ..
git add deepseek-harness-web
git commit -m "chore(web): bump deepseek-harness-web to <tag>"
```

The shell's About panel shows the pinned kernel commit and can check upstream for a newer one. Fork-only features ride the shell's `electron/vendor/` + overlay patches, so an upstream bump never touches them (see AGENTS.md).

## License

[MIT](LICENSE)
