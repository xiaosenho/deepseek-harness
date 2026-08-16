# Agent Note: Electron 设置与 FRP 远程访问

Status: implemented

[English](2026-08-15-electron-settings-frp-remote-access.md) | 中文

## 问题

Electron 桌面宿主机可以把自有 WebUI 暴露给可信 LAN，但该网络之外的设备无法通过操作人员自有的 `frps` 服务器访问它。LAN 流程还把所有控件都放在原生菜单和对话框中，无法呈现可配置反向隧道所需的服务器、端口、可执行文件、token、公网 origin 和传输风险字段。

增加 FRP 不只是一项连接设置。Electron 必须让 WebUI 继续监听 loopback，只在提供新 Harness bearer 时接纳公网 Host authority，要求可能经隧道到达的 loopback Host 提供另一个由 main 持有的 bearer，区分这两个每次开启生成的值与持久化 `frps` 认证 token，在披露 URL 前证明所选 TCP 代理已经发布，并在撤销该模式前停止两个自有进程树。公网 TCP 代理还会让既有明文警告更加重要，因为公网流量会经过路径中面向浏览器的部分。

## 决策

这项决策只在两个方面部分取代 [Electron LAN 访问决策](2026-08-14-electron-lan-access.md)：远程访问控件不再只存在于原生界面，而会提供给受管理的 loopback renderer；Electron 远程访问也不再局限于可直接到达的 LAN。该 Note 仍负责新 Harness bearer 的生成、fragment 到 cookie 的交付、token 授予的宿主机权限、替代进程回滚、关闭顺序及剪贴板残留。本 Note 把这些规则扩展到设置 renderer 与 FRP 进程。

本决策还只在“排除所有 preload 并否决窄远程访问 bridge”这一点上取代 [Electron Web 宿主决策](../architecture/2026-08-14-electron-web-profile-host.md)：Electron 现在会在其自有 loopback renderer 中安装受限的桌面 bridge。宿主决策仍负责应用组合、进程所有权、导航、sandbox、打包与外部 URL 模式。本决策也只在“更新展示仅由原生界面负责、update 状态与方法不进入 preload，并否决 WebUI 更新控件”这些方面取代 [PocketBase OTA 决策](2026-08-14-electron-pocketbase-ota-updates.md)：受管理 renderer 现在展示已脱敏的更新状态，并把检查与安装委托给 main。OTA 决策仍负责发布选择、制品信任、下载、安装及关闭顺序。

### 受管理 renderer 控件

只有完整的 `window.dshElectron` preload API 存在时，`@deepseek-ai/dsh-client-ui-desktop-electron` 才会贡献「远程连接」设置、「通用」设置中的软件信息，以及侧边栏更新标记。Electron 只为其自有 WebUI 窗口安装该 preload。通用浏览器、远程 LAN 与 FRP 页面，以及 `DSH_ELECTRON_URL` 模式都不会获得该 bridge 或这些贡献。原生菜单命令仍是一条备用的本地控制路径。

Electron main 会根据当前 `BrowserWindow`、其 main frame 和当前应用 origin 授权每次 bridge 调用。renderer 只会收到已脱敏桌面状态：公网 endpoint 不含 token fragment，可选 `frps` token 则只表示为 `authTokenConfigured`。token 修改通过明确的保留、替换或清除操作跨越 IPC。复制连接 URL 会调用 main 进程剪贴板写入，并且只返回成功或失败，因此公网 Harness bearer 绝不会返回 renderer 状态。FRP 会使用另一个不同的本地 bearer，因为透明 TCP 代理会让公网客户端在 WebUI 看来也是 loopback peer。Main 会在加载本地 renderer 之前把该值安装为 `HttpOnly` 的 `/api` cookie；它不会跨越 preload bridge，也不会进入 renderer 可读的 JavaScript 状态。

远程访问偏好会持久化到 Electron 用户数据目录下带版本号且仅所有者可读的 JSON 文件中，开启状态与每次开启生成的公网和本地 Harness bearer 则不会持久化。Electron 使用 `safeStorage` 加密可选的 `frps` token；操作系统 secret store 无法保护它时，保存或加载会失败。只有控制器在 loopback 模式下完全停稳后，设置修改才会被接受，从而防止显示中的活动 endpoint 与进程配置发生偏离。

### FRP 发布

FRP 模式可在 macOS 与 Linux 上启用。它让 Electron 自有 WebUI 继续监听 `127.0.0.1`，并把经过校验的公网 authority 加入 `trustedHosts`。Windows 会保留配置，但会在停止当前 loopback 后端之前拒绝开启 FRP，因为其 WebUI 与 `frpc` 进程树尚无持久的 Job Object 所有权。表单会存储裸 `serverAddress`、`serverPort`、固定或自动 `remotePort`、可选 `publicOrigin`、`frpc` 可执行文件、必填 TLS 可信 CA 文件、可选证书服务器名、可选 `frps` token，以及明确的明文风险确认。默认值为控制端口 `7000`、自动公网端口 `0`、无 token、无独立 origin，并使用可执行文件 `frpc`；操作人员仍必须提供公网 IP 或 hostname，以及签发 `frps` 证书的 CA。证书服务器名留空时根据 `serverAddress` 校验，明确填写则支持证书 DNS 身份与连接地址不同的部署。独立公网 origin 必须使用固定公网端口。

