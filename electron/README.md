# `@deepseek-ai/dsh-electron`

English | [中文](README.zh.md)

The self-contained Electron desktop application for DeepSeek Harness. It packages the built `dsh` CLI, Web frontend, and production dependency tree. At startup the Electron runtime launches its packaged CLI in a hidden background process, starts the WebUI on loopback with an operating-system-assigned port, waits for the existing `dsh web:` readiness line, and loads that URL in a native window. Electron does not reproduce the Web server, API, session, storage, or plugin runtime.

## Development

From the repository root:

```sh
pnpm run dev:electron
```

The command builds the pinned Web kernel, desktop vendor packages, and Electron shell before opening the window. A fresh checkout therefore needs no separate build command.

Source development uses the repository root as the Web profile's working directory. A packaged application uses the current user's home directory by default. Set `DSH_ELECTRON_CWD` to choose another initial working directory.

Set `DSH_ELECTRON_URL` to an HTTP or HTTPS URL to skip the background command and connect the window to an already-running WebUI. This mode omits the Electron-only Settings contributions and the **Remote Access** application-menu section entirely; Electron creates no remote-access controller, preload bridge, or credential, and the external WebUI owns its network and authentication policy.

Public FRP access uses an external `frpc` executable. The first run resolves `frpc` through Electron's inherited `PATH` unless `DSH_ELECTRON_FRPC_PATH` supplies a command name or absolute path; after remote-access preferences have been saved, the executable field in Settings is authoritative. LAN access does not require `frpc`.

## Bundled runtime

The packaged app creates `node` and `pnpm` shims under `<userData>/runtime-bin` and prepends that directory to the background WebUI process `PATH`. Both shims run the packaged Electron executable in Node mode, so plugin subprocesses do not depend on a separate Node.js or pnpm installation. On macOS the shell also adds existing common user tool directories, including Homebrew locations that Finder-launched applications do not normally inherit.

## dsh Command Line

Choose **Install dsh Command Line...** from the native application menu to create `~/bin/dsh` as a shim into the bundled CLI. On macOS the installer adds `$HOME/bin` to `.zshrc` and `.bash_profile`; on Linux it updates `.bashrc` and `.profile`. Existing PATH entries are not duplicated, and running the installer again refreshes the shim. Open a new terminal after installation. Windows currently reports this operation as unsupported instead of changing the user's PATH.

## About and Web-kernel updates

The **About** surface (native panel plus the **Software information** card in Settings) shows the installed shell version and the Web-kernel commit pinned at build time (recorded in `resources/version.json` by `pnpm --filter @deepseek-ai/dsh-electron run build`). The card's **Check for kernel updates** action compares that pin against upstream `deepseek-ai/deepseek-harness` master through the GitHub API and reports current / update-available / failed; a failure never blocks startup. The update itself is a development action: `pnpm run web-kernel:update` fetches upstream, bumps the submodule pointer, rebuilds the kernel, and runs the shell tests.

## Automatic Updates

An installed macOS application checks `https://ota.xiaosenho.top/api/collections/app_releases/records` after its first window is ready. The query selects the `macos` record with the greatest `version_code`; Electron still uses the record's SemVer `version` to decide whether it is newer than the installed application. Source runs never check for updates. Windows and Linux packaged builds also skip OTA until their distribution paths enforce an authenticated signing policy. `DSH_ELECTRON_OTA_URL` replaces the PocketBase base URL for a packaged macOS application, including one using `DSH_ELECTRON_URL` for its WebUI, but it does not change the trusted artifact root.

The native **About DeepSeek Harness** panel displays the installed version. Choose **Check for Updates...** from the native application menu to run the same operation on demand; an active startup check and a manual check share one operation, and a downloaded update is not downloaded again. A newer startup release prompts with its version and changelog. Optional downloads use a non-modal progress window, while forced downloads use a modal progress window until the orderly restart begins. The Electron-managed local window also shows the version, update state, release notes, check action, and prepared-install action in Settings, plus an update badge beside the product mark. These renderer controls call a narrow preload bridge, while release selection, download, process shutdown, and installation remain in Electron main. An external WebUI receives none of these controls.

PocketBase selects the release, while Electron Builder metadata describes and checks the download. The record's credential-free HTTPS `file_url` must stay under the pinned `https://application-1305333896.cos.ap-guangzhou.myqcloud.com/` artifact root and identify a macOS DMG. Its directory must also contain the matching `latest-mac.yml` plus every file named there. Electron Builder's automatic prerelease channel detection is disabled because PocketBase already selects the exact release. The metadata version must equal the PocketBase `version`, must include the exact `file_url` artifact, and must provide a canonical SHA-512 checksum for every candidate file; every candidate must remain in that HTTPS directory. The updater rejects the release before downloading when any of these checks fail.

