# `@deepseek-ai/dsh-electron`

English | [中文](README.zh.md)

The self-contained Electron desktop application for DeepSeek Harness. It packages the built `dsh` CLI, Web frontend, and production dependency tree. At startup the Electron runtime launches its packaged CLI in a hidden background process, starts the WebUI on loopback with an operating-system-assigned port, waits for the existing `dsh web:` readiness line, and loads that URL in a native window. Electron does not reproduce the Web server, API, session, storage, or plugin runtime.

## Development

From the repository root:

```sh
pnpm run dev:electron
```

Source development uses the repository root as the Web profile's working directory. A packaged application uses the current user's home directory by default. Set `DSH_ELECTRON_CWD` to choose another initial working directory.

Set `DSH_ELECTRON_URL` to an HTTP or HTTPS URL to skip the background command and connect the window to an already-running WebUI. This mode omits the **Remote Access** application-menu section entirely; Electron creates no remote-access controller or credential, and the external WebUI owns its network and authentication policy.

## Automatic Updates

An installed macOS application checks `https://ota.xiaosenho.top/api/collections/app_releases/records` after its first window is ready. The query selects the `macos` record with the greatest `version_code`; Electron still uses the record's SemVer `version` to decide whether it is newer than the installed application. Source runs never check for updates. Windows and Linux packaged builds also skip OTA until their distribution paths enforce an authenticated signing policy. `DSH_ELECTRON_OTA_URL` replaces the PocketBase base URL for a packaged macOS application, including one using `DSH_ELECTRON_URL` for its WebUI, but it does not change the trusted artifact root.

The native **About DeepSeek Harness** panel displays the installed version. Choose **Check for Updates...** from the native application menu to run the same operation on demand; an active startup check and a manual check share one operation, and a downloaded update is not downloaded again. Electron reports the result in a native dialog. Version and update commands stay in Electron main and are not exposed to the WebUI renderer.

PocketBase selects the release, while Electron Builder metadata describes and checks the download. The record's credential-free HTTPS `file_url` must stay under the pinned `https://application-1305333896.cos.ap-guangzhou.myqcloud.com/` artifact root and identify a macOS DMG. Its directory must also contain the matching `latest-mac.yml` plus every file named there. Electron Builder's automatic prerelease channel detection is disabled because PocketBase already selects the exact release. The metadata version must equal the PocketBase `version`, must include the exact `file_url` artifact, and must provide a canonical SHA-512 checksum for every candidate file; every candidate must remain in that HTTPS directory. The updater rejects the release before downloading when any of these checks fail.

Upload the complete Electron Builder output to the artifact directory before creating or updating the `app_releases` record. A macOS release includes the DMG shown to users, the ZIP consumed by Squirrel.Mac, `latest-mac.yml`, and generated blockmaps. Publishing the PocketBase record last prevents a client from selecting a partially uploaded release.

The update check never delays window startup. Network, record-validation, metadata, and download failures are logged and leave the running application unchanged. An optional release downloads in the background and installs during the next ordinary application exit; the next launch runs the new version. A record with `is_force: true` instead stops and joins the current WebUI process tree as soon as the download is ready, then runs the installer and relaunches Electron. Repeated quit requests remain blocked while that process tree is stopping, and a shutdown failure leaves the application running without invoking the installer.

PocketBase write access is release-selection authority, and COS write access is executable-publication authority; restrict both to release operators. The pinned COS root prevents a PocketBase record from redirecting clients to an arbitrary download host. SHA-512 detects a damaged or mismatched artifact but does not replace platform code signing because the artifact and metadata share one publication authority. Public macOS automatic updates require Developer ID signing and notarization. Enabling Windows later requires a signing certificate and Electron Builder `publisherName`; enabling Linux requires an independently authenticated package-publication policy. The unsigned macOS procedure below remains suitable only for manual test installation, not an automatic-update acceptance result.

## Phone Access Over LAN