Electron 使用系统提供的 `frpc`，既不打包也不下载该二进制。偏好文件不存在时，`DSH_ELECTRON_FRPC_PATH` 会提供首次运行默认值；否则默认通过 `PATH` 解析 `frpc`，后续启动则以已保存的可执行文件字段为准。所选二进制必须支持生成的 JSON 字段与带认证的 `/api/status` 响应；Electron 不会固定或协商 `frpc` 版本。子进程只会收到经过清理的父进程环境，其中排除了 `DSH_*` 和凭据特征变量，同时保留普通进程启动设置。

每次开启都会先创建使用新公网 Harness bearer 的特定模式 WebUI；FRP 还会创建另一个不同的本地 bearer，并把 Connection 插件配置为要求每个 loopback Host 提交该凭据。Main 进程通过两个独立的子进程专用环境字段传递它们，把两者都保留在 renderer 状态之外，并且只把本地 bearer 安装到受管理的 loopback cookie store。随后它会写入仅所有者可读的临时 `frpc.json`。该 JSON 包含 `serverAddr`、`serverPort`、`loginFailExit: true`、可选 token 认证、带 `trustedCaFile` 与已解析 `serverName` 的 TLS 控制传输、一个从 `127.0.0.1:LOCAL_PORT` 到所配置 `remotePort` 的加密 TCP 代理、console 日志，以及使用随机凭据的 loopback 状态服务器。因此 secret 不会进入 argv，但会存在于短生命周期私有文件中。Electron 执行 `frpc -c CONFIG`，轮询带认证的状态 API，并且只在该精确随机代理名报告 `status: "running"` 且提供可解析公网端口时才宣告就绪。登录成功日志、进程仍在运行或只有状态服务器都不足以证明就绪，返回的地址还会提供自动分配的端口。

认证、发布、端口冲突、端口不被允许、状态格式错误、进程退出和 20 秒就绪超时都会使切换失败。Electron 会先停止 `frpc`，再停止 WebUI，移除临时目录，然后执行既有替代进程回滚。在支持 FRP 的平台上，就绪后 leader 意外退出仍会等待完整进程树结束、移除私有目录并恢复 loopback 模式；清理失败时会保留所有权供以后再次停止，恢复失败则进入既有致命关闭流程。只有两个自有进程树都已停止时，正常关闭操作才会成功；无法完成清理时会进入致命流程，不会成为一次成功的关闭切换。Windows 的 `taskkill` 清理只接受零退出状态，绝不会把 leader 已退出当作整棵进程树已静默。

### 公网传输安全

每次开启 LAN 或 FRP 时都会创建新的公网 Harness bearer，并且只通过包含 `#dsh-access=TOKEN` 的完整 URL 发布它。已保存的 `frps` token 用于向操作人员的服务器认证 `frpc`，不会授权浏览器 API 调用；公网 Harness bearer 负责授权这些调用，并会随其 WebUI 进程停止而失效。FRP 使用的另一个本地 bearer 会认证 Electron 管理的 loopback renderer，并在离开 FRP 前移除。通过隧道发送 loopback Host 的调用方必须提供这个未知的本地 bearer；公网 bearer 无法代替它，因此明确限定为 loopback-only 的方法仍只对本地开放。只有公网 Host authority 时不授予任何权限。

生成的 `frpc` 配置会用必填 CA 与已解析证书服务器名认证 `frps` 控制端点，并为代理传输启用加密。这不会创建面向浏览器的 HTTPS，也不会让浏览器认证公网 endpoint。未设置 `publicOrigin` 时，Electron 会生成明文 `http://SERVER:ACTUAL_PORT` endpoint。配置 `publicOrigin` 只会改变显示的 URL 与受信任 Host authority；只有该 authority 的外部 TLS 终止服务确实转发到固定 FRP 端口时，`https://` 值才有效。公网明文访问必须明确确认风险，因为任何截获 bearer 的人都可以控制 Harness 宿主机。在真实 HTTPS origin 上，fragment 消费会给 API bearer cookie 增加 `Secure`，使 HTTP 降级无法收到它。

## 验证

