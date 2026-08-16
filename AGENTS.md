# AGENTS.md

DeepSeek Harness Desktop is an Electron shell over the DeepSeek Harness Web kernel. The shell lives in `electron/` and is this repository's own code; the Web kernel lives in the `deepseek-harness-web/` git submodule, pinned to an upstream commit of `deepseek-ai/deepseek-harness` and consumed read-only. Read [electron/README.md](electron/README.md) before changing the shell.

## Repository layout

```
electron/               Desktop shell (this project's own code)
  src/                  main process, backend process ownership, auto-update
  tests/                shell unit tests
  resources/            cordis --patch overlays (network policy, desktop plugins)
  vendor/               fork-only Web packages shipped with the shell
    agent-presets/      resume agent preset (composition + skills)
  scripts/              shell generators (third-party notices)
  .agents/notes/        shell Agent Notes (electron decisions)
deepseek-harness-web/   Web kernel — git submodule, pinned upstream snapshot
```

## Commands

```sh
pnpm install            # workspace install (shell + vendor + web kernel packages)
pnpm run test           # shell unit tests (vitest run electron)
pnpm run build          # build the web kernel, then the electron shell
pnpm run dev:electron   # run the shell against the repository root
pnpm run pack:electron  # unpacked package for the current platform
pnpm run dist:electron:mac|win|linux  # signed-ready installer
pnpm run web-kernel:update   # bump the submodule pointer to upstream master
```

Web-kernel gates (typecheck, tests, coverage, doc-sync) run inside the submodule:

```sh
cd deepseek-harness-web && pnpm run test
cd deepseek-harness-web && pnpm run check:ci
```

## Conventions

- **Commit by feature point.** One commit per functional change, each carrying its implementation, tests, docs, and Agent Note; keep unrelated work out of that commit. Every AI-driven change or requirement write lands as its own feature-point commit.
- **The shell is a host, not a reimplementation.** Electron owns the window, the background WebUI process tree, and the update loop. It never reproduces the Web server, API, session, storage, or plugin runtime; it depends on `dsh web` through the CLI contract (args, readiness line, origin) only.
- **The Web kernel is read-only.** Never edit `deepseek-harness-web/` sources in this repository. Platform-specific behavior goes in the shell (a `--patch` overlay or shell-side code), not in kernel files. Sync upstream through `pnpm run web-kernel:update`; keep the shell's three CLI-contract tests green across bumps.
- **New features are harness plugins, not shell one-offs.** Prefer the kernel's plugin architecture for any model-visible or capability-shaped behavior: ship it as a Cordis plugin (a Service Definition / Provider / Consumer seam where one exists), keep the code in `electron/vendor/` when upstream does not own it, and mount it through the shell's `--patch` overlays. The shell stays a host — window, process tree, native dialogs, and the update loop only. A feature that needs a kernel change is upstreamed or adapted at the vendor layer; it is never written into `deepseek-harness-web/`.
- **Upstream compatibility is a hard invariant.** New code must survive an upstream bump unchanged: depend only on upstream workspace packages and their public contracts, never on fork-only kernel APIs; keep kernel coupling to the CLI contract and overlay rows. A patch whose target row disappears in a bump degrades to the Loader warning, not a hard failure. Keep `pnpm run web-kernel:update` and the shell tests green after every dependency change.
- **Agent Notes** for shell decisions live in `electron/.agents/notes/`; kernel decisions keep living in the submodule's own tree. Non-trivial shell changes include an Agent Note in the same commit.
- **Third-party notices** cover the shell's packaged dependency closure; regenerate `THIRD_PARTY_NOTICES.md` when the shell dependency tree changes (`pnpm --filter @deepseek-ai/dsh-electron run gen:notices`).

## Web-kernel fork features (接入方案)

Fork-only Web features that upstream does not ship (the DOCX resume tool, the resume agent preset, and the desktop-UI packages) keep working through three layers:

1. **Code — `electron/vendor/`.** Fork-only packages live here as root-workspace members. The root pnpm workspace mounts `electron/*`, `electron/vendor/*`, and `deepseek-harness-web/packages/*/*` (plus the submodule's `apps/*`, `website`, `examples`) as one store, so the Web-kernel process resolves vendor packages through `workspace:^` exactly like upstream packages.
2. **Mount — overlay patches.** `electron/resources/*.cordis.patch.yml` compose fork features into the Web profile at launch (`dsh web --patch <overlay>`). Patches mount new plugins through `insert` entries (`- insert: [{ id: tool-docx, name: '@deepseek-ai/dsh-tool-docx' }]`) and override config rows by id. The resume preset's composition rides the same mechanism.
3. **Contract — the update seam.** An upstream bump touches only the submodule pointer, `workspace:^` re-linking, and overlay rows. A patch whose target row is absent warns and is skipped, so a vanished plugin id degrades to a warning, not a hard failure. Vendor packages depend only on upstream workspace packages; when upstream refactors an API, adapt in the shell or vendor package, never in the submodule.

## Editing these instructions

Keep each rule self-contained while linking high-level docs. This file is short by design: the Web kernel's own conventions live in [deepseek-harness-web/AGENTS.md](deepseek-harness-web/AGENTS.md).
