# @deepseek-ai/dsh-client-ui-directory-picker-electron

[English](README.md) | 中文

供一个 Host 同时服务本地窗口与通过认证的局域网浏览器时使用的 Electron 目录选择界面。它在插件激活时读取一次页面生命周期内稳定的 `ctx.connection.isLoopback`：loopback 页面安装操作系统选择器流程，非 loopback 页面安装应用内目录浏览器。恰好一个流程事务填入 ui-workspace 的两个 single slot，因此两种实现不会争抢同一 slot。

原生分支驱动 `ctx.workspaces.pickDirectory()`，从而打开由 Electron main 持有的选择器。远程分支驱动 `ctx.workspaces.listDirectory()` 与 `ctx.workspaces.createDirectory()`，不会向浏览器暴露 Electron 或 Node API。共享展示与 locale 字典位于 [`dsh-client-directory-picker-flows`](../directory-picker-flows/README.md)。

## 模型体验

无，因为这个浏览器侧 Electron 目录选择界面不注册任何模型可见内容。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **需要 Host 双能力** —— 组合后的 Host 必须向 loopback 调用方提供原生选取，并向获授权的远程调用方提供目录列举与创建；缺少所选操作时，错误会通过既有的可重试工作区对话框呈现。
