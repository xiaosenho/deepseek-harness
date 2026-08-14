# `@deepseek-ai/dsh-electron`

[English](README.md) | 中文

DeepSeek Harness 的自包含 Electron 桌面应用。它会打包构建后的 `dsh` CLI、Web 前端和生产依赖树。启动时，Electron 运行时在隐藏后台进程中运行打包的 CLI，让 WebUI 在操作系统分配的端口上仅监听 loopback，等待既有的 `dsh web:` 就绪输出行，然后在原生窗口中加载该 URL。Electron 不会重新实现 Web 服务器、API、会话、存储或插件运行时。

## 开发

在仓库根目录运行：

```sh
pnpm run dev:electron
```

源码开发以仓库根目录作为 Web profile 的工作目录。打包应用默认使用当前用户的主目录。设置 `DSH_ELECTRON_CWD` 可选择其他初始工作目录。

设置 `DSH_ELECTRON_URL` 为 HTTP 或 HTTPS URL，可跳过后台命令并让窗口连接到已经运行的 WebUI。此模式会完全省略原生应用菜单中的「Remote Access」部分；Electron 不会创建远程访问控制器或凭据，外部 WebUI 负责自己的网络与认证策略。

## 自动更新

安装后的 macOS 应用会在首个窗口就绪后检查 `https://ota.xiaosenho.top/api/collections/app_releases/records`。查询会选择 `macos` 平台上 `version_code` 最大的记录；Electron 仍使用记录中的 SemVer `version` 判断它是否比已安装应用更新。源码运行绝不检查更新。在 Windows 与 Linux 分发路径强制实施经过认证的签名策略之前，这两个平台的打包版本同样会跳过 OTA。对于打包后的 macOS 应用，`DSH_ELECTRON_OTA_URL` 可替换 PocketBase 基础 URL；即使应用通过 `DSH_ELECTRON_URL` 使用外部 WebUI，该配置也生效，但它不会改变受信任的制品根地址。

原生「关于 DeepSeek Harness」面板会显示已安装版本。可从原生应用菜单选择「Check for Updates...」按需执行同一更新操作；正在进行的启动检查与手动检查会共用一次操作，已经下载的更新也不会再次下载。Electron 会通过原生对话框报告结果。版本与更新命令都保留在 Electron main 中，不会暴露给 WebUI renderer。

PocketBase 负责选择发布，Electron Builder 元数据负责描述并校验下载。记录中不含凭据的 HTTPS `file_url` 必须位于固定的 `https://application-1305333896.cos.ap-guangzhou.myqcloud.com/` 制品根地址下，并指向 macOS DMG。其目录还必须包含匹配的 `latest-mac.yml`，以及该元数据中列出的所有文件。由于 PocketBase 已经选择精确发布，Electron Builder 会关闭自动预发布 channel 检测。元数据版本必须等于 PocketBase `version`，必须包含 `file_url` 指向的精确制品，并且必须为每个候选文件提供规范的 SHA-512 校验和；所有候选文件都必须保留在该 HTTPS 目录中。任一检查失败时，更新器都会在下载前拒绝该发布。

创建或更新 `app_releases` 记录之前，先把完整的 Electron Builder 输出上传到制品目录。macOS 发布包括面向用户的 DMG、Squirrel.Mac 使用的 ZIP、`latest-mac.yml` 和生成的 blockmap。最后发布 PocketBase 记录，可防止客户端选择尚未完整上传的发布。

更新检查绝不延迟窗口启动。网络、记录校验、元数据或下载失败只会写入日志，正在运行的应用保持不变。可选发布会在后台下载，并在应用下一次正常退出时安装；下一次启动会运行新版本。`is_force: true` 的记录则会在下载就绪后立即停止并等待当前 WebUI 进程树退出，然后运行安装程序并重新启动 Electron。该进程树停止期间，重复退出请求仍会被阻止；关闭失败时应用保持运行，也不会调用安装程序。

PocketBase 写权限等同于发布选择权限，COS 写权限等同于可执行程序发布权限；两者都必须只授予发布操作人员。固定 COS 根地址可防止 PocketBase 记录把客户端重定向到任意下载主机。SHA-512 可以发现损坏或不匹配的制品，但制品与元数据共用同一个发布 authority，因此它不能替代平台代码签名。macOS 公开自动更新必须使用 Developer ID 签名并完成公证。以后启用 Windows 时必须配置签名证书和 Electron Builder `publisherName`；启用 Linux 则需要独立认证的软件包发布策略。下述未签名 macOS 流程仍只适用于手动测试安装，不能作为自动更新验收结果。

## 通过 LAN 用手机访问

