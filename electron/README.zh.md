# `@deepseek-ai/dsh-electron`

[English](README.md) | 中文

DeepSeek Harness 的自包含 Electron 桌面应用。它会打包构建后的 `dsh` CLI、Web 前端和生产依赖树。启动时，Electron 运行时在隐藏后台进程中运行打包的 CLI，让 WebUI 在操作系统分配的端口上仅监听 loopback，等待既有的 `dsh web:` 就绪输出行，然后在原生窗口中加载该 URL。Electron 不会重新实现 Web 服务器、API、会话、存储或插件运行时。

## 开发

在仓库根目录运行：

```sh
pnpm run dev:electron
```

源码开发以仓库根目录作为 Web profile 的工作目录。打包应用默认使用当前用户的主目录。设置 `DSH_ELECTRON_CWD` 可选择其他初始工作目录。

设置 `DSH_ELECTRON_URL` 为 HTTP 或 HTTPS URL，可跳过后台命令并让窗口连接到已经运行的 WebUI。此模式会完全省略 Electron 专属设置项和原生应用菜单中的「Remote Access」部分；Electron 不会创建远程访问控制器、preload bridge 或凭据，外部 WebUI 负责自己的网络与认证策略。

公网 FRP 访问使用外部 `frpc` 可执行文件。首次运行时，Electron 默认通过其继承的 `PATH` 解析 `frpc`；也可以用 `DSH_ELECTRON_FRPC_PATH` 指定命令名或绝对路径。保存远程访问偏好后，以设置中的可执行文件字段为准。LAN 访问不需要 `frpc`。

## 自动更新

安装后的 macOS 应用会在首个窗口就绪后检查 `https://ota.xiaosenho.top/api/collections/app_releases/records`。查询会选择 `macos` 平台上 `version_code` 最大的记录；Electron 仍使用记录中的 SemVer `version` 判断它是否比已安装应用更新。源码运行绝不检查更新。在 Windows 与 Linux 分发路径强制实施经过认证的签名策略之前，这两个平台的打包版本同样会跳过 OTA。对于打包后的 macOS 应用，`DSH_ELECTRON_OTA_URL` 可替换 PocketBase 基础 URL；即使应用通过 `DSH_ELECTRON_URL` 使用外部 WebUI，该配置也生效，但它不会改变受信任的制品根地址。

原生「关于 DeepSeek Harness」面板会显示已安装版本。可从原生应用菜单选择「Check for Updates...」按需执行同一更新操作；正在进行的启动检查与手动检查会共用一次操作，已经下载的更新也不会再次下载。Electron 管理的本地窗口还会在设置中显示版本、更新状态、发布说明、检查操作和已准备更新的安装操作，并在产品标识旁显示更新标记。这些 renderer 控件调用一个窄 preload bridge，发布选择、下载、进程关闭和安装仍由 Electron main 负责。外部 WebUI 不会获得这些控件。

PocketBase 负责选择发布，Electron Builder 元数据负责描述并校验下载。记录中不含凭据的 HTTPS `file_url` 必须位于固定的 `https://application-1305333896.cos.ap-guangzhou.myqcloud.com/` 制品根地址下，并指向 macOS DMG。其目录还必须包含匹配的 `latest-mac.yml`，以及该元数据中列出的所有文件。由于 PocketBase 已经选择精确发布，Electron Builder 会关闭自动预发布 channel 检测。元数据版本必须等于 PocketBase `version`，必须包含 `file_url` 指向的精确制品，并且必须为每个候选文件提供规范的 SHA-512 校验和；所有候选文件都必须保留在该 HTTPS 目录中。任一检查失败时，更新器都会在下载前拒绝该发布。

创建或更新 `app_releases` 记录之前，先把完整的 Electron Builder 输出上传到制品目录。macOS 发布包括面向用户的 DMG、Squirrel.Mac 使用的 ZIP、`latest-mac.yml` 和生成的 blockmap。最后发布 PocketBase 记录，可防止客户端选择尚未完整上传的发布。

