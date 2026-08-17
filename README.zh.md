# DeepSeek Harness Desktop

[English](README.md) | 中文

用 Electron 打包 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI 的桌面客户端。桌面壳在隐藏后台进程启动打包的 `dsh web`，并在原生窗口加载未经改动的 WebUI。Electron 不重实现 Web 服务器、API、会话、存储或插件运行时。

## 仓库结构

```
electron/               Electron 壳（本项目自有代码）
  src/                  main process、后台进程管理、自动更新
  tests/                壳单元测试
  vendor/               fork 独有 Web 包（桌面目录选择、DOCX 工具、简历预设）
deepseek-harness-web/   Web 内核 — git submodule，固定到 deepseek-ai/deepseek-harness 上游提交
```

本仓库的主体是桌面壳；Web 内核是固定版本的上游快照，通过 `workspace:` 依赖协议消费。壳开发见 [electron/README.md](electron/README.md)，内核见 [deepseek-harness-web/README.md](deepseek-harness-web/README.md)。

## 环境要求

| 项 | 版本 / 值 |
| --- | --- |
| Node.js | `^22.19.0` 或 `>=24.0.0`（继承自 Web 内核） |
| pnpm | `11.7.0`（Corepack 固定；执行 `corepack enable` 激活） |
| Git | `>= 2.26` |

### 目标平台

| 平台 | 架构 | 安装包 |
| --- | --- | --- |
| macOS | `arm64`（Apple Silicon） | DMG |
| Windows | `x64` | NSIS（可选安装目录、桌面与开始菜单快捷方式） |
| Linux | `x64`（electron-builder 默认） | AppImage / deb |

## 运行

### 源码运行

```sh
git clone --recurse-submodules <本仓库>
pnpm install
pnpm run dev:electron
```

`pnpm run dev:electron` 先构建固定版本的 Web 内核与桌面壳，再从仓库根目录启动 `dsh web` 打开桌面窗口。首次构建可能需要几分钟，后续构建会复用生成产物与 pnpm 包存储。用 `DSH_ELECTRON_CWD` 指定其他工作目录，或用 `DSH_ELECTRON_URL` 连接一个已在运行的 WebUI。

### 桌面应用

自包含的 Electron 应用启动同一 Web UI，并为 macOS 与 Windows 打包本地运行时。开发、自动更新、关于面板的上游更新检查与平台限制见 [electron/README.md](electron/README.md)。

## 打包

所有打包命令从仓库根目录运行，先构建 Web 内核（`build:web-kernel`）再打包壳。

```sh
pnpm run pack:electron        # 当前平台未打包应用，输出 dist/electron/<platform>-<arch>/
pnpm run dist:electron:mac    # macOS ARM64 DMG
pnpm run dist:electron:win    # Windows x64 NSIS
pnpm run dist:electron:linux  # Linux AppImage + deb
```

自动更新（PocketBase OTA + electron-updater）见 [electron/README.md](electron/README.md)。

## 同步 Web 内核

Web 内核是固定到上游 `deepseek-ai/deepseek-harness` 的 git submodule。拉取更新的上游版本：

```sh
pnpm run web-kernel:update    # 拉取上游、提升指针、验证 CLI 契约
```

或手动：

```sh
cd deepseek-harness-web
git fetch origin
git checkout <tag-or-commit>
cd ..
git add deepseek-harness-web
git commit -m "chore(web): bump deepseek-harness-web to <tag>"
```

壳的关于面板显示当前固定的内核提交，并可检查上游是否有更新。fork 独有功能挂在壳的 `electron/vendor/` + overlay 补丁上，上游升级不会影响它们（见 AGENTS.md）。

## License

[MIT](LICENSE)