Electron 每次启动时都会关闭远程访问。在原生应用菜单中选择「Remote Access > Start Remote Access...」；macOS 中该菜单位于「DeepSeek Harness」下，Windows 和 Linux 中位于「Help」下。原生确认对话框会说明 WebUI 将重新启动，以及任何获得连接 URL 的人都能控制 Harness 宿主机。确认后，Electron 会停止仅监听 loopback 的后台进程，在操作系统重新分配的端口上启动一个带认证的全接口监听器，等待它就绪，再加载替代进程的新 loopback URL。WebUI 会重新建立连接，不需要手动刷新。

请求的监听器无法启动时，Electron 会尝试在新端口恢复先前模式，恢复成功后加载该 origin，并报告模式没有改变。如果当前进程无法安全停止、先前模式无法恢复，或窗口无法加载已经就绪的替代 origin，Electron 会显示原生致命错误。操作者确认该对话框后，Electron 会请求退出应用；退出屏障会执行清理，并且只在自有 WebUI 进程树停止后才允许进程退出。清理尝试失败时，退出会继续受阻；以后再次请求退出时可以重试。再次打开应用时，会启动新的仅监听 loopback 的后台，远程访问保持关闭。

远程访问启动后，Electron 会打开原生连接详情对话框，显示形如 `http://192.168.1.20:43127/#dsh-access=TOKEN` 的完整 URL，并提供「Copy URL」操作。监听器运行期间，「Remote Access」菜单还会提供「Show Connection Details...」和「Copy Connection URL」。URL 与剪贴板写入均由 Electron main 负责；完整 URL 绝不会进入自管 renderer、原生窗口标题或任何菜单标签。让手机连接同一个可信 LAN，再打开该完整 URL。浏览器会先让任何位于 `Path=/` 的旧 `dsh_remote_access` cookie 过期，把 fragment token 存入位于 `Path=/api` 的 `SameSite=Strict` 会话 cookie，并尝试只为根页面记录一个不含 token、按 origin 隔离的标记。写入成功时，浏览器会以不含 token、但保留相同 path、query 与其余 fragment 参数的 URL 执行同源 replacement navigation。替代文档只在这些写入完成后才开始启动，因此首批受保护 API 与 WebSocket 连接会携带该 cookie。如果 session storage 不可用或拒绝写入，浏览器会改用 `history.replaceState` 清理当前 URL，并保留当前文档，让本次 load 继续持有本地 Host-authority 提示。标记本身不是凭据。

Cookie 不按端口隔离。`/api` path 会收窄该 bearer 的发送范围，但同一 IP 字面量或 hostname 其他端口上的 `/api` 服务仍可能收到它。必须把所有这类服务纳入该凭据的部署信任范围。

必须使用包含 `#dsh-access=TOKEN` 的完整 URL。裸 IP 与端口可能可以加载静态应用外壳，但除非浏览器已经持有当前 token cookie，否则其 API 与 WebSocket 请求会收到 403。有效 token 会让手机获得与 loopback 桌面窗口相同的 Harness 宿主机访问权限，但桌面原生目录选择器除外；它仍包括设置、凭据、打开宿主路径、模型发现、agent preset 创作及 agent 工具。上传文件时选择的是手机文件，而 Workspace 目录浏览器访问的是桌面宿主机的文件系统。

该 cookie 不设置持久化过期时间。关闭远程访问会停止 LAN 进程并启动仅监听 loopback 的替代进程，因此其 URL 与 cookie 会失效。再次开启会创建不同的 token 与 URL。重启 Electron 也会使旧 token 失效，并恢复到关闭状态。

原生连接详情对话框只使用操作系统报告的第一个外部 IPv4 地址。宿主有多个网络适配器时，该地址可能不属于手机所在的 LAN；Electron 不提供网络接口选择器。

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

输出位于 `dist/electron/`。两个平台均使用 DeepSeek Harness 产品图标。Windows 安装程序提供安装目录选择，并创建桌面和开始菜单快捷方式。安装后的应用不要求目标机器具备 Harness 代码检出目录、Node.js 或 pnpm。安装包会在 `resources/legal/` 中携带 Sharp/libvips 声明以及完整的 LGPL/GPL 文本；Sharp 平台包或组件版本发生变化时，发布操作人员必须核验固定的源码链接并更新这些材料。[Sharp Windows 分发决策](../../.agents/notes/implemented/process/2026-08-14-electron-sharp-lgpl-distribution.md)记录了这项精确授权。签名、macOS 公证和发布仍属于发布工作。

### 未签名 macOS 测试包

在配置发布签名和公证之前，macOS DMG 是 ARM64 测试包。接收者将 `DeepSeek Harness.app` 从 DMG 复制到 `/Applications` 后，如果确认该包可信，可以移除下载隔离属性、应用本地 ad-hoc 签名并启动应用：

```sh
uname -m
sudo xattr -cr "/Applications/DeepSeek Harness.app"
sudo codesign --force --deep --sign - "/Applications/DeepSeek Harness.app"
open "/Applications/DeepSeek Harness.app"
```

