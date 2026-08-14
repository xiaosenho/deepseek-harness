# Agent Note: Electron updates use PocketBase release selection

Status: implemented

English | [中文](2026-08-14-electron-pocketbase-ota-updates.zh.md)

## Problem

The packaged Electron application needs to discover a platform release at startup, download it without delaying the desktop window, and install it only after the processes owned by the desktop host are quiescent. The PocketBase `app_releases` schema provides a version and artifact URL but no artifact checksum, architecture-specific file set, or Electron installer metadata. Executing that URL directly would duplicate platform installer behavior and would accept an executable without an independently declared digest.

## Decision

The packaged macOS application queries `https://ota.xiaosenho.top/api/collections/app_releases/records` after its first window loads. The query maps Electron `darwin` to `macos`, then selects one record by descending `version_code`. Source runs do not query the service. Packaged Windows and Linux applications also skip OTA until those distribution paths enforce an authenticated signing policy. `DSH_ELECTRON_OTA_URL` replaces the PocketBase base URL without changing the collection or record fields. This extends the [Electron Web host](../architecture/2026-08-14-electron-web-profile-host.md) while preserving the rule that a [source run owns no managed installer](../simplification/2026-08-10-source-run-without-managed-installer.md).

`version_code` orders records only. Electron Updater compares the record's `version` as SemVer with the installed application version, which belongs to the shared dsh release sequence. Downgrades are disabled. The client validates the bounded PocketBase JSON response and accepts only the exact platform, PocketBase record id, non-negative integer `version_code`, boolean `is_force`, string `changelog`, and credential-free HTTPS `file_url` required by the update operation. The artifact URL must remain under the pinned `https://application-1305333896.cos.ap-guangzhou.myqcloud.com/` root; changing `DSH_ELECTRON_OTA_URL` does not change this trust decision.

PocketBase selects a release but does not describe downloadable files. The directory containing its DMG `file_url` is an Electron Updater generic provider and contains Electron Builder's `latest-mac.yml`. Electron Builder disables automatic prerelease channel detection because PocketBase already chooses the exact release, so prerelease SemVer does not change the metadata filename. Before download, the client requires the provider version to equal the PocketBase version, requires the provider file list to include the exact `file_url` origin and path, requires every candidate to stay in the same HTTPS directory, and requires every candidate to carry a canonical SHA-512 value. Electron Updater then owns the Squirrel.Mac download and installation behavior.

Electron Builder generates a macOS DMG and ZIP together and emits generic-provider metadata for the COS artifact root. A release publisher uploads the installer, ZIP where required, metadata, and blockmaps before publishing the PocketBase record. The record is the publication commit point: writing it before the artifact set is complete makes the release invalid to clients.

Checks and downloads run outside the WebUI startup promise. A failure is logged and leaves the current application running. Optional releases use `autoInstallOnAppQuit`, so the existing desktop shutdown joins its WebUI process tree before the pending update is applied. A release with `is_force: true` requests installation as soon as the download completes; the main process first shuts down the current `RemoteAccessController` or `WebBackend`, then calls `quitAndInstall()` to relaunch. One exit barrier coalesces concurrent quit requests, permits Electron exit only after shutdown succeeds, and permits retry after a shutdown failure.

Version and update presentation remain native Electron responsibilities. The application About panel reads the installed version from `app.getVersion()`, and the application menu invokes the same update controller used at startup. The controller coalesces an active check and retains a ready result to prevent a second download. A native dialog reports manual results. No update method or state crosses the preload bridge into the WebUI.

PocketBase write access is release-selection authority, while COS write access is executable-publication authority; both are restricted to release operators. Pinning the COS root prevents a PocketBase writer from redirecting clients to an arbitrary host. SHA-512 pins an artifact to the selected metadata but does not authenticate a publisher that controls both objects. Squirrel.Mac requires Developer ID signing, and public macOS releases also require notarization. Windows stays disabled until production releases configure code signing and Electron Builder `publisherName`; Linux stays disabled until it has an independently authenticated package-publication policy. An unsigned manual test build does not establish automatic-update support.

## Alternatives considered

**Download and execute `file_url` directly.** Rejected because one URL cannot express the macOS ZIP, platform metadata, blockmaps, or digest, and custom installer execution would duplicate Electron Updater's platform lifecycle.

**Use an Electron generic feed without PocketBase.** Rejected because `app_releases` owns cross-client release selection, monotonic `version_code`, change text, and force policy. Electron Builder metadata remains subordinate file metadata rather than a second release catalog.

**Block first-window readiness on the update check.** Rejected because OTA availability is independent of the local WebUI. A slow or unavailable release service must not make the installed application unusable.

**Install every downloaded release immediately.** Rejected because optional updates may interrupt active work. Only the explicit `is_force` policy initiates an immediate orderly restart.

**Add version and update controls to WebUI settings.** Rejected because OTA exists only for the installed Electron host. A renderer control would add an Electron-only protocol to the generic WebUI and expose executable lifecycle operations across preload without improving the native desktop workflow.

## Consequences

The macOS application checks once per packaged startup, supports a native menu check on demand, downloads a newer matching release in the background, installs optional releases on ordinary exit, and immediately restarts for forced releases after owned processes stop. The native About panel displays the current version. Update state remains outside the renderer and session log and contributes no model-visible input.

The OTA bucket must retain a complete Electron Builder artifact set for each selected release. A PocketBase record whose directory lacks the expected metadata or ZIP is visible but unusable, and clients log the failure without falling back to an unverified installer.

Installed old-to-new update acceptance remains platform-native release evidence. Unit tests cover PocketBase validation, metadata anchoring, background policy, force policy, and shutdown ordering, but they do not substitute for a signed, notarized Squirrel.Mac installation test.
