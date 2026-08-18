# Agent Note: Electron exposes a bundled command runtime

Status: implemented

English | [中文](2026-08-17-electron-loopback-shell.zh.md)

## Problem

The desktop shell already owns the packaged WebUI process tree, but plugin subprocesses need usable `node` and `pnpm` commands on machines without a development checkout. Users also need an optional terminal `dsh` entry point without duplicating the CLI inside Electron.

## Decision

Electron remains a host for the existing `dsh web` profile. It continues to start the packaged CLI through the established arguments, readiness line, origin, and overlay contracts; no server, session, storage, or plugin runtime is reimplemented in the shell.

At application startup, Electron writes `node` and `pnpm` shims under the writable `runtime-bin` directory in application data. The shims execute the packaged Electron binary in Node mode, and the shell prepends their directory to the owned WebUI environment. Existing common macOS tool directories are also prepended when present because Finder applications do not inherit a login-shell PATH.

The native application menu offers **Install dsh Command Line...**. On macOS and Linux it writes `~/bin/dsh`, points that shim at the packaged CLI, and adds `$HOME/bin` to the relevant shell startup files exactly once. Windows reports the operation as unsupported until the product owns a user-PATH installation policy.

The existing macOS PocketBase updater keeps its trust and signing policy. A startup check can prompt with the selected version and changelog. Optional downloads use a non-modal progress window; forced downloads use a modal window and then follow the existing exit barrier before installer launch. A mounted DMG reports a read-only-volume result, and an unsigned macOS bundle reports that Squirrel.Mac cannot replace it. Windows and Linux OTA remain disabled until their authenticated signing and publication policies are implemented.

## Alternatives considered

**Require host Node.js and pnpm.** Rejected because a packaged desktop application must keep its plugin subprocess runtime self-contained.

**Copy the CLI into Electron.** Rejected because the shell depends on the packaged upstream workspace package and its public CLI contract.

**Enable every platform updater from artifact suffix alone.** Rejected because installer metadata does not replace the repository's platform signing and publication decisions.

## Consequences

Packaged plugin subprocesses inherit working `node` and `pnpm` commands, and POSIX users can opt into a terminal `dsh` shim. The shell gains native presentation for update progress without moving release selection or installation authority into the renderer. Remote access, desktop plugins, and the pinned Web kernel continue to use their existing shell and vendor boundaries.
