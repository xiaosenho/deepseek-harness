# Agent Note: Electron Sharp LGPL Distribution

Status: implemented

English | [中文](2026-08-14-electron-sharp-lgpl-distribution.zh.md)

## Problem

The Windows Electron runtime needs the prebuilt `@img/sharp-win32-x64` package because image attachments reach Sharp through the packaged Harness dependency tree. Version 0.35.3 declares `Apache-2.0 AND LGPL-3.0-or-later` and carries dynamically loaded libvips and supporting DLLs. The third-party-notices generator correctly rejects this non-permissive runtime by default; accepting it is a distribution decision with obligations that a checksum or an npm manifest row cannot satisfy.

## Decision

The project owner authorizes distribution of the exact `@img/sharp-win32-x64` identity while its published manifest declares `Apache-2.0 AND LGPL-3.0-or-later`. This authorization does not cover `sharp`, another `@img/sharp-*` identity, a static build, or changed declared terms. The notices generator keeps LGPL classified as non-permissive, matches the exact identity and declaration, and fails when either changes.

Electron Builder copies `apps/electron/legal/` into `resources/legal/` in every packaged application. The directory contains the complete LGPL version 3 and GPL version 3 texts plus a Sharp/libvips notice. The notice identifies the current Sharp and libvips versions, the LGPL-covered libraries named by upstream, and pinned source/build provenance. The application uses `asar: false`; the Windows DLLs remain ordinary dynamically loaded files that recipients can inspect and replace with compatible builds.

Package and component versions are release inputs, not open-ended authorization. Generator tests derive the Sharp package and libvips versions from installed metadata. Builder tests require the legal directory and pin the notice to the direct package version and current libvips version. A release operator must review and update the notice and source links before distributing an installer after either version changes, and must keep the corresponding source available with the published installer.

The [generated third-party notices decision](2026-07-30-generated-third-party-notices.md) remains the owner of dependency disclosure and the fail-closed license policy. This note owns only the Electron Sharp Windows distribution obligations.

## Alternatives considered

**Classify LGPL as permissive.** This would misstate the license and allow unrelated copyleft runtime dependencies to pass without an explicit decision.

**Add a reusable native-package allowlist.** Package-family or license-family authorization would extend the owner's acceptance to identities and terms that were not reviewed.

**Remove Sharp from the Windows package.** That would break the packaged image-attachment path rather than meet its distribution requirements.

**Ship only a notice link.** LGPL version 3 incorporates GPL version 3 and requires recipients to receive the applicable terms and corresponding-source information. The installer therefore carries both complete texts and version-specific provenance.

## Consequences

Windows Electron artifacts carry additional legal files and an explicit corresponding-source obligation. Changing the Sharp identity or license declaration fails the notices generator. Changing package or libvips versions fails the pinned legal-material tests until the record is reviewed.

The authorization is durable because future Electron packaging and dependency upgrades must distinguish the reviewed dynamic Windows payload from other Sharp packages or linkage models. The note stays active; no same-topic Agent Note is superseded.
