# Agent Note: Windows subprocesses without console popups

Status: implemented

English | [中文](2026-08-14-windows-subprocesses-without-console-popups.zh.md)

## Problem

`@deepseek-ai/dsh-subprocess-local` can run beneath a desktop GUI host that has no visible console. Its ordinary `child_process.spawn` path and synchronous Windows `taskkill` helper did not request hidden windows. Windows could therefore create and briefly display a console window for each command or cleanup helper even when stdout and stderr were piped or ignored. This is a host presentation defect independent of the provider's stdio and process-tree ownership.

The [Windows ACL restricted-token sandbox](../feature/2026-08-08-windows-acl-restricted-token-sandbox.md) has a separate inner launcher. Children created there with `CREATE_NO_WINDOW` or `CREATE_NEW_CONSOLE` fail during DLL initialization with `STATUS_DLL_INIT_FAILED` (`0xC0000142`). The console fix must therefore hide the host-owned outer process without changing those restricted-token creation flags.

## Decision

`spawnSubprocess()` passes `windowsHide: true` to Node when its resolved platform is `win32`. `taskkillProcessTree()` passes the same option to synchronous `taskkill` invocations. The generic local provider owns both settings, so Electron and any other GUI host receive the behavior without consumer-specific spawn policy.

The provider keeps explicit stdio dispositions, Windows process-tree termination, executable lookup, and cancellation unchanged. The ACL restricted-token launcher keeps its existing creation flags; its inner process continues to share the outer process's console state rather than requesting an incompatible console mode.

## Verification

Unit tests inspect the ordinary spawn options under an injected `win32` platform and the exact synchronous `taskkill` options. Those tests pin the provider policy on every development platform; a packaged Windows smoke remains the direct evidence that the desktop does not display a transient console window.

## Alternatives considered

**Hide windows separately in Electron and other GUI consumers.** Rejected because the local subprocess provider owns process creation, and consumer-specific options would leave future GUI hosts inconsistent.

**Set `CREATE_NO_WINDOW` or `CREATE_NEW_CONSOLE` on the ACL restricted-token child.** Rejected because both flags make that child fail during DLL initialization with `0xC0000142`; changing the outer Node spawn avoids that failure.

**Route commands through PowerShell `Start-Process -WindowStyle Hidden`.** Rejected because it adds a shell-specific wrapper and changes executable resolution, quoting, stdio, and process-tree semantics that the provider already owns.

## Consequences

Ordinary commands and `taskkill` cleanup launched by the local provider do not flash console windows under a Windows GUI host. POSIX spawns, `node-pty` terminal creation, configured stdio, and process-tree lifecycle semantics are unchanged.

The hidden-window guarantee depends on the outer process being created through this provider. The option-level tests cannot observe desktop chrome, so packaged Windows verification remains part of release confidence for this behavior.
