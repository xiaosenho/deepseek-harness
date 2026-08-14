# Agent Note：Electron 封装现有 WebUI

状态：已实现

[English](2026-08-14-electron-web-profile-host.md) | 中文

## 问题

DeepSeek Harness 已有浏览器应用和 `dsh web` 组合，但没有原生桌面窗口。桌面封装必须复用该应用，不能建立第二套客户端组合、传输、存储实现或特权 renderer 运行时。

## 决策

`apps/electron` 是基于已发布 `@deepseek-ai/dsh` 依赖闭包的产品宿主。主进程在隐藏的独立进程树中启动打包 CLI 的 `web --host 127.0.0.1 --port 0`，等待既有的 loopback 就绪输出行，然后在 `BrowserWindow` 中加载该 origin。源码运行以仓库根目录作为命令工作目录；打包运行默认使用用户主目录。`DSH_ELECTRON_CWD` 选择其他目录；`DSH_ELECTRON_URL` 会有意绕过进程启动，连接已经运行的 HTTP 或 HTTPS WebUI。

该进程是普通操作系统子进程，而不是 Electron utility process。它通过 `ELECTRON_RUN_AS_NODE=1` 和 `--expose-internals` 使用打包的 Electron 可执行文件，因此 CLI 使用打包运行时和按 Electron 重建的原生依赖，不要求外部 Node 安装。Electron 退出时，在 POSIX 上向独立进程组发送 `SIGTERM`，经过有界宽限期后升级为 `SIGKILL`，并等待进程组消失；Windows 使用 `taskkill /T /F` 并等待子进程退出事件。

在 Windows 上，子进程还会应用 Electron 自有的 profile overlay，以完整的浏览式交互替换自适应目录选择器。原生 Win32 选择器在宿主运行时的子进程中运行 Koffi/COM 对话框；在打包后的 Electron Node 运行时下，该 worker 可能在发送协议结果前终止。浏览式组合让目录选择留在现有 WebUI 内，并避免这条子进程嵌套路径依赖原生模块。其他平台继续使用自适应选择器。

renderer 不接收 Electron bridge。Node 集成和 WebView 支持被禁用，上下文隔离和 Chromium 沙箱被启用。主窗口导航被限制为精确的 WebUI origin。其他 HTTP 和 HTTPS origin 通过操作系统打开，非 Web scheme 则被拒绝。独立的 Chromium 用户数据目录避免 Electron 存储和单实例锁与无关 Electron 应用冲突。

Electron 包不是 Cordis 插件，也不提供会话事件、prompt section、工具、API route 或客户端 slot。它对 `@deepseek-ai/dsh` 和 CLI 宿主所需 `@deepseek-ai/cordis-plugin-group` peer 的生产依赖使 electron-builder 把 CLI、Web 前端、bundle、插件及其运行时依赖包含在应用内。这些文件以应用资源目录下的普通依赖树形式保留，而不放入 ASAR 归档，因为 profile 模块回退需要创建指向已安装包的真实文件系统链接。Web profile 继续负责所有宿主与浏览器插件、工作区操作、凭据读取、设置和持久会话写入。

## 考虑过的替代方案

**在 Electron 中重新实现 Web 传输。** 否决，因为 Web 应用依赖 `dsh web` 已经提供的 HTTP route、WebSocket stream、启动 manifest 注入和动态客户端 bundle。

**在 Electron utility process 中运行 CLI。** 否决，因为其模块 loader 行为与生命周期和 Electron 主实例耦合。独立的 Electron 可执行文件以 Node 模式运行，既提供相同的打包 ABI，又保留可独立终止的进程树。

**通过 preload 暴露 Electron API。** 否决，因为现有 Web 应用不需要特权 renderer API。bridge 会让动态加载的浏览器插件获得不必要的权限。

**要求用户单独启动 WebUI。** 作为显式的 `DSH_ELECTRON_URL` 模式保留，但不是默认模式，因为桌面应用应当通过一条命令打开。

## 后果

桌面应用展示与 `dsh web` 相同的 UI 和模型可见上下文。开发启动只需一条命令，应用退出会停止其负责的 WebUI，打包应用不要求外部源码树、Node.js 或包管理器。分发产物包括使用产品图标的 macOS ARM64 DMG 和 Windows x64 NSIS 安装程序。交叉打包会安装 Windows x64 可选原生依赖变体，并使用其预构建二进制文件，不尝试通过 node-gyp 交叉编译。Apple Silicon 构建机需要 Rosetta 2 才能运行 electron-builder 的 x86_64 NSIS 编译器；发布任务仍需要签名和 macOS 公证。
