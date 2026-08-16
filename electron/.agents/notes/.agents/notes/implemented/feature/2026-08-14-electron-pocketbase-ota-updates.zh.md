# Agent Note: Electron updates use PocketBase release selection

Status: implemented

[English](2026-08-14-electron-pocketbase-ota-updates.md) | 中文

## 问题

打包后的 Electron 应用需要在启动时发现对应平台的发布，在不延迟桌面窗口的情况下完成下载，并且只能在桌面宿主拥有的进程全部静止后安装。PocketBase 的 `app_releases` schema 提供版本与制品 URL，但不提供制品校验和、架构专属文件集或 Electron 安装程序元数据。直接执行该 URL 会重复实现各平台安装程序行为，并接受一个没有独立声明摘要的可执行文件。

## 决策

打包后的 macOS 应用会在首个窗口加载完成后查询 `https://ota.xiaosenho.top/api/collections/app_releases/records`。查询把 Electron 的 `darwin` 映射为 `macos`，再按 `version_code` 降序选择一条记录。源码运行不查询该服务。在 Windows 与 Linux 分发路径强制实施经过认证的签名策略之前，这两个平台的打包应用同样会跳过 OTA。`DSH_ELECTRON_OTA_URL` 可替换 PocketBase 基础 URL，但不会改变 collection 或记录字段。这项能力扩展了 [Electron Web 宿主](../architecture/2026-08-14-electron-web-profile-host.md)，同时保留[源码运行不拥有托管安装程序](../simplification/2026-08-10-source-run-without-managed-installer.md)的规则。

`version_code` 只用于记录排序。Electron Updater 会把记录中的 `version` 作为 SemVer，与属于 dsh 共享发布序列的已安装应用版本比较。系统禁止降级。客户端会校验有大小上限的 PocketBase JSON 响应，并且只接受更新操作所需的精确平台、PocketBase 记录 id、非负整数 `version_code`、boolean 类型的 `is_force`、字符串 `changelog`，以及不含凭据的 HTTPS `file_url`。制品 URL 必须保留在固定的 `https://application-1305333896.cos.ap-guangzhou.myqcloud.com/` 根地址下；修改 `DSH_ELECTRON_OTA_URL` 不会改变这项信任决策。

PocketBase 负责选择发布，但不描述可下载文件。DMG `file_url` 所在目录是 Electron Updater generic provider，其中包含 Electron Builder 的 `latest-mac.yml`。由于 PocketBase 已经选择精确发布，Electron Builder 会关闭自动预发布 channel 检测，因此预发布 SemVer 不会改变元数据文件名。下载前，客户端要求 provider 版本等于 PocketBase 版本，要求 provider 文件列表包含与 `file_url` 完全相同的 origin 和路径，要求所有候选文件保留在同一个 HTTPS 目录，并要求每个候选文件都带有规范的 SHA-512 值。之后，Squirrel.Mac 的下载与安装行为由 Electron Updater 负责。

ESM 主进程会在发布选择后按需加载 CommonJS `electron-updater` 包，并从该包的默认导出对象读取 `autoUpdater`。源码运行、不支持的平台以及没有较新发布的检查都不会加载该包。

Electron Builder 会同时生成 macOS DMG 与 ZIP，并为 COS 制品根目录生成 generic-provider 元数据。发布者先上传安装程序、必要的 ZIP、元数据与 blockmap，再发布 PocketBase 记录。该记录是发布提交点：在制品集完整之前写入记录，会使客户端判定该发布无效。

检查与下载在 WebUI 启动 promise 之外运行。失败只会写入日志，当前应用继续运行。可选发布使用 `autoInstallOnAppQuit`，因此现有桌面退出流程会先等待 WebUI 进程树停止，再应用待处理更新。`is_force: true` 的发布会在下载完成后立即请求安装；主进程先关闭当前 `RemoteAccessController` 或 `WebBackend`，再调用 `quitAndInstall()` 重新启动。同一个退出屏障会合并并发退出请求，只在关闭成功后允许 Electron 退出，并在关闭失败后允许重试。

版本与更新展示仍由原生 Electron 负责。应用 About 面板通过 `app.getVersion()` 读取已安装版本，应用菜单则调用与启动检查相同的更新控制器。该控制器会合并正在进行的检查，并保留已就绪结果以防止重复下载。手动检查结果通过原生对话框报告。任何更新方法或状态都不会经 preload bridge 进入 WebUI。

PocketBase 写权限等同于发布选择权限，COS 写权限等同于可执行程序发布权限；两者都只授予发布操作人员。固定 COS 根地址可防止 PocketBase 写入者把客户端重定向到任意主机。SHA-512 会把制品固定到所选元数据，但无法认证同时控制这两个对象的发布者。Squirrel.Mac 要求 Developer ID 签名，公开发布 macOS 版本还需要完成公证。Windows 会保持禁用，直到生产发布配置代码签名与 Electron Builder `publisherName`；Linux 也会保持禁用，直到具备独立认证的软件包发布策略。未签名的手动测试包不能证明自动更新受到支持。

## 考虑过的替代方案

**直接下载并执行 `file_url`。** 拒绝，因为单个 URL 无法表达 macOS ZIP、平台元数据、blockmap 或摘要，而且自定义安装程序执行会重复 Electron Updater 的平台生命周期。

**使用没有 PocketBase 的 Electron generic feed。** 拒绝，因为 `app_releases` 负责跨客户端发布选择、单调递增的 `version_code`、变更文本与强制策略。Electron Builder 元数据仍是从属的文件元数据，而不是第二套发布目录。

**让更新检查阻塞首个窗口就绪。** 拒绝，因为 OTA 可用性与本地 WebUI 相互独立。缓慢或不可用的发布服务不能导致已安装应用不可使用。

**立即安装每个已下载发布。** 拒绝，因为可选更新可能打断进行中的工作。只有明确的 `is_force` 策略会启动立即且有序的重启。

**在 WebUI 设置中增加版本与更新控件。** 拒绝，因为 OTA 只属于已安装的 Electron 宿主。renderer 控件会给通用 WebUI 增加 Electron 专属协议，并让可执行程序生命周期操作跨越 preload，却不能改善原生桌面流程。

## 后果

macOS 应用会在每次打包版本启动时检查一次更新，也支持通过原生菜单按需检查；它会在后台下载匹配的较新发布，在正常退出时安装可选发布，并在自有进程停止后为强制发布立即重启。原生 About 面板显示当前版本。更新状态位于 renderer 与会话日志之外，不会增加模型可见输入。

OTA bucket 必须为每个被选中的发布保留完整 Electron Builder 制品集。如果 PocketBase 记录所在目录缺少预期元数据或 ZIP，该记录虽然可见但不可使用；客户端会记录失败，不会回退到未校验的安装程序。

已安装旧版本到新版本的更新验收仍需目标平台的原生发布证据。单元测试覆盖 PocketBase 校验、元数据锚定、打包依赖的 CommonJS 导出布局、后台策略、强制策略与关闭顺序，但不能替代已签名并公证的 Squirrel.Mac 安装测试。