Remote access is off at every Electron startup. Choose **Remote Access > Start Remote Access...** from the native application menu; it is under **DeepSeek Harness** on macOS and **Help** on Windows and Linux. A native confirmation explains that the WebUI will restart and that anyone who receives the connection URL can control the Harness Host. After confirmation, Electron stops the loopback-only background process, starts an authenticated listener on all interfaces with a new operating-system-assigned port, waits until it is ready, and loads the replacement process's new loopback URL. The WebUI establishes its connection again without a manual reload.

If the requested listener cannot start, Electron attempts to restore the previous mode on a new port, loads that recovery origin when it succeeds, and reports that the mode did not change. If the current process cannot be stopped safely, the previous mode cannot be restored, or the window cannot load a ready replacement origin, Electron displays a fatal native error. After that dialog is acknowledged, Electron requests application exit; its exit barrier runs cleanup and permits the process to exit only after the owned WebUI process tree has stopped. A failed cleanup attempt leaves exit blocked, and a later quit request can try again. Opening the application again starts a fresh loopback-only backend with remote access off.

After remote access starts, Electron opens a native connection-details dialog with a complete URL such as `http://192.168.1.20:43127/#dsh-access=TOKEN` and a **Copy URL** action. The **Remote Access** menu also provides **Show Connection Details...** and **Copy Connection URL** while the listener is active. Electron main owns the URL and clipboard write; the complete URL never enters the managed renderer, native window title, or a menu label. Connect the phone to the same trusted LAN and open the complete URL. The browser expires any legacy `dsh_remote_access` cookie at `Path=/`, stores the fragment token in a `SameSite=Strict` session cookie at `Path=/api`, and tries to record a token-free per-origin marker for the root page. When that write succeeds, it performs a same-origin replacement navigation to the same path, query, and remaining fragment parameters without the token. The replacement document begins booting only after those writes, so its first protected API and WebSocket connections include the cookie. If session storage is unavailable or rejects the write, the browser instead cleans the current URL with `history.replaceState` and keeps the current document so this load retains its local Host-authority hint. The marker is not a credential.

Cookies are not isolated by port. The `/api` path narrows where this bearer is sent, but another `/api` service on a different port of the same IP literal or hostname may receive it. Treat every such service as part of the credential's deployment trust scope.

Use the complete URL containing `#dsh-access=TOKEN`. The bare IP and port may load the static application shell, but its API and WebSocket requests receive 403 unless the browser already holds the current token cookie. A valid token grants the phone the same Harness Host access as the loopback desktop window except for the desktop-native directory chooser; it still includes settings, credentials, Host path opening, model discovery, agent-preset authoring, and agent tools. A file upload selects a file from the phone, while the Workspace directory browser navigates the desktop Host's filesystem.

The cookie has no persistent expiration time. Disabling remote access stops the LAN process and starts a loopback-only replacement, so its URL and cookie stop working. Re-enabling creates a different token and URL. Restarting Electron also invalidates the previous token and returns to the disabled state.

The native connection-details dialog uses only the first external IPv4 address reported by the operating system. On a host with multiple network adapters, that address may not belong to the phone's LAN; Electron does not provide an interface selector.

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

Outputs land under `dist/electron/`. Both platforms use the DeepSeek Harness product icon. The Windows installer provides an installation-directory step plus desktop and Start menu shortcuts. The installed application does not require a Harness checkout, Node.js, or pnpm on the target machine. It carries the Sharp/libvips notice and complete LGPL/GPL texts under `resources/legal/`; a release operator must verify the pinned source links and update those materials whenever the Sharp platform package or component versions change. The [Sharp Windows distribution decision](../../.agents/notes/implemented/process/2026-08-14-electron-sharp-lgpl-distribution.md) records the exact authorization. Signing, macOS notarization, and publishing remain release work.

### Unsigned macOS test builds

The macOS DMG is an ARM64 test build until release signing and notarization are configured. After copying `DeepSeek Harness.app` from the DMG into `/Applications`, a recipient who trusts the package can remove its download quarantine, apply a local ad-hoc signature, and launch it:

```sh
uname -m
sudo xattr -cr "/Applications/DeepSeek Harness.app"
sudo codesign --force --deep --sign - "/Applications/DeepSeek Harness.app"
open "/Applications/DeepSeek Harness.app"
```

