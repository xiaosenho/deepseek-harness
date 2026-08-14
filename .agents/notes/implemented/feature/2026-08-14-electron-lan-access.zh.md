# Agent Note: Electron LAN 访问使用临时 bearer URL

Status: implemented

[English](2026-08-14-electron-lan-access.md) | 中文

## 问题

Electron 应用负责运行完整的本地 WebUI 进程，但仅监听 loopback 无法服务同一 LAN 上的手机。发布普通的全接口 WebUI 不只是显示层改动：普通 agent API 可以驱动工具执行命令并访问宿主工作区。

通用 `dsh web` 命令会刻意拒绝 `--host 0.0.0.0`，因为 Web 载体不提供部署认证或 TLS。Electron 需要一条范围更窄的访问路径，让地址与凭据共享其自有后台进程的生命周期，同时不重新开放通用 CLI 模式。

## 决策

每个 Electron 自有 WebUI 都会以端口 `0` 启动并仅监听 loopback，不应用 LAN overlay，也不生成远程访问 token。因此应用每次启动时都会关闭远程访问。Electron 负责该后台时，main 会在原生应用菜单中添加「Remote Access」部分；其中的命令是开启、查看、复制和关闭 LAN 访问的唯一控制界面。`DSH_ELECTRON_URL` 模式会省略该菜单部分，因为外部 WebUI 自行负责其网络与认证策略。任何 WebUI renderer 都不会获得远程访问 preload 或 renderer IPC bridge。

Electron main 会把每次启用状态变更串行化为一次后台进程替换。它先停止当前进程，再用操作系统重新分配的端口启动请求的模式，等待就绪后在 `BrowserWindow` 中加载替代进程的 loopback URL。WebUI 随后会针对新 origin 启动，并重新建立 HTTP 与 WebSocket 连接，无需操作者手动刷新。如果请求的模式启动失败，控制器会尝试恢复原模式，在恢复成功时加载该替代 origin，并报告失败而不声称请求状态已经生效。无法停止当前进程、无法恢复可用的先前模式，或无法加载已经就绪的替代 origin 时都属于致命故障：Electron 会显示一次原生错误，并在操作者确认后请求退出应用。退出屏障会执行关停，允许在清理失败后再次尝试，并且只在自有 WebUI 进程树停止后才允许进程退出。以后再次启动应用时会从仅监听 loopback 的默认状态开始，不会持久化请求的状态。

开启时会应用仅限 Electron 的 profile overlay，让进程以端口 `0` 绑定 `0.0.0.0`，通用命令仍拒绝 `dsh web --host 0.0.0.0`。Electron main 会执行 `randomBytes(9).toString('base64url')`，为该 LAN 进程生成新的 12 字符 token，并根据第一个外部 IPv4 地址得到 `http://LAN-IP:port/#dsh-access=TOKEN`。启动成功后，main 会在带复制操作的原生详情对话框中显示该完整 bearer URL。该凭据绝不会进入自管 renderer、原生窗口标题或应用菜单标签。关闭时会先停止 LAN 进程，再启动仅监听 loopback 的替代进程，从而使旧 token 失效，并让其 URL 与 cookie 值无法再使用。以后再次开启会生成另一个 token。

远程访问控制不会跨越浏览器 IPC。原生启动与停止命令会显示确认对话框，随后再次检查控制器的权威状态，再变更后台。变更期间，菜单会显示 changing 状态并禁用所有远程命令。详情与复制命令只对已经稳定开启的状态生效。详情对话框只允许复制它所显示的精确 URL；如果对话框打开期间凭据发生轮换，main 会拒绝复制旧值，并要求操作者重新打开详情。所有操作系统剪贴板写入都由 Electron main 执行。

