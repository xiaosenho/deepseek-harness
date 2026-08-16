# Agent Note: Electron 远程 token 授予宿主机权限

Status: implemented

[English](2026-08-14-electron-token-host-authority.md) | 中文

## 问题

`/api` 的 Host 与 Origin 栅栏保护 Harness 宿主机免受 DNS rebinding 和跨站浏览器请求。`trustedHosts` 条目只标识部署提供服务的 authority；它不是认证，不能授予设置、凭据、原生操作或声明为 loopback authority 的 RPC endpoint。

Electron 会有意向手机提供一个显式进程凭据。普通远程 agent 面已经可以启动会话，并以宿主进程账户调用 bash 等工具；手机 UI 还需要使用桌面窗口可用的配置、凭据、模型发现、preset 创作与 workspace 交互。因此必须直接声明该凭据的权限，不能暗示一个既不符合 agent 能力面、也不符合产品行为的低权限远程层级。

## 决策

配置 `ConnectionConfig.remoteAccessToken` 后，每个非 loopback 请求都必须同时提供受信任的 Host authority 与完全匹配的 token。对于允许 token 访问的特权 API 方法，以及注册时声明 `authority: loopback` 的 Typert RPC，该已配置 token 会把可接受的 authority 扩展到通过 token 认证的 `trustedHosts`。明确归类为 loopback-only 的方法仍不允许远程调用方访问。未配置 token 时，`trustedHosts` 保持不具备特权的既有行为，不能访问这些面。

因此，有效 token 会让远程客户端获得与 loopback 相同的可编程 Harness 宿主机访问权限，但明确限定为 loopback-only 的交互除外。这包括普通会话与 agent 操作、设置与凭据、打开宿主路径、`llm.discoverModels`、agent preset 创作及已注册的 loopback-authority RPC。`host.pickDirectory` 会打开桌面原生选择器，因此仍为 loopback-only；远程 UI 改用应用内浏览器选择宿主目录。除此以外，该 bearer 等同于以桌面用户的操作系统账户控制 Harness 宿主机，同时仍受 loopback UI 所适用的运行时策略与工具沙箱约束。

token 不会削弱外层 Node authority 不变量。只有 TCP 对端属于 `127.0.0.0/8`、为 `::1`，或为 IPv4-mapped loopback 地址时，loopback `Host` 才可豁免。非 loopback 对端伪造 loopback `Host` 时，即使提供有效 token，也会在 HTTP 或 RPC 分发前及 WebSocket upgrade 前被拒绝。bridge 后的 Fetch 检查依赖此外层不变量，因为 Fetch `Request` 对象不携带 TCP 对端地址。

Electron 通过 [LAN 访问决策](2026-08-14-electron-lan-access.md)所述的完整 `http://LAN-IP:port/#dsh-access=TOKEN` URL 交付 token。手机浏览器会先让任何位于 `Path=/` 的旧 `dsh_remote_access` cookie 过期，把 bearer 存入位于 `Path=/api` 的 `dsh_remote_access` 会话 cookie，为根页面记录不含 token、按 origin 隔离的标记，再移除 fragment。只打开裸 IP 与端口可能可以加载静态外壳，但除非浏览器已经持有当前进程 cookie，否则 API 与 WebSocket 请求会收到 403；该标记不会授予权限。

文件归属取决于执行交互的客户端与宿主服务。上传、拖放与粘贴输入选择手机浏览器中的文件，再把它们序列化到宿主机。Workspace 路径与应用内目录浏览器位于宿主机一侧：手机导航和选择的是桌面机器上的目录，由此产生的会话与 workspace 注册表也归宿主机所有。

## 曾考虑的替代方案

**让通过 token 认证的远程访问保留较低权限的 API 层级。** 否决，因为普通 agent 面已经允许执行宿主机命令，手机 UI 需要桌面窗口的同等管理交互，而且低权限标签会承诺一个可访问工具面并不具备的安全属性。

**让 `trustedHosts` 在没有 token 时也授予同等权限。** 否决，因为 authority allowlist 是 DNS rebinding 与混淆代理人防御，不是远程调用方已经获授权的证明。混淆二者会把未认证的程序化全接口 composition 变成特权宿主机 API。

**增加用户、范围化权限或持久登录。** 作为独立的远程部署设计暂缓。Electron 功能有意为可信 LAN 使用一个进程生命周期内有效、全有或全无的 bearer，并不声称提供用户身份、机密性或运行中进程内的撤销。

## 后果

完整 Electron LAN URL 及其 cookie 都是宿主机控制凭据。它们经无 TLS 的明文 HTTP 传输，因此任何看到或截获任一值的人都能使用完整 Harness 能力面。Cookie 不按端口隔离：`Path=/api` 会收窄发送范围，但同一 IP 字面量或 hostname 上的另一个 `/api` 服务仍可能收到该 bearer，必须将其纳入部署的凭据信任范围。该监听器只适用于通过操作系统防火墙与网络隔离排除不可信对端的可信 LAN；不得通过公共 Wi-Fi、端口转发或不可信代理暴露。

重启 Electron 会轮换进程 token，并使先前的 URL 与 cookie 失效。cookie 不设置持久化过期时间，但浏览器会话恢复可能保留它，直到轮换让其值无法再使用。

持有当前 token 的远程客户端可以查看和修改宿主机所有的会话、设置、凭据、preset 与 workspace 记录。只有用户选择上传时，手机本地文件才会进入宿主机；目录浏览与 workspace 路径指向宿主机文件系统。