Upload the complete Electron Builder output to the artifact directory before creating or updating the `app_releases` record. A macOS release includes the DMG shown to users, the ZIP consumed by Squirrel.Mac, `latest-mac.yml`, and generated blockmaps. Publishing the PocketBase record last prevents a client from selecting a partially uploaded release.

The update check never delays window startup. Network, record-validation, metadata, and download failures are logged and leave the running application unchanged. A macOS application launched from a read-only volume such as a mounted DMG reports that it must be moved into Applications; an unsigned macOS build reports that Squirrel.Mac cannot replace it. An optional release downloads in the background and installs during the next ordinary application exit; the next launch runs the new version. A record with `is_force: true` instead stops and joins the current WebUI process tree as soon as the download is ready, then runs the installer and relaunches Electron. Repeated quit requests remain blocked while that process tree is stopping, and a shutdown failure leaves the application running without invoking the installer.

The ESM main process loads the CommonJS `electron-updater` package only after it selects a newer macOS release and reads `autoUpdater` from the package's default export object. Source runs, unsupported platforms, and checks without a newer release do not load the updater dependency.

PocketBase write access is release-selection authority, and COS write access is executable-publication authority; restrict both to release operators. The pinned COS root prevents a PocketBase record from redirecting clients to an arbitrary download host. SHA-512 detects a damaged or mismatched artifact but does not replace platform code signing because the artifact and metadata share one publication authority. Public macOS automatic updates require Developer ID signing and notarization. Enabling Windows later requires a signing certificate and Electron Builder `publisherName`; enabling Linux requires an independently authenticated package-publication policy. The unsigned macOS procedure below remains suitable only for manual test installation, not an automatic-update acceptance result.

## Remote Access

Remote access is off at every Electron startup, while the preferred LAN or FRP transport and its non-runtime settings persist. In the Electron-managed local window, open **Settings > Remote Access** to choose the transport, save FRP settings while access is off, and enable or disable access after an explicit confirmation. The native **Remote Access** application-menu section remains available under **DeepSeek Harness** on macOS and **Help** on Windows and Linux. Starting or stopping access replaces the current WebUI process, waits for the requested exposure to become ready, and loads the replacement process's new loopback URL so the local window reconnects without a manual reload.

If the requested exposure cannot start, Electron attempts to restore the previous mode on a new port, loads that recovery origin when it succeeds, and reports that the requested mode did not take effect. If the current processes cannot be stopped safely, the previous mode cannot be restored, or the window cannot load a ready replacement origin, Electron displays a fatal native error and requests application exit after acknowledgement. Its exit barrier permits exit only after the owned WebUI and `frpc` process trees have stopped; failed cleanup leaves exit blocked so a later quit request can retry. On Windows, a failed `taskkill /T /F` remains an unresolved cleanup result; an exited leader alone does not prove that its descendants stopped.

Each successful enable creates a new 72-bit public Harness access token and a complete URL containing `#dsh-access=TOKEN`. FRP mode also creates a different main-only loopback token; Electron installs it as an `HttpOnly` `/api` session cookie before loading the local window, so a tunnel request that forges a loopback Host cannot use either the loopback exemption or the public token. Settings displays only the credential-free public endpoint; **Copy complete URL** asks Electron main to write the public bearer URL to the operating-system clipboard without returning either token to the renderer. The native details dialog and menu provide the same main-owned copy operation. The complete URL never enters the renderer state, native window title, or menu label, and the optional persistent `frps` authentication token is represented to the renderer only as a configured/not-configured flag.

The remote browser expires any legacy `dsh_remote_access` cookie at `Path=/`, stores the fragment token in a `SameSite=Strict` session cookie at `Path=/api`, adds `Secure` when the public origin is HTTPS, and tries to record a token-free per-origin marker before booting the formal WebUI. It then removes the token through a same-origin replacement navigation, or through `history.replaceState` when session storage is unavailable. The URL fragment is absent from the initial HTTP request, and the marker is not a credential. Cookies are not isolated by port: another `/api` service on another port of the same IP literal or hostname may receive the bearer, so every such service belongs to the credential's deployment trust scope.

Use the complete token-bearing URL. A bare public endpoint may load the static shell, but its API and WebSocket requests receive 403 unless that browser already holds the current token cookie. A valid token grants the remote browser the same programmable Harness Host access as the loopback desktop window except for the desktop-native directory chooser; it still includes sessions, settings, credentials, Host path opening, model discovery, agent-preset authoring, and agent tools. Uploads read files selected in the remote browser, while workspace paths and the in-app directory browser refer to the desktop Host filesystem.