收到一个非空 token fragment 时，手机浏览器会先让任何位于 `Path=/` 的旧 `dsh_remote_access` cookie 过期，把 bearer 存入名为 `dsh_remote_access`、位于 `Path=/api` 的 `SameSite=Strict` 会话 cookie，并尝试将不含 token 的 `dsh_remote_access_present=1` 标记写入按 origin 隔离的 `sessionStorage`。标记写入成功时，`location.replace(cleanUrl)` 会以不含 token、但保留相同 path、query 与其余 fragment 参数的 URL 执行同源 replacement navigation。正式 WebUI 文档只在这些写入完成后才启动，因此首批受保护 API 与 WebSocket 连接会携带 cookie，而不会和凭据启动交接发生竞态。如果 session storage 缺失或写入抛错，客户端会使用 `history.replaceState` 移除 token 并继续当前文档；成功的 fragment 结果因此会保留本次 load 的本地 Host-authority 提示，不依赖无法存储的 marker。根页面无法读取 `/api` cookie，以后加载时只通过该标记记住其 origin 曾收到凭据；该标记既不包含 bearer，也不能认证请求。URL fragment 不会随初始 HTTP 请求发送，因此浏览器存储凭据前，它不会进入该请求的 target、中间层日志或 referrer。

Cookie 的作用域不包含端口。`Path=/api` 会显著收窄发送范围，但同一 IP 字面量或 hostname 其他端口上的 `/api` 服务仍可能收到 bearer cookie。因此，该功能的部署信任范围必须包含所有这类服务。session 标记按 origin（包括端口）隔离，但不会改变 cookie 的发送行为。

connection 载体在既有的[载体级 Host、Origin 与媒体类型检查](../architecture/2026-07-28-api-browser-trust-boundary.md)之外还会校验访问令牌。LAN 模式运行期间，非 loopback `/api` HTTP 与 RPC 请求及 WebSocket upgrade 必须提供其当前令牌；loopback 流量豁免。

WebUI 的主 API 与通用逻辑 RPC 路径通过 `crypto.getRandomValues()` 生成浏览器侧关联 UUID，conversation 客户端也用该原语生成仅存在于浏览器中的草稿附件 id。这些 LAN 路径不依赖仅限安全上下文的 `crypto.randomUUID()`。

在每个 Node HTTP、RPC 和 WebSocket 入口，只有 TCP 对端属于 `127.0.0.0/8`、为 `::1`，或是 `127.0.0.0/8` 的 IPv4-mapped 形式（例如 `::ffff:127.0.0.1`）时，loopback `Host` 才可豁免 `trustedHosts` 与 token 检查。非 loopback 对端即使携带正确的 token，只要提供 loopback `Host`，也会在分发前被拒绝；HTTP 与 RPC 返回 403，WebSocket upgrade 被拒绝。Node 入口通过后，Fetch bridge 会丢弃 socket 元数据，所以下游 Fetch 检查依赖已经建立的 TCP 对端与 Host 不变量。

LAN 模式配置 `remoteAccessToken` 时，受信任 LAN authority 上的有效 token 会获得与 loopback 相同的可编程宿主机访问权限，但桌面原生目录选择器等明确限定为 loopback-only 的交互除外。允许 token 访问的权限包括设置、凭据、打开宿主路径、agent preset 创作、`llm.discoverModels` 及已注册的 `authority: loopback` RPC。[Electron token 宿主机权限决策](2026-08-14-electron-token-host-authority.md)负责这条权限规则；本 Note 负责 bearer 交付与生命周期。只有 `trustedHosts` 而没有有效 token 时仍不具备特权。

该令牌是经明文 HTTP 传输的 bearer secret，不是用户身份或通用远程部署认证系统。任何在原生详情对话框中看到完整 URL、在复制后读取桌面剪贴板、在传输途中捕获 cookie，或控制另一个会收到该 cookie 的同宿主 `/api` 服务的人，都能操作 agent。受支持的环境是手机与桌面共享预期 LAN、且每个会收到 cookie 的服务都可受托持有 bearer 的可信公司网络。操作系统防火墙必须允许 DeepSeek Harness 在可信或专用网络配置中接收入站流量，否则手机无法访问监听器；客户端隔离或等效控制必须排除不可信对端。Electron 宿主关系仍由[桌面包装层决策](../architecture/2026-08-14-electron-web-profile-host.md)负责记录。

## 验证

