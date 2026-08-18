# Agent Note：Electron 提供打包的命令运行时

状态：已实现

[English](2026-08-17-electron-loopback-shell.md) | 中文

## 问题

桌面壳已经负责打包 WebUI 的进程树，但在没有开发仓库的机器上，插件子进程仍需要可用的 `node` 与 `pnpm` 命令。用户还需要一个可选的终端 `dsh` 入口，同时不能在 Electron 中重复实现 CLI。

## 决策

Electron 继续只作为现有 `dsh web` profile 的宿主。它仍通过既有参数、就绪行、origin 与 overlay 契约启动打包 CLI；壳不会重新实现服务器、会话、存储或插件运行时。

应用启动时，Electron 会在应用数据目录下可写的 `runtime-bin` 中生成 `node` 和 `pnpm` shim。shim 通过打包的 Electron 可执行文件以 Node 模式运行，壳会把该目录放到自有 WebUI 环境的最前面。macOS 上实际存在的常见工具目录也会加入 PATH，因为 Finder 启动的应用不会继承登录 shell 的 PATH。

原生应用菜单提供「Install dsh Command Line...」。在 macOS 与 Linux 上，它会写入 `~/bin/dsh`，让该 shim 指向打包 CLI，并且只向相关 shell 启动文件添加一次 `$HOME/bin`。在产品确定用户 PATH 安装策略前，Windows 会明确报告不支持该操作。

现有 macOS PocketBase 更新器继续遵守其信任与签名策略。启动检查可以显示所选版本与变更说明。可选下载使用非模态进度窗口；强制下载使用模态窗口，并在启动安装程序前经过既有退出屏障。从已挂载 DMG 运行时会返回只读卷结果；未签名的 macOS bundle 会报告 Squirrel.Mac 无法替换它。在经过认证的签名与发布策略落地前，Windows 和 Linux OTA 仍保持禁用。

## 考虑过的替代方案

**要求宿主安装 Node.js 与 pnpm。** 拒绝，因为打包的桌面应用必须让插件子进程运行时保持自包含。

**把 CLI 复制进 Electron。** 拒绝，因为壳应依赖打包后的上游 workspace 包及其公开 CLI 契约。

**只根据制品后缀启用所有平台更新。** 拒绝，因为安装器元数据不能取代仓库既有的平台签名与发布决策。

## 结果

打包后的插件子进程会继承可用的 `node` 和 `pnpm` 命令，POSIX 用户也可以选择安装终端 `dsh` shim。壳增加了原生更新进度展示，但发布选择与安装权限不会进入 renderer。远程访问、桌面插件与固定版本的 Web 内核继续使用既有的壳和 vendor 边界。
