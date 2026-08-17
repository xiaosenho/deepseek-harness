# Agent Note: Cross-platform Source Startup

Status: implemented

## Problem

The documented source workflow ends with `pnpm run dev:electron`, but the command previously launched `electron .` without building the shell. A fresh checkout therefore failed because `electron/lib/main.js` did not exist. The build path also invoked `"$npm_execpath"`, which a POSIX shell expands but Windows `cmd.exe` treats as a literal executable name.

The Web kernel's root `postinstall` owns worktree-local hooks for its standalone repository. Running that installer inside the read-only submodule attempts to migrate the submodule's Git metadata and can fail on the standard `core.worktree` layout. The desktop host must not take ownership of the upstream repository's hooks.

## Decision

The root `dev:electron` command owns the complete source-start contract: it runs the existing root build before launching the Electron package. The build compiles the pinned Web kernel first and then the shell and vendor packages, matching the behavior documented by the root README.

`scripts/build-web-kernel.mjs` invokes the active pnpm CLI through Node instead of relying on shell-specific environment-variable expansion. It sets `CI=true` only for the Web-kernel install, which makes the upstream repository hook installer a no-op while package lifecycle scripts still run. The Web-kernel build itself runs with the caller's ordinary environment. The Electron package invokes `pnpm` directly for its root-workspace filtered builds; npm-compatible script runners expose that executable on `PATH` on Windows and POSIX systems.

A repository-script contract test verifies that source startup remains build-first, nested builds use the cross-platform entry points, and the submodule install retains its hook-isolation boundary.

## Consequences

The first `pnpm run dev:electron` after a recursive clone and install takes longer because it produces all required source artifacts before opening the window. Later runs also rebuild, favoring deterministic startup over stale or absent output; the project does not currently provide a watch-mode main-process compiler.

The parent repository continues to install its own hooks normally. The nested Web-kernel install does not modify submodule Git hooks, while the pinned upstream build and package lifecycle remain intact. Packaging continues through the same root build and gains the same Windows compatibility.
