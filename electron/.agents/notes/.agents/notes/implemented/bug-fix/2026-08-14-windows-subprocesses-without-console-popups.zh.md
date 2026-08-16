# Agent Note: Windows 子进程不弹出控制台窗口

Status: implemented

[English](2026-08-14-windows-subprocesses-without-console-popups.md) | 中文

## Problem

`@deepseek-ai/dsh-subprocess-local` 可以运行在没有可见控制台的桌面 GUI 宿主之下。它的普通 `child_process.spawn` 路径与 Windows 同步 `taskkill` helper 没有请求隐藏窗口。因此，即使 stdout 和 stderr 已通过管道传递或被忽略，Windows 仍可能为每条命令或清理 helper 创建并短暂显示一个控制台窗口。这是宿主展示缺陷，与 provider 的 stdio 和进程树所有权无关。

[Windows ACL 受限 token 沙箱](../feature/2026-08-08-windows-acl-restricted-token-sandbox.md)拥有独立的内层 launcher。使用 `CREATE_NO_WINDOW` 或 `CREATE_NEW_CONSOLE` 创建的子进程会在 DLL 初始化期间以 `STATUS_DLL_INIT_FAILED`（`0xC0000142`）失败。因此，控制台修复必须隐藏宿主拥有的外层进程，不能改变这些受限 token 创建标志。

## Decision

`spawnSubprocess()` 在解析出的平台为 `win32` 时向 Node 传入 `windowsHide: true`。`taskkillProcessTree()` 对同步 `taskkill` 调用传入相同选项。通用本地 provider 统一拥有这两项设置，因此 Electron 与其他 GUI 宿主无需各自维护 spawn 策略即可获得该行为。

Provider 保持显式 stdio 处置方式、Windows 进程树终止、可执行文件查找与取消行为不变。ACL 受限 token launcher 保持已有创建标志；其内层进程继续共享外层进程的控制台状态，不请求不兼容的控制台模式。

## Verification

单元测试会在注入 `win32` 平台时检查普通 spawn 选项，并检查同步 `taskkill` 的精确选项。这些测试可在每个开发平台上固定 provider 策略；要直接确认桌面不会显示短暂的控制台窗口，仍须运行打包后的 Windows 冒烟测试。

## Alternatives considered

**分别在 Electron 与其他 GUI 消费方中隐藏窗口。** 拒绝，因为本地 subprocess provider 拥有进程创建，消费方各自设置选项会让未来的 GUI 宿主产生不一致行为。

**在 ACL 受限 token 子进程上设置 `CREATE_NO_WINDOW` 或 `CREATE_NEW_CONSOLE`。** 拒绝，因为两项标志都会使该子进程在 DLL 初始化期间以 `0xC0000142` 失败；修改外层 Node spawn 可以避开这项故障。

**通过 PowerShell `Start-Process -WindowStyle Hidden` 执行命令。** 拒绝，因为这会增加 shell 特定的包装层，并改变 provider 已拥有的可执行文件解析、引号处理、stdio 与进程树语义。

## Consequences

本地 provider 启动的普通命令与 `taskkill` 清理不会在 Windows GUI 宿主下闪现控制台窗口。POSIX spawn、`node-pty` terminal 创建、已配置的 stdio 与进程树生命周期语义保持不变。

隐藏窗口保证要求外层进程由该 provider 创建。选项级测试无法观察桌面界面，因此打包后的 Windows 验证仍是该行为发布信心的一部分。
