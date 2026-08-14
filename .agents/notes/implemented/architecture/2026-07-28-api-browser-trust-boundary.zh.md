# Agent Note: 所有 /api 路由共用一道载体级浏览器信任边界

Status: implemented

[English](2026-07-28-api-browser-trust-boundary.md) | 中文

## 问题

Web GUI 宿主以纯 HTTP 提供 `/api`，默认监听 `127.0.0.1:3080`。程序化 composition 可以绑定 `0.0.0.0`；通用 CLI 拒绝该绑定，而 Electron composition 为 LAN 提供单独保护的例外。这个面上有远程代码执行级别的方法——`session.prompt` 驱动的 agent（智能体）可以运行 bash。浏览器会用两种经典方式把操作者变成攻击此类本地 API 的「混淆代理人」：恶意页面发出跨站「简单请求」 POST（`text/plain`——不经 CORS 预检即发出），其副作用照常执行、只是响应不可读；以及 DNS rebinding 后的源以「同源」身份直连 socket，CORS 整体失效，只有 `Host` 头会暴露攻击者的域名。一条覆盖整个载体的规则必须保护所有后果严重的方法，同时不破坏供显式授权远程客户端使用的应用内目录浏览器。

## 决策

在载体层对整个 `/api` 前缀一次性执行浏览器信任检查——分为两部分：

- **媒体类型栅栏（dsh-host-apiproxy）**：每个 `/api` POST 必须声明 `application/json`，否则在解析前以 415 拒绝。跨站「简单请求」由此不复存在：任何跨站尝试都被逼进一次本服务器从不应答的 CORS 预检。
- **权威栅栏（dsh-client-connection，`src/api-request-trust.ts`）**：每个请求的 `Host` 都必须是回环地址，或与某个 `trustedHosts` 条目匹配（带端口的 `host:port` 条目精确匹配，不带端口的条目匹配任意端口，均经 WHATWG 归一化；rebinding 防御）。在 Node HTTP、RPC 和 WebSocket 入口，loopback `Host` 还要求 TCP 对端属于 `127.0.0.0/8`、为 `::1`，或是 `127.0.0.0/8` 的 IPv4-mapped 形式（例如 `::ffff:127.0.0.1`）；非 loopback 对端即使携带有效的访问 token，只要提供 loopback `Host`，也会被拒绝，其中 HTTP 与 RPC 返回 403，WebSocket upgrade 被拒绝。刻意不为无标记请求开捷径：明文 HTTP 下浏览器的读取（EventSource、图片、导航——这些头只发给可信目标）既不带 `Origin` 也不带 Fetch-Metadata，因此无标记请求可能是被重绑页面发起且响应可被读走的读取，而 Host 是重绑唯一伪造不了的请求头；非浏览器客户端经由回环地址、推导的 LAN IP 字面量或已声明的权威通过。若带 `Origin` 则必须与 Host 权威完全一致；`sec-fetch-site: cross-site` 一律拒绝。不是单纯规范化 authority 的 `trustedHosts` 条目会导致插件加载失败——否则 WHATWG 解析会悄悄授权笔误里的 hostname，或放大精确端口授权。`host.pickDirectory` 失去专属守卫，与其他请求同栅而行。

可达性仍由 webserver 的绑定配置（`host: 127.0.0.1 | 0.0.0.0`）控制，真正远程部署的通用认证仍不在范围内——这道栅栏是混淆代理人防御，不是认证层。通用 CLI 拒绝监听所有接口。Electron 自管的 composition 是一个狭窄例外，它增加进程生命周期内有效的 bearer 凭据，但不会取代这道栅栏。配置 `remoteAccessToken` 后，通过 token 认证的受信任 authority 可以访问特权方法集及已注册的 `authority: loopback` RPC；只有 `trustedHosts` 而没有 token 绝不会提升权限。[Electron LAN 访问使用临时 bearer URL](../feature/2026-08-14-electron-lan-access.md)负责 token 交付，而 [Electron token 授予宿主机权限](../feature/2026-08-14-electron-token-host-authority.md)负责权限决策。Node 载体会专门对 loopback `Host` 保留 TCP 对端检查，因为原始远程客户端可以自行选择该请求头。Node 入口通过后创建的 Fetch `Request` 不再携带 socket 元数据；后续 authority 与特权方法检查依赖外层入口已经建立的事实：loopback `Host` 来自 loopback 对端。

Electron 的浏览器启动流程会把 bearer 存入作用域为 `Path=/api` 的 cookie，只给根页面留下一个不含 token、按 origin 隔离的 `sessionStorage` 标记。然而，HTTP cookie 的作用域不包含端口，因此浏览器仍可能把该 bearer 发给同一 IP 字面量或 hostname 其他端口上的 `/api` 服务。Host/Origin 栅栏会保护 Harness 监听器，却无法阻止 cookie 被发送给这类服务；部署的凭据信任范围必须包含所有可能收到该 cookie 的同宿主服务。

## 曾考虑的替代方案

- **按 RPC 设防（延续现状）。** 否决：守卫清单永远追着方法清单跑，价值最高的方法本来就没被守住，而 browse RPC 上的回环规则会破坏它们为之存在的远程部署。
- **CORS 头与省略凭据。** 否决：我们根本不想要任何跨源读取，应答预检只会扩大暴露面；拒绝预检严格更强也更简单。
- **在本决策中加入通用部署认证系统。** 否决，因为 token 签发、存储、轮换和管理是独立的产品面。Electron LAN 决策只为一个自管 composition 使用范围更窄的进程生命周期凭据。

## 后果

- 未来任何 `/api` 方法天然在覆盖范围内；不存在会被遗忘的按路由信任决定。
- 非回环部署的对外服务 authority 必须列入信任范围，否则请求会被拒绝。通用 CLI 拒绝 `--host 0.0.0.0`；程序化 composition 自行声明 `trustedHosts` 和认证策略。Electron composition 推导其显示的 LAN authority，并增加临时 bearer 凭据。非浏览器自动化走同一道栅栏，也必须满足 composition 专属的凭据要求：loopback、推导出的 LAN IP 或已声明的 authority 可通过 authority 栅栏；未声明的 DNS 别名会被拒绝。
- 客户端必须给 POST 体标注 `application/json`（我们自己的客户端一向如此；裸 fetch 测试补上了该头）。
- 程序化 composition 若以无认证方式暴露 `0.0.0.0`，则除非自行增加认证，否则仍只适用于可信网络。Electron 的 bearer 凭据通过明文 HTTP 发送，并授予完整的 Harness 宿主机权限，因此该范围受限的例外也仍只适用于同宿主 `/api` 服务可受托接收该 cookie 的可信 LAN。
