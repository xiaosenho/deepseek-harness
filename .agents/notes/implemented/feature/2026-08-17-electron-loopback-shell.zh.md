# Agent Note: Electron 桌面外壳复用 loopback `dsh web`

Status: implemented

[English](2026-08-17-electron-loopback-shell.md) | 中文

## 问题

桌面交付需要原生窗口，但不能把 Web 服务器、API、会话、存储或插件运行时复制进 Electron。插件子进程还需要可用的 Node 和 pnpm，即使用户没有单独安装这两个工具。

## 决策

Electron 主进程启动打包后的 `dsh web --host 127.0.0.1 --port 0`，等待严格的 loopback 就绪行，再把该 URL 加载到受限的 `BrowserWindow`。Electron 只拥有外壳职责：单实例协调、通过系统浏览器打开外部链接、原生菜单、一键安装用户级 `dsh` 命令行 shim，以及退出前完整关闭进程树。

生成的 `runtime-bin` 目录存放 `node` 和 `pnpm` shim，它们以 Node 模式执行打包后的 Electron 可执行文件。该目录被前置到后台 WebUI 进程的 `PATH`，因此插件子进程无需单独安装即可继承可用的命令。macOS 上外壳还会前置 `/opt/homebrew/bin` 等已存在的用户工具目录，因为从 Finder 启动的进程不会继承登录 shell 的 `PATH`。Electron 43 内置 Node v24.18.1，满足仓库引擎范围。

electron-builder 把选中的工作区包及其外部依赖闭包复制到 `app/node_modules`。存在版本冲突的依赖嵌套到需要它们的工作区包下；唯一版本只放在顶层一次。

原生菜单保留中文更新操作，后台启动检查会先向用户展示版本号和更新内容，再由用户决定是否安装。可选更新通过显示百分比进度的小状态窗在后台下载，不阻塞主界面；强制更新会弹出显示百分比进度的模态状态窗，在更新完成并重启前主界面不可操作。更新器选择 PocketBase `app_releases` 中与宿主平台匹配的最新记录，校验可信 HTTPS 制品 URL，再把匹配的 generic release 目录交给 `electron-updater`。制品后缀按平台区分：macOS 为 ZIP，Windows 为 NSIS `.exe`，Linux 为 AppImage。从 DMG 等只读卷启动的应用会提示先安装到“应用程序”，而不是尝试写入只读安装器。未签名的 macOS 构建会通过 `codesign` 检测并提示为“未签名”，因为 Squirrel.Mac 无法替换未签名应用。

## 备选方案

**直接用浏览器标签页启动 `dsh web`。** 这能避免 Electron，但无法提供要求的单实例桌面生命周期和原生菜单。

**在 Electron 内复制 Web profile。** 这会把服务器、会话、存储和插件行为移入外壳，违反插件优先的归属边界。

**要求用户安装 Node 和 pnpm。** 这会让插件执行依赖宿主机配置，不满足内置运行时要求。

**把 DMG 作为自动更新制品发布。** macOS 上的 `electron-updater` 消费 generic feed ZIP，因此 DMG `file_url` 无法通过已核验的元数据检查。

## 后果

该模块作为私有 Electron 工作区包发布，包含单元测试和打包 smoke 路径。自动更新覆盖 macOS ZIP、Windows NSIS 和 Linux AppImage；Linux deb 目标仍由包管理器管理。LAN/FRP 远程访问、DOCX 简历导出及其他业务功能仍留在模块之外。