更新检查绝不延迟窗口启动。网络、记录校验、元数据或下载失败只会写入日志，正在运行的应用保持不变。可选发布会在后台下载，并在应用下一次正常退出时安装；下一次启动会运行新版本。`is_force: true` 的记录则会在下载就绪后立即停止并等待当前 WebUI 进程树退出，然后运行安装程序并重新启动 Electron。该进程树停止期间，重复退出请求仍会被阻止；关闭失败时应用保持运行，也不会调用安装程序。

ESM 主进程只在选中较新的 macOS 发布后加载 CommonJS `electron-updater` 包，并从该包的默认导出对象读取 `autoUpdater`。源码运行、不支持的平台以及没有较新发布的检查都不会加载更新器依赖。

PocketBase 写权限等同于发布选择权限，COS 写权限等同于可执行程序发布权限；两者都必须只授予发布操作人员。固定 COS 根地址可防止 PocketBase 记录把客户端重定向到任意下载主机。SHA-512 可以发现损坏或不匹配的制品，但制品与元数据共用同一个发布 authority，因此它不能替代平台代码签名。macOS 公开自动更新必须使用 Developer ID 签名并完成公证。以后启用 Windows 时必须配置签名证书和 Electron Builder `publisherName`；启用 Linux 则需要独立认证的软件包发布策略。下述未签名 macOS 流程仍只适用于手动测试安装，不能作为自动更新验收结果。

## 远程访问

Electron 每次启动时都会关闭远程访问，但会保留首选的 LAN 或 FRP 传输方式及其非运行时设置。在 Electron 管理的本地窗口中，打开「设置 > 远程连接」即可选择传输方式、在远程访问关闭时保存 FRP 设置，并在明确确认后开启或关闭访问。原生应用菜单中的「Remote Access」部分仍然可用；macOS 中该菜单位于「DeepSeek Harness」下，Windows 和 Linux 中位于「Help」下。开启或关闭访问会替换当前 WebUI 进程，等待请求的暴露方式就绪，再加载替代进程的新 loopback URL，使本地窗口无需手动刷新即可重新连接。

请求的暴露方式无法启动时，Electron 会尝试在新端口恢复先前模式，恢复成功后加载该 origin，并报告请求的模式未生效。如果当前进程无法安全停止、先前模式无法恢复，或窗口无法加载已经就绪的替代 origin，Electron 会显示原生致命错误，并在操作者确认后请求退出应用。只有自有 WebUI 与 `frpc` 进程树全部停止后，退出屏障才允许应用退出；清理失败时退出会继续受阻，以后再次请求退出时可以重试。在 Windows 上，失败的 `taskkill /T /F` 仍属于未解决的清理结果；仅有 leader 已退出不能证明其后代已经停止。

每次成功开启都会创建新的 72-bit 公网 Harness 访问 token，以及包含 `#dsh-access=TOKEN` 的完整 URL。FRP 模式还会创建另一个仅由 main 持有的 loopback token；Electron 会在加载本地窗口之前把它安装为 `HttpOnly` 的 `/api` 会话 cookie，因此通过隧道伪造 loopback Host 的请求既不能利用 loopback 免认证，也不能用公网 token 冒充本地窗口。设置页面只显示不含凭据的公网 endpoint；「复制完整链接」会请求 Electron main 把公网 bearer URL 写入操作系统剪贴板，不会把任一 token 返回 renderer。原生详情对话框与菜单也使用同一个由 main 持有的复制操作。完整 URL 绝不会进入 renderer 状态、原生窗口标题或菜单标签；可选的持久化 `frps` 认证 token 对 renderer 只表示为已配置或未配置标记。

远程浏览器会先让任何位于 `Path=/` 的旧 `dsh_remote_access` cookie 过期，把 fragment token 存入位于 `Path=/api` 的 `SameSite=Strict` 会话 cookie，在公网 origin 为 HTTPS 时增加 `Secure`，并在正式 WebUI 启动前尝试记录一个不含 token、按 origin 隔离的标记。随后，它会通过同源 replacement navigation 移除 token；session storage 不可用时则通过 `history.replaceState` 移除。初始 HTTP 请求不包含 URL fragment，该标记也不是凭据。Cookie 不按端口隔离：同一 IP 字面量或 hostname 其他端口上的 `/api` 服务仍可能收到 bearer，因此必须把所有这类服务纳入该凭据的部署信任范围。

