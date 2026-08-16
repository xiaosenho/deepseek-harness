# Agent Note：Electron 封装现有 WebUI

状态：已实现

[English](2026-08-14-electron-web-profile-host.md) | 中文

## 问题

DeepSeek Harness 已有浏览器应用和 `dsh web` 组合，但没有原生桌面窗口。桌面封装必须复用该应用，不能建立第二套客户端组合、传输、存储实现或特权 renderer 运行时。

## 决策

`apps/electron` 是基于已发布 `@deepseek-ai/dsh` 依赖闭包的产品宿主。主进程在隐藏的独立进程树中启动打包 CLI 的 `web`，等待既有的就绪输出行，再在 `BrowserWindow` 中加载该进程的 loopback HTTP origin。应用每次启动时都会使用仅监听 loopback 的后台。原生应用菜单命令可以让 main 用绑定 `0.0.0.0`、带认证的 Electron-overlay 后台替代该进程，也可以再次替换为仅监听 loopback 的后台；每个替代进程都使用端口 `0`，main 会在其就绪后加载新的 loopback origin。确认与连接详情对话框以及剪贴板写入都由 main 负责。完整访问 URL 绝不会进入 renderer、原生窗口标题或菜单标签。[Electron LAN 访问使用临时 bearer URL](../feature/2026-08-14-electron-lan-access.md)记录了启用状态、凭据与安全决策。源码运行以仓库根目录作为命令工作目录；打包运行默认使用用户主目录。`DSH_ELECTRON_CWD` 选择其他目录。`DSH_ELECTRON_URL` 会有意绕过进程启动，连接已经运行的 HTTP 或 HTTPS WebUI；由于 Electron 不负责该后台，此模式会省略「Remote Access」菜单。

该进程是普通操作系统子进程，而不是 Electron utility process。它通过 `ELECTRON_RUN_AS_NODE=1` 和 `--expose-internals` 使用打包的 Electron 可执行文件，因此 CLI 使用打包运行时和按 Electron 重建的原生依赖，不要求外部 Node 安装。Electron 退出时，在 POSIX 上向独立进程组发送 `SIGTERM`，经过有界宽限期后升级为 `SIGKILL`，并等待进程组消失；Windows 使用 `taskkill /T /F` 并等待子进程退出事件。

请求的后台无法就绪时，可以在新 origin 上回滚到先前模式；main 会加载该 origin，并报告可恢复的模式变更失败。如果活动进程无法安全停止、回滚无法恢复可用后台，或 `BrowserWindow.loadURL()` 无法加载已经就绪的替代 origin，就不存在安全的桌面宿主状态。main 会显示一次原生致命错误，并在操作者确认后请求退出。退出屏障会执行进程树关停；清理尝试失败后仍保持关闭，但允许以后再次尝试。只有清理成功后 Electron 才会退出。下次启动应用时会建立新的仅监听 loopback 的后台，而不会恢复中断前的模式。

在 Windows 上，子进程还会应用 Electron 自有的目录选择 overlay。loopback renderer 通过私有的子进程到 main 进程 IPC bridge 和专用、可中止的 Electron helper 进程打开操作系统选择器；LAN renderer 使用同一宿主中直接访问文件系统的 browse 操作。[Electron 持有 Windows 原生目录选择器](2026-08-14-electron-owned-native-directory-picker.md)记录了这一混合交互及其生命周期，也说明了为何它只在打包后的 Electron 中替换不兼容的 Koffi/COM 路径。其他平台继续使用自适应选择器。

Electron 自管 renderer 不会获得 Electron preload 或 renderer IPC bridge。远程访问菜单命令会直接调用 main 自有控制器；原生对话框负责确认并显示完整 bearer URL，main 会把该值写入操作系统剪贴板。因此手机浏览器与普通 WebUI 部署不会获得 Electron 专属远程控制，`DSH_ELECTRON_URL` 模式也不会安装这些菜单命令。Node 集成和 WebView 支持被禁用，上下文隔离和 Chromium 沙箱被启用。主窗口导航被限制为精确的当前 WebUI origin；新后台就绪时，main 会替换该 origin。其他 HTTP 和 HTTPS origin 通过操作系统打开，非 Web scheme 则被拒绝。独立的 Chromium 用户数据目录避免 Electron 存储和单实例锁与无关 Electron 应用冲突。

Electron 包不是 Cordis 插件，也不提供会话事件、prompt section、工具、API route 或客户端 slot。它对 `@deepseek-ai/dsh` 和 CLI 宿主所需 `@deepseek-ai/cordis-plugin-group` peer 的生产依赖使 electron-builder 把 CLI、Web 前端、bundle、插件及其运行时依赖包含在应用内。这些文件以应用资源目录下的普通依赖树形式保留，而不放入 ASAR 归档，因为 profile 模块回退需要创建指向已安装包的真实文件系统链接。Web profile 继续负责所有宿主与浏览器插件、工作区操作、凭据读取、设置和持久会话写入。

## 考虑过的替代方案

**在 Electron 中重新实现 Web 传输。** 否决，因为 Web 应用依赖 `dsh web` 已经提供的 HTTP route、WebSocket stream、启动 manifest 注入和动态客户端 bundle。

**在 Electron utility process 中运行 CLI。** 否决，因为其模块 loader 行为与生命周期和 Electron 主实例耦合。独立的 Electron 可执行文件以 Node 模式运行，既提供相同的打包 ABI，又保留可独立终止的进程树。

**通过窄 preload bridge 暴露远程访问操作。** 否决，因为后台生命周期、凭据披露与剪贴板访问都由 Electron main 负责，Web 应用不需要 renderer 访问这些操作。原生菜单命令与对话框会把操作和 bearer 值都留在动态组合的 renderer 之外。

**要求用户单独启动 WebUI。** 作为显式的 `DSH_ELECTRON_URL` 模式保留，但不是默认模式，因为桌面应用应当通过一条命令打开。

## 后果

桌面应用展示与 `dsh web` 相同的 UI 和模型可见上下文。本地 Windows 窗口获得原生目录选择器；同一可信 LAN 上的手机可使用原生详情对话框显示的带 token URL 和应用内目录浏览器。后台替换会中断旧 WebUI 进程负责的工作，但原生窗口会自动加载替代 origin；发生致命的替换失败时，Electron 会请求退出应用，而退出屏障会在自有进程清理成功之前继续阻止退出。再次打开时会恢复到仅监听 loopback 的模式。开发启动只需一条命令，应用退出会停止其负责的 WebUI 和所有活动的选择器 helper，打包应用不要求外部源码树、Node.js 或包管理器。分发产物包括使用产品图标的 macOS ARM64 DMG 和 Windows x64 NSIS 安装程序。交叉打包会安装 Windows x64 可选原生依赖变体，并使用其预构建二进制文件，不尝试通过 node-gyp 交叉编译。Apple Silicon 构建机需要 Rosetta 2 才能运行 electron-builder 的 x86_64 NSIS 编译器；发布任务仍需要签名和 macOS 公证。