Disabling access stops the public transport before stopping its WebUI backend, then starts a loopback-only replacement and removes the main-owned local cookie before navigation. That ordering invalidates the URL and both credentials before the application reports remote access off. Re-enabling creates another token set and URL, and restarting Electron also invalidates the previous credentials. An unexpected `frpc` exit disables remote access and restores loopback mode; if that recovery fails, Electron follows the fatal shutdown path above.

### LAN

LAN mode binds the authenticated WebUI to all interfaces on an operating-system-assigned port and derives the displayed URL from the first external IPv4 address. The remote device must share the intended trusted LAN, and the operating-system firewall must allow DeepSeek Harness on that trusted or private network profile. A multihomed host may display an address outside the device's LAN; Electron provides no interface selector or IPv6 address.

### Public FRP

FRP mode is available on macOS and Linux. It keeps the WebUI bound to `127.0.0.1` and starts one system-provided `frpc` TCP proxy to the operator's `frps` server. Windows retains saved FRP settings but rejects enablement before stopping the active loopback WebUI because Electron does not yet own both Windows process trees through durable Job Objects. Install a compatible `frpc` and make it available through the configured executable path or Electron's inherited `PATH`; the application does not bundle or download it. The binary must support JSON configuration, the authenticated loopback status API, TCP proxy encryption, and automatic remote-port reporting used by this client.

The Settings form accepts a bare public server IP address or DNS hostname, the `frps` control port (default `7000`), a fixed public TCP port or `0` for server assignment, an optional HTTP or HTTPS public origin, the `frpc` executable, the required trusted CA file that issued the `frps` TLS certificate, an optional certificate server name, and an optional `frps` authentication token. The executable and CA paths are read-only selections from native file dialogs owned by Electron main; cancelling a dialog preserves the current draft. The certificate must cover the configured server name, or the server address when that field is blank. A fixed public port must be allowed by `frps` and reachable through the server firewall. A separate public origin requires a fixed public port because Electron cannot derive the externally visible port from an automatic assignment.

With no public origin, Electron derives `http://SERVER:ACTUAL_PORT` after `frps` assigns or confirms the proxy port. Setting `publicOrigin` changes the advertised and trusted browser origin; it does not install a certificate or terminate TLS. Configure an `https://` origin only when a real HTTPS terminator for that exact authority forwards to the selected FRP port. A blank or `http://` origin requires the explicit plaintext acknowledgement in Settings.

For each enable, Electron writes an owner-only temporary `frpc.json`, starts `frpc -c` with no secret in argv and a scrubbed environment, and removes the directory after stop or exit. The configuration authenticates the `frps` TLS certificate with the configured CA and server name, enables encrypted TCP proxy transport, assigns a random proxy name, and binds an authenticated status server to loopback. The FRP WebUI requires the main-only local token even when a request presents a loopback Host, because the TCP proxy makes public clients appear to the backend as loopback peers. Electron reports the tunnel ready only when `/api/status` reports that exact TCP proxy as `running` and supplies its public address; a successful server login, a matching log line, or a live process is not sufficient. Publication failure, authentication failure, a conflicting or disallowed public port, an unusable status response, or a 20-second readiness timeout fails the enable operation and enters the rollback behavior above. Explicit stop and unexpected leader exit both join the complete `frpc` process tree before releasing its private configuration.

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

Outputs land under `dist/electron/`. Both platforms use the DeepSeek Harness product icon. The Windows installer provides an installation-directory step plus desktop and Start menu shortcuts. The installed application does not require a Harness checkout, Node.js, or pnpm on the target machine; public FRP mode separately requires the system-provided `frpc` described above. It carries the Sharp/libvips notice and complete LGPL/GPL texts under `resources/legal/`; a release operator must verify the pinned source links and update those materials whenever the Sharp platform package or component versions change. The [Sharp Windows distribution decision](../../.agents/notes/implemented/process/2026-08-14-electron-sharp-lgpl-distribution.md) records the exact authorization. Signing, macOS notarization, and publishing remain release work.

### Unsigned macOS test builds

The macOS DMG is an ARM64 test build until release signing and notarization are configured. After copying `DeepSeek Harness.app` from the DMG into `/Applications`, a recipient who trusts the package can remove its download quarantine, apply a local ad-hoc signature, and launch it:

```sh
uname -m
sudo xattr -cr "/Applications/DeepSeek Harness.app"
sudo codesign --force --deep --sign - "/Applications/DeepSeek Harness.app"
open "/Applications/DeepSeek Harness.app"
```

`uname -m` must print `arm64`; this build does not run on Intel Macs. These commands bypass Gatekeeper's downloaded-app protection for this local copy and must only be used for a package whose source and checksum the recipient trusts. They do not replace Developer ID signing and Apple notarization for public distribution.