Electron 覆盖会固定仅所有者可访问的后端监听、不同的公网与本地 bearer 保留在 main 中、本地 `HttpOnly` cookie 替换、配置校验与脱敏、IPC 调用方授权、经过认证的 `frpc` TLS 字段、清理后的子进程环境、带认证的状态就绪（包括自动端口与代理错误）、进程树等待、清理重试、停止顺序、回滚、意外退出恢复、Windows 在重启前拒绝开启，以及检查 Windows `taskkill` 结果。Connection 覆盖会固定：FRP 形式的 loopback peer 无法在不带 cookie 或只带公网 bearer 时通过伪造 loopback Host，而独立的本地 bearer 可以让受管理 renderer 通过 HTTP、WebSocket、共享 interceptor 与专用 RPC channel。客户端包覆盖会固定严格状态解析、bridge 命令串行化、切换轮询、条件注册、FRP 表单校验、脱敏 endpoint 渲染、main 持有的复制操作、更新状态，以及 preload 缺失时不产生任何贡献。浏览器覆盖会固定 HTTPS origin 上的 `Secure` 公网 bearer cookie。组装后的 Web overlay 会让 FRP 继续监听 loopback，并且只接纳所配置的公网 authority 与两类不同的当前 bearer。一个无密钥 Web 场景会加载真实 Host、客户端目录与已构建插件 bundle，再通过只替代 preload 的 fixture 对已配置和已开启的 FRP 设置状态生成快照，并证明任何 secret 都不会进入可见文本。

## 曾考虑的替代方案

**把所有控件都保留在原生菜单与对话框中。** 否决，因为包含多个字段的 FRP 配置及其校验需要稳定的设置界面。preload 仍只提供给自有 loopback renderer，并暴露命令而不是原生进程或剪贴板原语。

**在每个安装包中打包固定版本的 `frpc`。** 此实现予以否决，因为它会增加特定于平台的二进制发布、来源证明、版本和法律维护义务。使用系统二进制或明确路径会把这项责任留给操作人员，代价是需要在应用之外管理安装与兼容性。

**使用基于 PID 的 `taskkill` 所有权开启 Windows FRP。** 否决，因为 leader 可能先于清理退出，而后代继续存在于不同的进程祖先关系下。Windows FRP 必须在 WebUI 或 `frpc` 的任何后代启动前建立 Job Object，在 leader PID 之外持续持有它，并查询到活动进程数归零。

**只接受公网服务器 IP，并硬编码所有其他 FRP 值。** 否决，因为真实 `frps` 部署会改变控制端口、认证 token、证书身份、可信 CA、允许的公网端口和 HTTPS 终止 authority。要求提供 CA 可以防止这个可配置的系统二进制接受未认证的 TLS 控制服务器。

**解析 `frpc` 日志来判断就绪。** 否决，因为控制连接登录成功时，代理仍可能正在重试或已经被拒绝；日志文本不是状态协议，自动端口分配也需要报告的公网地址。带认证的 loopback API 可以提供指定代理的运行状态和端口。

**把任一 secret 返回 renderer。** 否决，因为设置界面只需要已脱敏配置和一项由 main 持有的原子复制操作。向动态组合的浏览器插件提供 `frps` token 或公网 Harness bearer 会扩大凭据暴露范围，却无法支持另一项必要操作。受管理窗口只需把本地 bearer 当作传输凭据，因此 Electron 会把它存入 `HttpOnly` cookie，而不是 JavaScript 状态。

**把 `https://` 公网 origin 当作 TLS 配置。** 否决，因为 URL 字符串无法安装证书或终止 TLS。它是对外部部署组件的声明，因此明文访问需要确认风险，HTTPS 仍是操作人员必须验证的责任。

## 后果

在 macOS 或 Linux 上，操作人员可以通过既有 `frps` 服务器发布 Electron 自有 Harness，前提是配置其公网地址及签发服务器证书的 CA。证书必须覆盖该地址或明确填写的证书服务器名。其他部署还必须配置匹配的控制认证、得到允许且已开放防火墙的公网端口，以及任何外部 HTTPS authority。应用无法在启动系统 `frpc` 之前判断其版本是否兼容，因此不兼容会表现为开启失败并执行回滚。Windows 可以保存相同偏好，但不能开启 FRP。

renderer 会获得桌面专属控件，但不会获得任何 secret 或通用 Electron 能力。两项 FRP 路径控件会调用按用途区分的 main 进程文件选择器；bridge 只返回一个所选绝对路径或取消结果，不暴露通用文件系统操作。保存偏好可以持久化经过加密的 `frps` token，而每次开启都会轮换公网 Harness bearer，FRP 还会轮换本地 bearer，每次关闭或重启也会撤销它们。开启、关闭与恢复都会替换 WebUI origin，并可能中断正在进行的工作。

Electron 会在每个桌面平台应用同时支持原生选择与目录浏览的 overlay。受管理的 loopback renderer 通过原生 helper 选择工作区，而经过认证的 LAN 与 FRP renderer 通过该 provider 的应用内浏览器选择同一宿主文件系统路径。因此远程流程不会调用仅限 loopback 的 `host.pickDirectory` RPC。

即使内部 FRP 链路启用了加密，原始 FRP TCP 发布从浏览器到公网 endpoint 的部分仍使用明文。没有真实且经过浏览器验证的 HTTPS 时，公网使用可能泄露宿主机控制 bearer 与所有应用流量；风险确认只会让该选择变得明确，不提供任何保护。这些桌面控件与隧道状态位于 Session 日志之外，不会增加模型可见输入。