必须使用包含 token 的完整 URL。裸公网 endpoint 可能可以加载静态应用外壳，但除非该浏览器已经持有当前 token cookie，否则其 API 与 WebSocket 请求会收到 403。有效 token 会让远程浏览器获得与 loopback 桌面窗口相同的可编程 Harness 宿主机访问权限，但桌面原生目录选择器除外；它仍包括会话、设置、凭据、打开宿主路径、模型发现、agent preset 创作及 agent 工具。上传读取远程浏览器中选择的文件，workspace 路径与应用内目录浏览器则指向桌面宿主机文件系统。

关闭访问会先停止公网传输，再停止其 WebUI 后端，然后启动仅监听 loopback 的替代进程，并在导航前移除由 main 持有的本地 cookie。该顺序会在应用报告远程访问已关闭之前使 URL 与两类凭据失效。再次开启会创建另一组 token 与 URL，重启 Electron 也会使旧凭据失效。`frpc` 意外退出时，Electron 会关闭远程访问并恢复 loopback 模式；恢复失败则进入上述致命关闭流程。

### LAN

LAN 模式让带认证的 WebUI 在操作系统分配的端口上监听所有接口，并根据第一个外部 IPv4 地址生成显示的 URL。远程设备必须与桌面位于预期的可信 LAN，操作系统防火墙也必须允许 DeepSeek Harness 在该可信或专用网络配置中接收入站连接。宿主有多个网络适配器时，显示的地址可能不属于该设备所在的 LAN；Electron 不提供网络接口选择器或 IPv6 地址。

### 公网 FRP

FRP 模式可在 macOS 与 Linux 上使用。它让 WebUI 继续绑定 `127.0.0.1`，并启动一个由系统提供的 `frpc` TCP 代理连接操作人员的 `frps` 服务器。Windows 会保留已保存的 FRP 设置，但会在停止当前 loopback WebUI 之前拒绝开启，因为 Electron 尚未通过持久的 Job Object 同时拥有两棵 Windows 进程树。需要安装兼容的 `frpc`，并让配置的可执行文件路径或 Electron 继承的 `PATH` 能够找到它；应用不会打包或下载该程序。该二进制必须支持此客户端使用的 JSON 配置、带认证的 loopback 状态 API、TCP 代理加密和自动公网端口报告。

设置表单接受裸公网服务器 IP 地址或 DNS hostname、`frps` 控制端口（默认 `7000`）、固定公网 TCP 端口或用于服务器分配的 `0`、可选的 HTTP 或 HTTPS 公网 origin、`frpc` 可执行文件、签发 `frps` TLS 证书的必填可信 CA 文件、可选证书服务器名，以及可选的 `frps` 认证 token。可执行文件与 CA 路径均为只读值，通过 Electron main 自有的原生文件对话框选择；取消对话框会保留当前草稿。证书必须覆盖所配置的证书服务器名；该字段留空时则必须覆盖服务器地址。固定公网端口必须得到 `frps` 允许，并能穿过服务器防火墙。独立公网 origin 必须搭配固定公网端口，因为 Electron 无法从自动分配结果推导外部可见端口。

未设置公网 origin 时，Electron 会在 `frps` 分配或确认代理端口后生成 `http://SERVER:ACTUAL_PORT`。设置 `publicOrigin` 只会改变公布给浏览器并受信任的 origin，不会安装证书或终止 TLS。只有真实的 HTTPS 终止服务会把该精确 authority 转发到所选 FRP 端口时，才能配置 `https://` origin。origin 留空或使用 `http://` 时，必须在设置中明确确认明文风险。

