# @deepseek-ai/dsh-client-ui-desktop-electron

[English](README.md) | 中文

Electron 专属的桌面远程访问与应用更新浏览器控件。Host 入口刻意保持为空；只有受管理本地窗口暴露完整的 `window.dshElectron` preload API 时，`/client` 插件才会注册。通用 WebUI 部署、远程浏览器，以及指向 `DSH_ELECTRON_URL` 的 Electron 窗口都不会获得这些贡献。

## 贡献项

该插件贡献「远程连接」设置分区，操作人员可以在其中选择 LAN 或公网 FRP、仅在访问关闭时编辑 FRP 偏好、确认每次开启或关闭操作、查看不含凭据的公网 endpoint，并请求 Electron main 复制完整 bearer URL。`frpc` 可执行文件与必填可信 CA 使用用途固定的原生文件选择器；对应路径框只读，取消选择不会修改草稿，而且选择器只存在于受管理的本地窗口。表单会先校验裸服务器地址、控制端口与公网端口、可选公网 origin、所选文件、可选证书服务器名、明确的认证 token 操作及明文风险确认，再发送一次完整配置更新。[Electron 应用 README](../../../apps/electron/README.md#remote-access)负责说明传输行为、`frpc` 要求、失败恢复与安全指南。

该插件还会向通用设置贡献「软件信息」，并在侧边栏产品标识旁贡献更新标记。两者都投影 Electron main 的更新器状态。「软件信息」行会显示已安装版本、当前状态、发布说明、手动检查和已准备更新的安装操作；只有更新已经准备好时才会显示标记，打开后提供相同的发布说明和安装操作。

## Preload API

`ElectronDesktopBridge` 是 Electron main、沙箱化 preload 与该客户端插件共享的 JSON-safe 接口。`DesktopControlController` 会校验每个返回字段、串行执行 renderer 命令，并且只在远程访问已开启或正在切换，或者正在检查更新时按 1 秒间隔轮询。bridge 读取失败会让这些贡献进入失败状态，不会接受不完整或格式错误的响应。

Electron main 仍负责后端替换、FRP 原生文件对话框、配置持久化、secret 加密、剪贴板写入、更新下载与安装。Bridge 只接受两种文件用途，并返回所选绝对路径或取消结果，不会暴露通用文件系统 API。renderer 只通过 `authTokenConfigured` 得知是否保存了 `frps` token，并发送明确的保留、替换或清除操作；它只会收到不含凭据的公网 endpoint。Electron main 写入当前包含 token 的 URL 后，`copyRemoteAccessUrl()` 只返回成功或失败；bearer 绝不会返回 renderer 状态。

## 模型体验

无，因为这个浏览器侧 Electron 设置与更新插件不注册任何模型可见内容。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **无推送通道** —— 控制器通过有界轮询观察 main 进程变化，因此隧道意外退出或更新器状态变化后，已加载页面最多需要一个轮询间隔才会显示新状态。
- **暴露期间不能修改配置** —— 必须先关闭远程访问，才能修改传输方式或 FRP 字段；每次开启或关闭都会重启 Electron 自有 WebUI，并可能中断正在进行的浏览器工作。
