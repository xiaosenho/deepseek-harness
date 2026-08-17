# `@deepseek-ai/dsh-electron`

English | [中文](README.zh.md)

Minimal Electron desktop shell for DeepSeek Harness. It starts the packaged `dsh web` command in a hidden background process, waits for the loopback readiness line, and loads that URL in a secure native window. Electron owns only the shell: the Web server, API, session, storage, and plugin runtime remain the normal `dsh` process.

The shell enforces a single instance, opens external links in the system browser, and shuts down the complete owned process tree before quitting.

## Bundled runtime

The packaged app contains the full `dsh` runtime closure and the `pnpm` CLI. On first start it writes `node` and `pnpm` shims under `<userData>/runtime-bin`, then prepends that directory to `PATH` for the background `dsh web` process and its plugin subprocesses. The shims run the packaged Electron executable in Node mode, so plugin code can use `node --version` and `pnpm --version` without a separate installation.

Electron 43's embedded Node is v24.18.1, which satisfies the repository engine range `^22.19.0 || >=24.0.0`. On macOS the shell also adds common user tool directories such as `/opt/homebrew/bin` to the WebUI `PATH`, so tools installed for the login shell remain available to plugin subprocesses launched from Finder.

## Development and verification

```sh
pnpm install
pnpm --filter @deepseek-ai/dsh-electron run build
pnpm --filter @deepseek-ai/dsh-electron run test
pnpm --filter @deepseek-ai/dsh-electron run pack
pnpm --filter @deepseek-ai/dsh-electron run dev
```

`DSH_ELECTRON_CWD` selects the initial working directory. `DSH_ELECTRON_URL` can point the window at an already-running WebUI instead of starting one.

## Updates

The native menu keeps a Chinese `检查更新...` action. It queries the PocketBase `app_releases` collection for the newest record matching the host platform, then hands the verified generic feed directory to `electron-updater`.

The PocketBase release record must provide:

- `platform`: `macos`, `windows`, or `linux`
- `version`: an exact version matching the application and the platform feed
- `version_code`: a non-negative integer used as the descending sort key
- `changelog`: a string
- `is_force`: a boolean
- `file_url`: an HTTPS URL under the trusted artifact root whose suffix matches the platform update artifact

The platform feeds and artifacts are:

- macOS: `latest-mac.yml` plus the ZIP it names; the `.zip.blockmap` is used for differential downloads when present, and the DMG is only the install artifact
- Windows: `latest.yml` plus the NSIS `.exe` it names
- Linux: `latest-linux.yml` plus the AppImage it names; the `deb` target is installed through the package manager and is not auto-updated

Set `DSH_ELECTRON_OTA_URL` to override the PocketBase origin for testing.

This module does not include LAN/FRP remote access, DOCX resume export, or other business features.
