# Agent Note: Electron 持有 Windows 原生目录选择器

Status: implemented

[English](2026-08-14-electron-owned-native-directory-picker.md) | 中文

## 问题

Windows Electron 应用必须让本地操作者通过操作系统对话框选择工作区。通用 Web profile 的 Win32 后端在 Node 宿主进程下运行 Koffi/COM worker，但该 worker 在打包后的 Electron Node 运行时中可能退出而不返回结果。始终使用应用内浏览器可以避开这个故障，却移除了桌面端应有的交互。同一个 Electron 自有 Web 服务器还允许持有 token 的 LAN 浏览器接入，而这些浏览器不得获得在桌面上打开对话框的权限。最后，目录选择 seam 要求调用方中止时停止仍在等待的选择器，但 Electron 的异步对话框 API 没有关闭操作。

## 决策

Windows Electron overlay 挂载 `dsh-host-directory-picker-electron`，其稳定的 `native-browse` 能力把 `pick(signal)` 与 browse 后端的 `list(path, signal)`、`createDirectory(path, name)` 组合起来。目录列举与创建继续在 Web 宿主子进程中调用 Node 原生文件系统 API；面向模型的文件工具仍使用既有文件系统 seam。匹配的 client 插件在每个现有 single directory-flow slot 中只占一个位置，并为 loopback 连接选择原生流程，为非 loopback 连接选择浏览流程。

Web 宿主子进程通过它与 Electron main 所属的现有私有 IPC 通道，发送带品牌类型和关联 id 的选择器请求。两端都会校验消息的精确字段。断开连接与插件拆卸会拒绝所有待处理请求；取消操作先移除待处理请求，再尽力发送取消消息；无关或迟到的消息不产生影响。该 IPC 通道不经 preload 或 renderer API 暴露。

Electron main 为每个获准的原生选择请求启动专用 Electron helper 进程。helper 持有一次 `dialog.showOpenDialog` 调用，并通过 stdout 发出一个经过校验的结果。请求取消、后端退出或应用关闭都会中止请求并终止 helper 进程树，从而关闭已经显示的对话框。长期运行的 main 进程对话框无法满足这一生命周期要求，因为 Electron 没有在异步选择器打开后将其关闭的 API。

既有 `host.pickDirectory` 授权仍只允许 loopback，包括 socket peer 与 Host header 检查。持有 Electron LAN bearer token 可以授权普通远程 API 流量，却永远不能调用该方法。因此，手机获得应用内浏览器，即使直接发出原生 RPC 也不能触发桌面选择器。通用 [`directory-picker-native`](../feature/2026-07-27-native-workspace-directory-picker.md) 后端仍可用于非 Electron Web 组合；打包后的 Windows Electron 只避开其不兼容的 Koffi/COM 执行路径。

## 考虑过的替代方案

**通过 preload 暴露 Electron 对话框 API。** 否决，因为这会让每个动态加载的浏览器插件获得 renderer 特权路径，而自有后端子进程已经提供了权限更窄且经过认证的载体。

**直接在长期运行的 Electron main 进程中打开对话框。** 否决，因为无法通过程序关闭 `showOpenDialog`。忽略迟到结果只能释放请求，却会在取消或关闭应用后留下无人持有的可见对话框。

**保留打包后的 Koffi/COM 子进程。** 否决，因为不返回结果正是本提供方要消除的故障。该实现对于普通 Node 宿主的 Web 组合仍然有效。

**让所有 Electron 客户端使用应用内浏览器。** 否决，因为 Electron 已经持有原生 OS 对话框 API，这一选择却会让本地桌面操作者使用 Web 文件浏览器交互。远程客户端仍然需要 browse 路径。

**通过协议按连接通告一种能力类型。** 否决，因为 Electron 宿主可以用一个稳定能力公开两组操作，既有 connection 服务也已经提供选择单一 client 流程所需的可信 loopback 事实。新增通告会重复该事实，并恢复目录选择 seam 已删除的跨插件分支。

## 后果

Windows 桌面窗口会打开操作系统原生目录选择器，而不会授予 renderer 访问 Node 或 Electron 的权限。LAN 浏览器继续通过宿主子进程中的 Node 直接文件系统操作浏览和创建目录，原生对话框权限仍只属于本地。为了让取消操作拥有真实的进程属主，实现新增一套私有父进程协议，并为每次原生选择启动一个短生命周期 Electron 进程。macOS、Linux 与通用 Web 部署保留既有的自适应或固定目录选择组合。

[目录选择 seam](2026-07-28-directory-picker-capability-seam.md)、[自适应默认值](../feature/2026-07-29-directory-picker-adaptive-default.md)与 [Electron Web 宿主](2026-08-14-electron-web-profile-host.md) Note 继续保持 active：它们仍分别负责通用能力、启动时选择以及桌面进程与安全决策。本 Note 只负责 Electron 专属的混合交互与选择器生命周期，因此没有任何上述记录被取代或归档。