组装浏览器回归把一个非本地 `.test` authority 解析到 loopback 测试服务器，确认该页面是没有 `crypto.randomUUID()` 但提供 `crypto.getRandomValues()` 的非安全 HTTP origin，随后通过浏览器发起的请求验证 bearer 启动交接以及宿主机会话、设置和文件系统访问。Electron 测试覆盖自有与外部 WebUI 的菜单组合、菜单标签不包含 URL 的控制器状态投影、原生确认与详情流程、替代 origin 导航、main 自有剪贴板写入、凭据轮换和清理重试行为。

## 曾考虑的替代方案

**让每个 Electron 自有 WebUI 启动时都开启远程访问。** 否决，因为即使操作者只需要本地窗口，只要桌面应用运行，宿主机也会接受 LAN 流量。显式原生菜单命令让每次应用启动时的暴露都需要主动选择。

**让 Electron 只监听 loopback，并要求另行管理 Web 服务器。** 否决，因为桌面应用无法再提供所需的单应用手机访问，操作者还必须手工发现并保护第二个服务器。

**为所有调用方重新启用 `dsh web --host 0.0.0.0`。** 否决，因为这会恢复通用的未认证远程代码执行面。Electron overlay 会把全接口可达性与显式开启的进程及其新 token 绑定在一起。

**使用持久共享 secret 或完整的用户认证系统。** 对此可信 LAN 功能予以否决，因为持久凭据的存储、恢复、轮换与用户身份属于独立部署问题。进程期令牌可以限制持久性，同时不声称解决了远程部署问题。

**通过查询参数携带令牌。** 否决，因为浏览器会在 HTTP 请求 target 中发送令牌，并让更多日志与导航记录保留它。fragment 到 cookie 的交接使令牌不进入初始请求。正常的 marker 路径会在正式 WebUI 启动前用不含 token 的同源 URL 替换该 history entry；storage 失败的 fallback 则就地清理当前 entry。

**把 bearer cookie 的作用域设为 `/`，让根页面读取。** 否决，因为同一宿主的每条路径都会收到凭据。`Path=/api` 会把正常发送范围限制在 API 路径，而不含 token 的 session 标记可以让根页面记住启动已经完成，无需读取或复制 bearer。

**在原生窗口标题或菜单标签中公布 bearer URL。** 否决，因为凭据会持续显示在刻意使用的原生详情对话框之外。标题保留普通 WebUI 文案，菜单标签只显示状态与操作。

**通过窄 preload bridge 把远程访问控制放入 Web 设置。** 否决，因为后台生命周期、凭据披露和剪贴板访问都是 Electron 自有操作。把该流程保留在 main 进程原生 UI 中，动态组合的 Web 插件就不会获得远程控制 API 或 bearer 值。

## 后果

同一可达 LAN 上的手机可以打开原生详情对话框显示的完整 URL，无需单独登录。开启或关闭访问会中断被替换 WebUI 进程中的工作，但 Electron 会自动加载替代 origin。可恢复的启动失败也会加载重新建立的 origin。无法安全停止、回滚失败或替代 origin 加载失败时，Electron 会显示原生致命错误并请求退出；只有自有进程清理成功后，应用才会退出。再次打开时会启动仅监听 loopback 的后台。该 cookie 不设置持久化过期时间，但停止 LAN 进程会使其 token 失效；因此关闭访问或重启 Electron 都会撤销旧 URL，并恢复仅监听 loopback 的后台。

进程 token 授予完整的可编程 Harness 宿主机权限，但不能触发桌面原生目录选择器。手机上传读取手机浏览器中选择的文件，workspace 路径与应用内 workspace 浏览器则指向宿主机文件系统。

本地网络上的通信不具备机密性：页面与 cookie 都没有 TLS 保护。必须把显示和复制后的 URL 当作凭据，而防火墙、网络隔离及同宿主 `/api` 服务的可信程度仍是运行环境的一部分，不是应用保证。关闭访问或 Electron 退出后，已复制的 URL 仍可能留在操作系统剪贴板或同步剪贴板中，其他应用可以读取；使用后必须将其覆盖。关闭访问或重启 Electron 会使复制的 URL 失效，但不会清空剪贴板。

应用只显示第一个外部 IPv4 地址。多宿主网络中的机器可能显示不属于手机 LAN 的地址；Electron 不提供接口选择器或 IPv6 地址。