每次开启时，Electron 都会写入仅所有者可读的临时 `frpc.json`，使用经过清理的环境执行 argv 中不含 secret 的 `frpc -c`，并在停止或退出后移除该目录。配置会用所配置的 CA 与服务器名认证 `frps` TLS 证书、为 TCP 代理传输启用加密、生成随机代理名，并在 loopback 上启动带认证的状态服务器。FRP WebUI 即使收到 loopback Host 也要求仅由 main 持有的本地 token，因为 TCP 代理会让公网客户端在后端看来也是 loopback peer。只有 `/api/status` 报告该精确 TCP 代理处于 `running` 状态并提供公网地址时，Electron 才会报告隧道已就绪；成功登录服务器、匹配的日志行或仍在运行的进程都不足以证明就绪。发布失败、认证失败、公网端口冲突或不被允许、无法使用的状态响应，或 20 秒就绪超时都会使开启操作失败，并进入上述回滚流程。无论明确停止还是 leader 意外退出，Electron 都会等待完整 `frpc` 进程树结束，再释放其私有配置。

## 打包

为当前平台构建未封装应用：

```sh
pnpm run pack:electron
```

构建 macOS ARM64 DMG 安装包：

```sh
pnpm run dist:electron:mac
```

构建 Windows x64 NSIS 安装程序：

```sh
pnpm run dist:electron:win
```

输出位于 `dist/electron/`。两个平台均使用 DeepSeek Harness 产品图标。Windows 安装程序提供安装目录选择，并创建桌面和开始菜单快捷方式。安装后的应用不要求目标机器具备 Harness 代码检出目录、Node.js 或 pnpm；公网 FRP 模式另外需要上述由系统提供的 `frpc`。安装包会在 `resources/legal/` 中携带 Sharp/libvips 声明以及完整的 LGPL/GPL 文本；Sharp 平台包或组件版本发生变化时，发布操作人员必须核验固定的源码链接并更新这些材料。[Sharp Windows 分发决策](../../.agents/notes/implemented/process/2026-08-14-electron-sharp-lgpl-distribution.md)记录了这项精确授权。签名、macOS 公证和发布仍属于发布工作。

### 未签名 macOS 测试包

在配置发布签名和公证之前，macOS DMG 是 ARM64 测试包。接收者将 `DeepSeek Harness.app` 从 DMG 复制到 `/Applications` 后，如果确认该包可信，可以移除下载隔离属性、应用本地 ad-hoc 签名并启动应用：

```sh
uname -m
sudo xattr -cr "/Applications/DeepSeek Harness.app"
sudo codesign --force --deep --sign - "/Applications/DeepSeek Harness.app"
open "/Applications/DeepSeek Harness.app"
```

`uname -m` 必须输出 `arm64`；该构建不能在 Intel Mac 上运行。这些命令会为当前本地副本绕过“门禁”的已下载应用保护，只能用于接收者信任其来源和校验和的安装包。公开分发仍需 Developer ID 签名和 Apple 公证。

桌面窗口通过 Electron main 打开操作系统原生目录选择器。Web 宿主子进程经其私有父进程 IPC 通道发送带关联 id 的请求；Electron 为对话框启动专用 helper 进程，使调用方取消或应用退出时既能终止选择器，也能释放请求。在 Windows 上，该路径会避开与打包后 Electron Node 运行时不兼容的 Koffi/COM worker。在所有受支持平台上，受管理的 loopback renderer 使用原生交互，而通过 LAN 或 FRP 连接且已认证的浏览器使用应用内宿主文件系统浏览器；远程调用方绝不会调用仅限 loopback 的 `host.pickDirectory` 方法。

在 Apple Silicon 上交叉构建 Windows 安装程序需要 Rosetta 2，因为 electron-builder 内置的 NSIS 编译器是 x86_64 macOS 可执行文件。工作区会安装打包 Harness 运行时所需的 Windows x64 可选原生依赖。

## 进程与安全模型

Electron 主进程负责窗口、一个后台 WebUI 进程树，以及一个可选的 `frpc` 进程树。WebUI 子进程使用打包的 Electron 可执行文件以 Node 模式运行打包的 CLI，并使用操作系统分配的端口。Loopback 与 FRP 模式让该子进程继续监听 loopback；LAN 模式应用 Electron 专属全接口 overlay。FRP 会为 loopback 子进程增加使用公网 token 的 authority 和另一个单独受 token 保护的本地 authority，再通过 `frpc` 发布。每个替代进程就绪后，Electron 会先准备本地 cookie，窗口再加载新的 loopback URL。应用退出使用有界的进程树终止；无法证明操作系统原语已成功的清理操作会继续保留所有权并阻止退出。通用命令 `dsh web --host 0.0.0.0` 仍不受支持。