The desktop window opens the operating system's native directory chooser through Electron main. The Web-host child sends a correlated request over its private parent-process IPC channel; Electron launches a dedicated helper process for the dialog so caller cancellation and application shutdown can terminate the chooser as well as release the request. On Windows this path avoids the Koffi/COM worker that is incompatible with the packaged Electron Node runtime. On every supported platform, the managed loopback renderer uses the native interaction while authenticated LAN and FRP browsers use the in-app Host-filesystem browser; remote callers never invoke the loopback-only `host.pickDirectory` method.

Cross-building the Windows installer on Apple Silicon requires Rosetta 2 because electron-builder's bundled NSIS compiler is an x86_64 macOS executable. The workspace installs the Windows x64 optional native dependencies needed by the packaged Harness runtime.

## Process And Security Model

The Electron main process owns the window, one background WebUI process tree, and an optional `frpc` process tree. The WebUI child uses the packaged Electron executable in Node mode to run the packaged CLI on an operating-system-assigned port. Loopback and FRP modes keep that child on loopback; LAN mode applies the Electron-specific all-interfaces overlay. FRP adds a public-token authority and a separately token-protected local authority to the loopback child, then publishes it through `frpc`. After each replacement becomes ready, Electron prepares the local cookie and the window loads its new loopback URL. Application shutdown uses bounded tree termination; a cleanup operation that cannot prove its operating-system primitive succeeded remains owned and blocks exit. The general `dsh web --host 0.0.0.0` command remains unsupported.

Ordinary loopback mode and the local side of LAN mode do not require an Electron access token. An enabled remote-access process requires its current public token for non-loopback `/api` HTTP, RPC, and WebSocket traffic. FRP additionally requires a separate local token for loopback authorities; Electron main installs that token as an `HttpOnly` cookie for the managed window, while raw tunnel requests cannot derive it from the public URL. A valid public token grants its trusted authority the same Host access as ordinary loopback except for explicitly loopback-only methods such as `host.pickDirectory`; token-eligible access still includes settings, credentials, Host path opening, agent-preset authoring, `llm.discoverModels`, and registered loopback-authority RPC. A configured `trustedHosts` entry without a valid token remains a DNS-rebinding defense and grants no additional privilege.

The LAN listener and an FRP endpoint derived without an external HTTPS origin use plain HTTP. The trusted CA authenticates the `frps` control endpoint to `frpc`, and proxy encryption protects the client-to-server FRP hop; neither protects the browser-to-public-endpoint HTTP request or installs browser-trusted authentication there. The Harness token is a bearer secret equivalent to control of the Host: anyone who sees the complete URL, reads the desktop clipboard after a copy, captures the cookie in transit, or operates another same-host `/api` service that receives it can operate the agent, read or change exposed configuration and credentials, and invoke Host tools under the desktop user's operating-system account. A copied URL may remain in the operating-system or synchronized clipboard after access is disabled or Electron exits; replace it after use. Disabling access or restarting Electron invalidates the URL but does not clear the clipboard. Use LAN mode only on a trusted network with client isolation from untrusted peers. Public FRP operation needs browser-validated HTTPS termination for confidentiality and browser-facing server authentication; the plaintext acknowledgement records acceptance of the risk but does not mitigate it. The [Electron token Host authority decision](../../.agents/notes/implemented/feature/2026-08-14-electron-token-host-authority.md) records this privilege rule.

The renderer has Node integration disabled, context isolation and Chromium sandboxing enabled, and no WebView capability. The Electron-managed local renderer receives one narrow preload bridge for redacted desktop state and explicit remote-access, clipboard, and updater commands. Main authorizes each IPC invocation against the current window, main frame, and current loopback origin. The bridge never returns either Harness bearer or the stored `frps` token; it returns only the credential-free endpoint and whether an authentication token is configured, while a copy command writes the complete public URL in Electron main. The local bearer is an `HttpOnly` cookie, not bridge state or renderer-readable JavaScript state. Ordinary WebUI deployments, remote browsers, and `DSH_ELECTRON_URL` mode receive no bridge or Electron-specific controls. Directory-picker IPC exists only between the Electron-owned Web-host child and main process; it is not exposed to browser plugins. The app window accepts navigation only within the exact current WebUI origin. HTTP and HTTPS links for other origins open in the operating-system browser; other schemes are rejected.

Electron Chromium data uses a dedicated `DeepSeek Harness` application-data directory. Remote-access preferences use an owner-only versioned JSON file there; Electron encrypts the optional stored `frps` token through the operating-system secret store and fails rather than persisting it in plaintext. The enabled state and per-enable public and local Harness bearers are never persisted. Harness sessions, settings, credentials, profiles, and workspace behavior remain owned by `dsh web`.

## Model Experience

The desktop window adds no model-visible input. The model receives the same Web-surface context and session log as `dsh web`.
