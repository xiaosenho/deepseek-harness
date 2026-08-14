# `@deepseek-ai/dsh-electron`

[English](README.md) | 中文

DeepSeek Harness 的自包含 Electron 桌面应用。它会打包构建后的 `dsh` CLI、Web 前端和生产依赖树。启动时，Electron 运行时以隐藏的后台进程运行打包的 `dsh web --host 127.0.0.1 --port 0`，等待既有的 `dsh web:` 就绪输出行，然后在原生窗口中加载未经修改的 WebUI。Electron 不会重新实现 Web 服务器、API、会话、存储或插件运行时。

## 开发

在仓库根目录运行：

```sh
pnpm run dev:electron
```

源码开发以仓库根目录作为 Web profile 的工作目录。打包应用默认使用当前用户的主目录。设置 `DSH_ELECTRON_CWD` 可选择其他初始工作目录。

设置 `DSH_ELECTRON_URL` 为 HTTP 或 HTTPS URL，可跳过后台命令并让窗口连接到已经运行的 WebUI。

## 打包

为当前平台构建未封装应用：

```sh
pnpm run pack:electron
```

构建 macOS ARM64 DMG 安装包：

```sh
pnpm run dist:electron:mac
```

构建 Windows x64 NSIS 安装程序：

```sh
pnpm run dist:electron:win
```

输出位于 `dist/electron/`。两个平台均使用 DeepSeek Harness 产品图标。Windows 安装程序提供安装目录选择，并创建桌面和开始菜单快捷方式。安装后的应用不要求目标机器具备 Harness 代码检出目录、Node.js 或 pnpm。签名、macOS 公证和发布仍属于发布工作。

### 未签名 macOS 测试包

在配置发布签名和公证之前，macOS DMG 是 ARM64 测试包。接收者将 `DeepSeek Harness.app` 从 DMG 复制到 `/Applications` 后，如果确认该包可信，可以移除下载隔离属性、应用本地 ad-hoc 签名并启动应用：

```sh
uname -m
sudo xattr -cr "/Applications/DeepSeek Harness.app"
sudo codesign --force --deep --sign - "/Applications/DeepSeek Harness.app"
open "/Applications/DeepSeek Harness.app"
```

`uname -m` 必须输出 `arm64`；该构建不能在 Intel Mac 上运行。这些命令会为当前本地副本绕过“门禁”的已下载应用保护，只能用于接收者信任其来源和校验和的安装包。公开分发仍需 Developer ID 签名和 Apple 公证。

Windows 桌面应用使用应用内目录浏览器。原生 Win32 目录选择器依赖 Koffi/COM worker，该 worker 与打包后的 Electron Node 运行时不兼容。macOS 和 Linux 继续使用 Web profile 的自适应原生目录选择器。

在 Apple Silicon 上交叉构建 Windows 安装程序需要 Rosetta 2，因为 electron-builder 内置的 NSIS 编译器是 x86_64 macOS 可执行文件。工作区会安装打包 Harness 运行时所需的 Windows x64 可选原生依赖。

## 进程与安全模型

Electron 主进程负责窗口和后台 WebUI 进程树。子进程使用打包的 Electron 可执行文件以 Node 模式运行打包的 CLI，并在操作系统分配的 loopback 端口上启动 Web profile。窗口只加载 profile 就绪输出中的 URL。应用退出时会通过有界升级终止并等待完整进程树停止。

renderer 禁用 Node 集成，启用上下文隔离和 Chromium 沙箱，不提供 preload bridge，也不启用 WebView。应用窗口只允许导航到精确的 WebUI origin。其他 origin 的 HTTP 和 HTTPS 链接交给操作系统浏览器打开；其他 scheme 会被拒绝。

Electron Chromium 数据使用独立的 `DeepSeek Harness` 应用数据目录。Harness 会话、设置、凭据、profile 与工作区行为仍由 `dsh web` 负责。

## 模型体验

桌面窗口不增加模型可见输入。模型收到的 Web 界面上下文和会话日志与 `dsh web` 相同。
