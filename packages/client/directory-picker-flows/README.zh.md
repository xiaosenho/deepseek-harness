# @deepseek-ai/dsh-client-directory-picker-flows

[English](README.md) | 中文

共享目录选择器展示库。它持有无渲染的原生流程、应用内目录浏览器、该浏览器的 locale 字典，以及两个以事务方式填入 ui-workspace directory-flow slot 的安装函数。native、browse 与 Electron 目录选择器插件把本包内联进各自的 client bundle；本包没有 `dsh.client` 声明、Cordis 服务、模块表条目或共享运行时标识。

`installNativeDirectoryFlow(ctx)` 绑定 `ctx.workspaces.pickDirectory()`。`installBrowseDirectoryFlow(ctx)` 绑定目录列举与创建，以及 `directory-browser` locale 命名空间。两个安装函数都通过一组嵌套的 `slots.inject()` effect 注册会话区与侧边栏 slot，因此 slot 声明替换或插件卸载会一起移除这对注册。

## 模型体验

无，因为这个浏览器展示库不注册任何模型可见内容。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **仅供浏览器内联** —— client 插件必须只调用一个安装函数，并让共享 client bundler 内联本包；把本包作为 Loader 行挂载不会提供任何界面。
