# @deepseek-ai/dsh-host-directory-picker-electron

[English](README.md) | 中文

[目录选择 seam](../directory-picker/README.md) 的 **Electron 宿主后端**注册一个 `native-browse` 能力。它继承[浏览后端](../directory-picker-browse/README.md)，因此所有平台上的目录列举与创建都在 Web 宿主子进程中使用 Node 原生文件系统 API。`pick(signal)` 通过该子进程现有的父进程 IPC 通道发送带关联 id 的请求；Electron 主进程拥有系统对话框，并回复所选路径、取消或失败。Web renderer 不会获得 Electron 或 Node bridge。

provider 在插件加载时要求父进程 IPC 已连接。它严格校验入站消息、忽略无关 IPC 流量、通过 branded id 准确关联并发请求，并在通道断开或插件离开时拒绝全部待处理选择。调用方 abort 会尽力发送 cancel 消息，并立即以调用方的原因拒绝。内置 Electron bridge 会据此中止专用对话框 helper，并等待其完整进程树退出，从而关闭已经显示的选择器。

`./protocol` 导出子进程请求与父进程结果的消息联合、校验器和请求 id 工厂，供 Electron 主进程使用。`ElectronDirectoryPickerIpcPort` 与请求 id 生成均可注入，以支持确定性测试。

## 模型体验

无。该包服务于 GUI 目录选择；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **必须由 Electron 父进程承载**——在独立 Web 宿主中加载会失败，因为没有原生对话框请求的所有者。
