# @deepseek-ai/dsh-client-connection

[English](README.md) | 中文

协议消费层：客户端插件的 apply 会挂载 `ctx.connection`（共享 API 客户端 + 当前页面的 loopback 状态 + 可观察且按 generation 生效的 `hostDescription` + 单消费方流循环启动器）；导出表层携带协议约定类型、`AbstractApiClient` 抽象，以及循环的 sink／配置类型。每次就绪握手成功后，都会在 `onConnected` 之前发布完整的 `host.describe` 值；generation 失效或显式 stop 会清空它，因此原生能力消费者不会保留已经断线的判断。浏览器载体以 HTTP POST 发送 unary／respond，并为 `events.mux` 与 `events.host` 各开一条只下行的 WebSocket；进程内载体满足同一双流抽象。浏览器侧关联 UUID 使用 `crypto.getRandomValues()`，因此主 API 客户端与通用 RPC 调用都可运行于明文 HTTP origin，而不依赖仅限安全上下文的 `crypto.randomUUID()`。Host half 持有唯一 `/api` route 及其 Fetch bridge；已注册的 Typert interceptor 会先认领自己的 Remote endpoint，未认领请求再回退 API Proxy。Loopback hostname 判定逻辑留在包内部：`/api` Host fence 与 WebSocket upgrade 会直接使用它，其他客户端插件则消费派生的 `ctx.connection.isLoopback` 状态。node 半侧的 `/api` 路由把桌面原生 `host.pickDirectory` 严格限定为 loopback。其余特权方法集（`host.openPath`，以及整个配置面——`settings.describe`/`openDocument`/`update`/`replace`/`mutate` 与 `credentials.describe`/`set`/`unset`；读取与原生操作也在内，因为 describe 会返回已暴露的配置、打开操作会作用于 Host 桌面，而探测任意引用会报出某条凭据来自何处——再加上 `llm.discoverModels`，因为它会让 Host 请求调用方选择的 endpoint，并可能携带草稿凭据——以及 agent（智能体） preset 的创作面 `agentPreset.read`/`copy`/`openDocument`/`remove`，因为组装指明了一个会话所运行的插件，读取它是侦察，而 copy/remove/openDocument 管理名单并驱动宿主桌面（创作只有复制一种写入，因此这些方法都不接收组装文本或路径）；`agentPreset.list` 与 `agentPreset.select` 不在其中——名单只携带 id 与信任级别，而选择一个 preset 并不比 `session.create` 自带的 `agentPreset` 多给任何能力，何况默认 preset 本就带着 bash）置于单独的特权信任检查之后：loopback 可以访问，只有 `trustedHosts` 不可以，受信任的非 loopback authority 只有在提供已配置的 `remoteAccessToken` 时才可访问。同一已配置 token 也会放行已注册的 `authority: loopback` RPC，因此通过 token 认证的受信任 authority 可获得与 loopback 相同的宿主机访问权限，但明确限定为 loopback-only 的方法除外。平台载体与 ConnectionController 循环属于包内部；apply 负责选择并驱动它们。下行边界见 [WebSocket 下行载体 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-04-websocket-downlink-carrier.md)。

## /api 浏览器信任栅栏

node 半侧在桥接或 upgrade 前守卫 `/api` 下的每个入口（`src/api-request-trust.ts`）。每个请求——无论是否带浏览器标记——`Host` 都必须是回环地址权威，或与某个 `trustedHosts` 条目匹配：带端口的 `host:port` 条目精确匹配，不带端口的条目匹配任意端口，两侧均经 WHATWG 归一化后比较（DNS rebinding 防御）。刻意不为无浏览器标记的 HTTP 请求开捷径：明文 HTTP 下浏览器的图片与导航读取既不带 `Origin` 也不带 Fetch-Metadata，因此无标记请求仍可能是被重绑页面发起的、响应可被读走的读取，而 Host 是重绑唯一伪造不了的请求头；WebSocket 浏览器握手会带 `Origin` 并通过同一道比较。非浏览器客户端经由回环地址、部署推导的 LAN IP 字面量或已声明的权威通过同一道栅栏。当标记存在时，如附带 `Origin`，则它必须与 Host 权威完全一致；显式的 `sec-fetch-site: cross-site` 标记一律拒绝。不是纯的、规范形 `host[:port]` 权威的 `trustedHosts` 条目——即 WHATWG 解析读回后与原文不完全一致的——会让插件加载明确报错：否则解析会悄悄授权 `harness.internal/path` 这类笔误里的 hostname，或把悬空冒号、补零端口放大成任意端口授权。HTTP 失败在任何 RPC 分发之前以纯 403 应答，upgrade 失败在启动任何事件流前拒绝握手。非 loopback 组合必须显式信任其服务权威：Web 运行时从全接口服务器配置推导 LAN IP 字面量，cordis.yml 中的 `trustedHosts` 与 CLI（命令行界面）的 `--trusted-host` flag 则声明具名权威。通用命令 `dsh web --host 0.0.0.0` 仍被有意拒绝；Electron 自有组合是一个携带进程期凭据的限定例外。Host/Origin 栅栏仍是混淆代理人防御，而不是认证。决策记录：[api 浏览器信任边界 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-28-api-browser-trust-boundary.md)。

