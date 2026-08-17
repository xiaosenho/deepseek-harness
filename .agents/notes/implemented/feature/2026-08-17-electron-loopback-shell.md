# Agent Note: Electron desktop shell reuses loopback `dsh web`

Status: implemented

English | [中文](2026-08-17-electron-loopback-shell.zh.md)

## Problem

A desktop delivery needs a native window without forking the Web server, API, session, storage, or plugin runtime into Electron. Plugin subprocesses also need a usable Node and pnpm even when the user has not installed either tool.

## Decision

The Electron main process starts the packaged `dsh web --host 127.0.0.1 --port 0` command, waits for its strict loopback readiness line, and loads that URL in a hardened `BrowserWindow`. Electron owns only the shell: single-instance coordination, external-link navigation through the system browser, native menus, and complete process-tree teardown before quit.

A generated `runtime-bin` directory holds `node` and `pnpm` shims that execute the packaged Electron binary in Node mode. The shim directory is prepended to `PATH` for the background WebUI process, so plugin subprocesses inherit working commands without a separate installation. On macOS the shell also prepends existing user tool directories such as `/opt/homebrew/bin`, because Finder-launched processes do not inherit a login shell `PATH`. Electron 43 embeds Node v24.18.1, which satisfies the repository engine range.

electron-builder copies the selected workspace packages plus their external dependency closure into `app/node_modules`. Conflicting dependency versions are nested under the workspace package that requires them; unique versions are placed once at the top level.

The native menu keeps a Chinese update action. The updater selects the newest PocketBase `app_releases` record for the host platform, validates its trusted HTTPS artifact URL, then feeds the matching generic release directory to `electron-updater`. The artifact suffix is platform-specific: ZIP for macOS, NSIS `.exe` for Windows, and AppImage for Linux.

## Alternatives considered

**Start a browser tab with `dsh web`.** This avoids Electron but does not provide the required single-instance desktop lifecycle or native menu surface.

**Duplicate the Web profile inside Electron.** This would move server, session, storage, and plugin behavior into the shell and violate the plugin-first ownership boundary.

**Require users to install Node and pnpm.** This makes plugin execution depend on host setup and fails the bundled-runtime requirement.

**Publish the DMG as the auto-update artifact.** `electron-updater` on macOS consumes the generic feed ZIP, so a DMG `file_url` cannot pass the verified metadata check.

## Consequences

The module ships as a private Electron workspace package with unit tests and a packaging smoke path. Automatic updates cover macOS ZIP, Windows NSIS, and Linux AppImage; the Linux deb target remains package-manager managed. LAN/FRP remote access, DOCX resume export, and other business features remain outside the module.