普通 loopback 模式与 LAN 模式的本地侧不要求 Electron 访问 token。开启远程访问的进程要求非 loopback `/api` HTTP、RPC 与 WebSocket 流量提供当前公网 token。FRP 还会要求 loopback authority 提供另一个本地 token；Electron main 会为自有窗口安装对应的 `HttpOnly` cookie，而原始隧道请求无法从公网 URL 推导它。有效公网 token 会让远程受信任 authority 获得与普通 loopback 相同的宿主机访问权限，但 `host.pickDirectory` 等明确限定为 loopback-only 的方法除外；token 可用的权限仍包括设置、凭据、打开宿主路径、agent preset 创作、`llm.discoverModels` 及已注册的 loopback-authority RPC。只有已配置的 `trustedHosts` 条目而没有有效 token，仍只提供 DNS rebinding 防御，不授予任何额外权限。

LAN 监听器以及未配置外部 HTTPS origin 的 FRP endpoint 使用明文 HTTP。可信 CA 只让 `frpc` 认证 `frps` 控制端点，代理加密也只保护客户端到服务器的 FRP 链路；两者都不会加密浏览器到公网 endpoint 的 HTTP 请求，也不会在那里安装浏览器信任的认证。Harness token 是等同于控制宿主机的 bearer secret：任何看到完整 URL、在复制后读取桌面剪贴板、在传输途中捕获 cookie，或控制另一个会收到该 cookie 的同宿主 `/api` 服务的人，都能操作 agent、读取或修改其暴露的配置与凭据，并以桌面用户的操作系统账户调用宿主机工具。关闭访问或 Electron 退出后，已复制的 URL 仍可能留在操作系统剪贴板或同步剪贴板中；使用后应将其覆盖。关闭访问或重启 Electron 会使该 URL 失效，但不会清空剪贴板。LAN 模式只能用于通过客户端隔离排除不可信对端的可信网络。公网 FRP 运行需要经过浏览器验证的 HTTPS 终止，才能提供机密性与面向浏览器的服务器认证；明文风险确认只记录操作者接受了风险，并不会降低风险。[Electron token 宿主机权限决策](../../.agents/notes/implemented/feature/2026-08-14-electron-token-host-authority.md)记录了这条权限规则。

renderer 禁用 Node 集成，启用上下文隔离和 Chromium 沙箱，也不启用 WebView。Electron 管理的本地 renderer 会获得一个窄 preload bridge，用于读取已脱敏的桌面状态，并调用明确的远程访问、剪贴板和更新命令。Main 会根据当前窗口、main frame 与当前 loopback origin 授权每次 IPC 调用。该 bridge 绝不会返回任一 Harness bearer 或已保存的 `frps` token；它只返回不含凭据的 endpoint 与认证 token 是否已配置，复制命令则由 Electron main 写入完整公网 URL。本地 bearer 是 `HttpOnly` cookie，不属于 bridge 状态或 renderer 可读的 JavaScript 状态。普通 WebUI 部署、远程浏览器和 `DSH_ELECTRON_URL` 模式不会获得 bridge 或 Electron 专属控件。目录选择 IPC 只存在于 Electron 自有的 Web 宿主子进程与 main 进程之间，不向浏览器插件暴露。应用窗口只允许导航到精确的当前 WebUI origin。其他 origin 的 HTTP 和 HTTPS 链接交给操作系统浏览器打开；其他 scheme 会被拒绝。

Electron Chromium 数据使用独立的 `DeepSeek Harness` 应用数据目录。远程访问偏好保存在该目录内仅所有者可读、带版本号的 JSON 文件中；Electron 通过操作系统 secret store 加密可选的 `frps` token，无法加密时会失败，而不会以明文持久化。开启状态与每次开启生成的公网和本地 Harness bearer 绝不会持久化。Harness 会话、设置、凭据、profile 与工作区行为仍由 `dsh web` 负责。

## 模型体验

桌面窗口不增加模型可见输入。模型收到的 Web 界面上下文和会话日志与 `dsh web` 相同。