在每个 Node HTTP、RPC 和 WebSocket 入口，只有 TCP 对端属于 `127.0.0.0/8`、为 `::1`，或是 `127.0.0.0/8` 的 IPv4-mapped 形式（例如 `::ffff:127.0.0.1`）时，loopback `Host` 才可豁免 `trustedHosts` 与 token 检查。非 loopback 对端即使携带正确的 Electron token，只要提供 loopback `Host`，也会在进入 Fetch bridge 或 WebSocket handler 前被拒绝；HTTP 与 RPC 返回 403，upgrade 被拒绝。Fetch bridge 创建的 Fetch `Request` 不携带 socket 元数据，因此下游 authority 检查依赖 Node 入口在 bridge 之前已经建立的 TCP 对端与 Host 不变量。

对于 Electron 自有组合，浏览器客户端会识别一个非空的 `#dsh-access=TOKEN`，先让任何位于 `Path=/` 的旧 `dsh_remote_access` cookie 过期，再把 token 存入名为 `dsh_remote_access`、位于 `Path=/api` 的 `SameSite=Strict` 会话 cookie，并尝试将不含 token 的 `dsh_remote_access_present=1` 标记写入按 origin 隔离的 `sessionStorage`。标记写入成功时，`location.replace(cleanUrl)` 会以不含 token、但保留相同 path、query 与其余 fragment 参数的 URL 执行同源 replacement navigation；替代文档只在 cookie 已经存在后才启动，因此首批 API 与 WebSocket 连接会携带凭据。如果 session storage 缺失或写入抛错，客户端会改用 `history.replaceState` 移除 token 并继续当前文档，从而保留本次 load 的本地 Host-authority 提示，而不会在没有 marker 的情况下重载。根页面无法读取 `/api` cookie；以后加载时只查询该标记，标记既不包含 bearer，也不能认证请求。只打开裸 IP 与端口可以加载静态外壳，但除非该浏览器已持有当前进程 token，否则 `/api` HTTP、RPC 与 WebSocket 流量都会收到 403。非 loopback 流量必须提供 token；loopback 调用方豁免。

Cookie 的作用域不包含端口。`Path=/api` 会把 bearer 的发送范围收窄到 API 路径，但浏览器仍可能把 cookie 发给同一 IP 字面量或 hostname 其他端口上的 `/api` 服务。使用该 bearer 的部署必须把所有这类服务纳入凭据的信任范围；按 origin 隔离的标记仍由 origin 隔离，不会改变 cookie 的发送行为。

因为 Electron 配置了 `remoteAccessToken`，有效 token 会让远程受信任 authority 获得与 loopback 相同的宿主机访问权限，但不能调用桌面原生目录选择器；它仍包括设置、凭据、打开宿主路径、模型发现、agent preset 创作及已注册的 `authority: loopback` RPC。只有 `trustedHosts` 而没有 token 绝不会授予这类权限。手机上传选择手机浏览器中的文件，workspace 路径和应用内 workspace 浏览器则指向宿主机文件系统。该进程 bearer 经明文 HTTP 传输，因此任何看到完整启动 URL 或捕获 cookie 的人都能控制 Harness 宿主机。[Electron LAN 访问决策](../../../.agents/notes/implemented/feature/2026-08-14-electron-lan-access.md)负责 token 交付与生命周期；[Electron token 宿主机权限决策](../../../.agents/notes/implemented/feature/2026-08-14-electron-token-host-authority.md)负责由此产生的权限。

## `/api` WebSocket 下行

`/api/events.mux` 与 `/api/events.host` 各接受一条 WebSocket upgrade，并只向浏览器发送对应的 `ServerRequest` 文本消息；客户端不会在这些 socket 上发送业务数据。任一 socket 结束都会使当前 connection generation 失败并重建两条流，连接就绪仍要求两条 socket 均已打开且 `host.describe` HTTP 调用成功。Host teardown 会终止两条 socket、中止各自的 source，并等待 source 清理完成后再返回。普通网络 GET 这些路径会返回 426，不保留 SSE（Server-Sent Events）回退；`toFetchHandler` 的 SSE 编解码只服务进程内同构载体。

## 模型体验

无。协议消费层只在浏览器与主机之间搬运已经组合好的消息；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **History 会恢复未附加的会话**：打开 history 可能创建宿主侧 agent，并增加首次打开的延迟；没有仅从持久化读取的路径。
- **`/api` 桥把每个请求体整体缓冲在内存里**：`maxRequestBodyBytes`（默认 160 MiB，按默认 100 MiB 图片总量上限经 base64 膨胀加信封余量得出）因此同时是单请求的驻留内存上界；要降低它而不缩小图片限额，需要流式请求体路径。