`uname -m` 必须输出 `arm64`；该构建不能在 Intel Mac 上运行。这些命令会为当前本地副本绕过“门禁”的已下载应用保护，只能用于接收者信任其来源和校验和的安装包。公开分发仍需 Developer ID 签名和 Apple 公证。

Windows 桌面窗口通过 Electron main 打开操作系统原生目录选择器。Web 宿主子进程经其私有父进程 IPC 通道发送带关联 id 的请求；Electron 为对话框启动专用 helper 进程，使调用方取消或应用退出时既能终止选择器，也能释放请求。该路径避开了与打包后 Electron Node 运行时不兼容的 Koffi/COM worker。loopback renderer 使用这一原生交互，经 LAN 连接的手机则继续使用应用内目录浏览器。macOS 和 Linux 继续使用 Web profile 的自适应选择器。

在 Apple Silicon 上交叉构建 Windows 安装程序需要 Rosetta 2，因为 electron-builder 内置的 NSIS 编译器是 x86_64 macOS 可执行文件。工作区会安装打包 Harness 运行时所需的 Windows x64 可选原生依赖。

## 进程与安全模型

Electron 主进程负责窗口和一个后台 WebUI 进程树。子进程使用打包的 Electron 可执行文件以 Node 模式运行打包的 CLI，并使用操作系统分配的端口。默认模式只监听 loopback；开启远程访问时，该进程会被应用 Electron 专属全接口 overlay 的子进程替代，关闭时又会被另一个仅监听 loopback 的进程替代。每个替代进程就绪后，窗口都会加载其新的 loopback URL。应用退出时会通过有界升级终止并等待完整进程树停止。通用命令 `dsh web --host 0.0.0.0` 仍不受支持。

Loopback `/api` HTTP 与 RPC 请求及 WebSocket 流量不需要 Electron 访问令牌。开启远程访问的进程要求非 loopback `/api` 流量提供当前 token。有效 token 会让其受信任 LAN authority 获得与 loopback 相同的宿主机访问权限，但 `host.pickDirectory` 等明确限定为 loopback-only 的方法除外；token 可用的权限仍包括设置、凭据、打开宿主路径、agent preset 创作、`llm.discoverModels` 及已注册的 loopback-authority RPC。只有已配置的 `trustedHosts` 条目而没有有效 token，仍只提供 DNS rebinding 防御，不授予任何额外权限。

LAN 监听器使用明文 HTTP，不提供 TLS。该令牌是等同于控制 Harness 宿主机的 bearer secret：任何在原生详情对话框中看到完整 URL、在复制后读取桌面剪贴板、在传输途中捕获 cookie，或控制另一个会收到该 cookie 的同宿主 `/api` 服务的人，都能操作 agent、读取或修改其暴露的配置与凭据，并以桌面用户的操作系统账户调用宿主机工具。关闭远程访问或 Electron 退出后，已复制的 URL 仍可能留在操作系统剪贴板或同步剪贴板中；使用后应将其覆盖。关闭远程访问或重启 Electron 会使该 URL 失效，但不会清空剪贴板。只能在手机与桌面连接到预期 LAN 的可信公司网络中使用此访问方式。保持操作系统防火墙开启，但需要允许 DeepSeek Harness 在可信或专用网络配置中接收入站连接，否则手机无法访问监听器。网络中存在不可信对端时，应使用客户端隔离或等效网络控制。不要通过公共 Wi-Fi、端口转发或不可信反向代理暴露该端口。[Electron token 宿主机权限决策](../../.agents/notes/implemented/feature/2026-08-14-electron-token-host-authority.md)记录了这条权限规则。

renderer 禁用 Node 集成，启用上下文隔离和 Chromium 沙箱，也不启用 WebView。它不会获得远程访问 preload 或 renderer IPC bridge。原生应用菜单、确认与详情对话框、控制器状态和剪贴板写入都留在 Electron main；完整 bearer URL 只会通过原生详情对话框与操作系统剪贴板披露，绝不会进入 renderer、原生窗口标题或菜单标签。因此普通 WebUI 部署和手机浏览器不会获得 Electron 专属远程控制，`DSH_ELECTRON_URL` 模式也会省略「Remote Access」菜单。目录选择 IPC 只存在于 Electron 自有的 Web 宿主子进程与 main 进程之间，不向浏览器插件暴露。应用窗口只允许导航到精确的当前 WebUI origin。其他 origin 的 HTTP 和 HTTPS 链接交给操作系统浏览器打开；其他 scheme 会被拒绝。

Electron Chromium 数据使用独立的 `DeepSeek Harness` 应用数据目录。Harness 会话、设置、凭据、profile 与工作区行为仍由 `dsh web` 负责。

## 模型体验

桌面窗口不增加模型可见输入。模型收到的 Web 界面上下文和会话日志与 `dsh web` 相同。
