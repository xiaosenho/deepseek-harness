# `@deepseek-ai/dsh-electron`

[English](README.md) | 中文

DeepSeek Harness 的最小 Electron 桌面外壳。它在隐藏后台进程中启动打包后的 `dsh web`，等待 loopback 就绪行，然后在安全的原生窗口中加载该 URL。Electron 只负责外壳：Web 服务器、API、会话、存储和插件运行时仍然是普通 `dsh` 进程。

外壳强制单实例，外部链接交给系统浏览器，并在退出前关闭它拥有的完整进程树。

## 内置运行时

打包产物包含完整 `dsh` 运行时闭包和 `pnpm` CLI。首次启动时，它会在 `<userData>/runtime-bin` 写入 `node` 和 `pnpm` shim，并把该目录前置到后台 `dsh web` 进程及其插件子进程的 `PATH`。shim 以 Node 模式运行打包后的 Electron 可执行文件，因此插件代码无需单独安装即可执行 `node --version` 和 `pnpm --version`。

Electron 43 内置 Node 为 v24.18.1，满足仓库的 `^22.19.0 || >=24.0.0` 引擎范围。macOS 上外壳还会把 `/opt/homebrew/bin` 等常见用户工具目录加入 WebUI 的 `PATH`，使从 Finder 启动的插件子进程仍能找到登录 shell 中安装的工具。

## 开发与验证

```sh
pnpm install
pnpm --filter @deepseek-ai/dsh-electron run build
pnpm --filter @deepseek-ai/dsh-electron run test
pnpm --filter @deepseek-ai/dsh-electron run pack
pnpm --filter @deepseek-ai/dsh-electron run dev
```

`DSH_ELECTRON_CWD` 可选择初始工作目录。`DSH_ELECTRON_URL` 可让窗口连接一个已在运行的 WebUI，而不是自己启动。

## dsh 命令行

菜单项 `安装 dsh 命令行...` 会在 `~/bin` 创建指向应用内置 dsh 运行时的 `dsh` shim，并把 `export PATH="$HOME/bin:$PATH"` 追加到 `~/.zshrc` 和 `~/.bash_profile`（只追加一次）。再次点击会提示已经安装。安装后请新开一个终端窗口。

## 更新

原生菜单保留中文 `检查更新...` 操作，窗口加载后也会在后台自动检查一次。发现可选更新时，应用会用中文对话框展示版本号和更新内容，由用户选择 `立即安装并重启` 或 `稍后`；下载在后台小状态窗中进行，主界面可继续使用。强制更新会弹出模态状态窗，在更新完成并重启前主界面不可操作。

当应用运行在 DMG 等只读卷上时，自动更新会被禁用，检查结果会提示先把应用拖入“应用程序”文件夹。

更新检查会查询 PocketBase `app_releases` 集合中与宿主平台匹配的最新记录，再把经过校验的 generic feed 目录交给 `electron-updater`。

PocketBase 发布记录必须提供：

- `platform`：`macos`、`windows` 或 `linux`
- `version`：与应用程序及平台 feed 完全一致的版本号
- `version_code`：用作降序排序键的非负整数
- `changelog`：字符串
- `is_force`：布尔值
- `file_url`：位于可信制品根目录下、后缀与平台更新制品匹配的 HTTPS URL

各平台 feed 和制品如下：

- macOS：`latest-mac.yml` 及其指明的 ZIP；`.zip.blockmap` 存在时用于差量下载，DMG 只是安装制品
- Windows：`latest.yml` 及其指明的 NSIS `.exe`
- Linux：`latest-linux.yml` 及其指明的 AppImage；`deb` 目标通过包管理器安装，不参与自动更新

外壳会显示带下载百分比的原生进度窗口。用户选择安装后，Electron 在停止后台 WebUI 进程并重启进入安装器期间会保持安装进度窗口可见。macOS 自动更新需要 Developer ID 签名并公证、且安装在 `/Applications` 中的构建；未签名的本地构建会被检测并提示为“未签名”，而不会启动 Squirrel.Mac 无法完成的更新。

测试时可设置 `DSH_ELECTRON_OTA_URL` 覆盖 PocketBase 源。

本模块不包含 LAN/FRP 远程访问、DOCX 简历导出或其他业务功能。
