# Agent Note: 桌面与远程 Web 之间的自适应工作区目录选择

Status: implemented

[English](2026-08-21-adaptive-workspace-directory-picker.md) | 中文

## Problem

工作区目录选择能力 seam（[2026-07-28-directory-picker-capability-seam.md](2026-07-28-directory-picker-capability-seam.md)）提供两种交互 kind：`native` 在宿主显示器上打开一个 OS 选择器；`browse` 提供应用内列举与创建操作，服务于无法触达 OS 选择器的客户端。`dsh-plugin-remote-access` 下的远程浏览器挂载的是 native 后端，其 `pick()` 打开宿主机的 OS 文件选择框——远程操作者看不见也用不了。WebUI 在所有部署上都只能保留 browse，因为没有一种组合能同时做到：本地显示器用 OS 选择器、远程页面用应用内浏览器。

第二个缺口在特权门禁里。`host.pickDirectory` 位于 `PRIVILEGED_METHODS`，被钉死在 loopback 请求。remote-access 代理把 `Host` 头改写为 `127.0.0.1:<upstreamPort>`，并在每个转发请求上盖上 `x-dsh-remote-access-proxy` 标记，因此持有 LAN bearer token 就能从远程页面调用特权方法。该标记文档上写明了仅供 host 侧消费方使用，但没有任何 harness 门禁消费它。

## Decision

seam 新增第三种 kind `native-browse`，声明在可合并扩展的 `DirectoryPickerCapabilities` 映射中：`pick(signal)` 打开 OS 选择器，`list(path?, signal)` 与 `createDirectory(path, name)` 提供浏览原语。消费方与之前一样按 kind 分支；apiproxy 网关为 `host.pickDirectory`、`host.listDirectory`、`host.createDirectory` 三个 RPC 都接受该 kind。

`@deepseek-ai/dsh-host-directory-picker-electron` 实现该 kind。它继承 browse 后端，因此列举与创建在所有平台上都使用 web-host 子进程内 Node 的原生文件系统 API。`pick(signal)` 通过既有的父进程 IPC 通道发送带关联 id 的请求；Electron 主进程通过专用的 helper 重启动拥有 OS 对话框，并回复选中路径、取消或失败。提供方在加载时要求父进程 IPC 通道已连接，通道断开时拒绝所有待处理的 pick。

`@deepseek-ai/dsh-client-ui-directory-picker-electron` 在激活期间读取一次页面稳定的 `ctx.connection.isLoopback`：loopback 页面安装 native 流程（`ctx.workspaces.pickDirectory`），非 loopback 页面安装应用内浏览器（`ctx.workspaces.listDirectory` / `createDirectory`）。恰好一个流程事务填满 ui-workspace 的两个单槽，因此两种实现不会争夺同一槽位。共享的表现层、locale 字典与两个 installer 移入 `@deepseek-ai/dsh-client-directory-picker-flows`——一个没有 `dsh.client` 声明、没有 Cordis 身份的表示库，各 picker client bundle 通过共享的 css-modules-inline 插件内联它；browse 与 native client 包瘦身为调用 flows installer 的薄壳。WebUI 组合不变：web profile 保留 auto/browse/native 行，永远看不到 electron 包。

特权门禁现在拒绝代理请求。`packages/client/connection` 对 `PRIVILEGED_METHODS` 上的请求读取 `x-dsh-remote-access-proxy`，无论 loopback 钉死与否一律拒绝，从而堵上 remote-access 绕过：LAN bearer token 授权普通远程 API 流量，但永远不能调用 `host.pickDirectory`。`listDirectory` 与 `createDirectory` 保持非特权——它们是远程浏览器仍然需要的安全浏览原语。

Electron 应用通过 `electron/resources/electron-directory-picker.cordis.patch.yml` 组合两行 overlay：禁用 auto 行，挂载 electron host 与 client 行取而代之。两个包同时被 shell（`electron/package.json`，使 electron-builder 打包它们、主进程 bridge 能解析它们）与 web-app bundle（`packages/bundle/web-app`，使 profile 模块回退镜像它们、CLI 子进程的 Loader 可解析）声明为依赖。

## Alternatives considered

- **本地保持 native、远程硬失败。** 组合无法按页面分支；远程客户端将完全失去目录选择。否决，因为应用内浏览器已经能服务它们。
- **复用 auto 后端，加客户端 URL 或 header 提示。** auto 行在启动时检查一次宿主，而不是按连接检查；按页面的选择属于客户端，而提示必须能穿过代理改写。loopback 客户端路由正是代理已文档化的同一条规则的直接表达。
- **只在插件边界拒绝该标记。** remote-access 插件可以拒绝转发 `host.pickDirectory`；但 harness 若依赖第三方插件的自觉来保护特权方法，则违背"在做出决定的操作里执行决定"的原则。connection 门禁在产品内执行该不变量。
- **让 electron client 无条件安装两个流程。** 两个 installer 填的是同一对单槽；第二个安装会失败或挤掉第一个。每页一条路由是唯一符合槽位模型的组合。

## Consequences

- 桌面应用与远程浏览器各得其所：本地 OS 选择器、远程应用内浏览器，来自同一组合。
- seam 与 apiproxy 契约新增第三种 kind；既有消费方继续按 kind 分支，未知 kind 有文档化的默认行为。
- LAN bearer token 仍无法调用 `host.pickDirectory`；remote-access 标记现在在 harness 中承担实际约束。
- flows 库只能内联：把它挂成 Loader 行不提供任何 UI，css-modules-inline 插件把它的样式表带进内联消费方。
- 两个 electron picker 包必须同时被 shell 与 web-app bundle 声明；将来移除时必须同时删除两处声明。
- 验证：electron 组合测试通过真实 Loader 启动随附 overlay 并断言两行都激活；bridge 与 helper 规格覆盖 IPC 关联与取消；connection trust 规格覆盖标记拒绝。