`uname -m` must print `arm64`; this build does not run on Intel Macs. These commands bypass Gatekeeper's downloaded-app protection for this local copy and must only be used for a package whose source and checksum the recipient trusts. They do not replace Developer ID signing and Apple notarization for public distribution.

The Windows desktop window opens the operating system's native directory chooser through Electron main. The Web-host child sends a correlated request over its private parent-process IPC channel; Electron launches a dedicated helper process for the dialog so caller cancellation and application shutdown can terminate the chooser as well as release the request. This path avoids the Koffi/COM worker that is incompatible with the packaged Electron Node runtime. A loopback renderer uses this native interaction, while a phone connected over LAN keeps the in-app directory browser. macOS and Linux retain the Web profile's adaptive picker.

Cross-building the Windows installer on Apple Silicon requires Rosetta 2 because electron-builder's bundled NSIS compiler is an x86_64 macOS executable. The workspace installs the Windows x64 optional native dependencies needed by the packaged Harness runtime.

## Process And Security Model

The Electron main process owns the window and one background WebUI process tree. The child uses the packaged Electron executable in Node mode to run the packaged CLI on an operating-system-assigned port. Its default mode is loopback-only; enabling remote access replaces it with a child that applies the Electron-specific all-interfaces overlay, and disabling replaces that child with another loopback-only process. After each replacement becomes ready, the window loads its new loopback URL. Application shutdown terminates and joins the complete process tree with bounded escalation. The general `dsh web --host 0.0.0.0` command remains unsupported.

Loopback `/api` HTTP and RPC requests and WebSocket traffic do not need an Electron access token. An enabled remote-access process requires its current token for non-loopback `/api` traffic. A valid token grants its trusted LAN authority the same Host access as loopback except for explicitly loopback-only methods such as `host.pickDirectory`; token-eligible access still includes settings, credentials, Host path opening, agent-preset authoring, `llm.discoverModels`, and registered loopback-authority RPC. A configured `trustedHosts` entry without a valid token remains a DNS-rebinding defense and grants no additional privilege.

The LAN listener uses plain HTTP with no TLS. The token is a bearer secret equivalent to control of the Harness Host: anyone who sees the complete URL in the native details dialog, reads the desktop clipboard after a copy, captures the cookie in transit, or operates another same-host `/api` service that receives the cookie can operate the agent, read or change its exposed configuration and credentials, and invoke Host tools under the desktop user's operating-system account. A copied URL may remain in the operating-system or synchronized clipboard after remote access is disabled or Electron exits; replace it after use. Disabling remote access or restarting Electron invalidates that URL but does not clear the clipboard. Use this access only on a trusted company network where the phone and desktop share the intended LAN. Keep the operating-system firewall enabled, but allow inbound connections for DeepSeek Harness on the trusted or private network profile; otherwise the phone cannot reach the listener. Use client isolation or equivalent network controls when untrusted peers are present. Do not expose the port through public Wi-Fi, port forwarding, or an untrusted reverse proxy. The [Electron token Host authority decision](../../.agents/notes/implemented/feature/2026-08-14-electron-token-host-authority.md) records this privilege rule.

The renderer has Node integration disabled, context isolation and Chromium sandboxing enabled, and no WebView capability. It receives no remote-access preload or renderer IPC bridge. The native application menu, confirmation and detail dialogs, controller state, and clipboard write remain in Electron main; the complete bearer URL is disclosed only through the native details dialog and operating-system clipboard, never through the renderer, native window title, or a menu label. Ordinary WebUI deployments and phone browsers therefore receive no Electron-specific remote controls, and `DSH_ELECTRON_URL` mode omits the **Remote Access** menu. Directory-picker IPC exists only between the Electron-owned Web-host child and main process; it is not exposed to browser plugins. The app window accepts navigation only within the exact current WebUI origin. HTTP and HTTPS links for other origins open in the operating system browser; other schemes are rejected.

Electron Chromium data uses a dedicated `DeepSeek Harness` application-data directory. Harness sessions, settings, credentials, profiles, and workspace behavior remain owned by `dsh web`.

## Model Experience

The desktop window adds no model-visible input. The model receives the same Web-surface context and session log as `dsh web`.
