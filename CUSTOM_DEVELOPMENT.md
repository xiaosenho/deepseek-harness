# DeepSeek Harness 二次开发规范

本文是本仓库二次开发的分支、架构和交付规范。所有参与开发、评审和合并的人员都必须遵守本文；上游项目自身的贡献规则仍由 [AGENTS.md](AGENTS.md) 及其链接文档定义。

## 分支职责

- `master` 是 upstream 基线分支，只接受对应上游分支的快进同步。禁止在 `master` 上直接提交、合并二开功能、挑选二开提交或解决二开冲突。
- `main` 是二次开发的主分支，承载已经完成评审和验证的二开代码。所有二开功能最终只能合并到 `main`。
- 每项开发从最新的 `main` 拉出独立功能分支。一个分支只承担一个可独立评审和回滚的目标，不在同一分支混入无关修改。
- 功能分支不得合并到 `master`，也不得把未完成或未验证的修改直接推送到 `main`。
- 上游更新先同步到 `master`，再从最新 `main` 创建独立的同步分支，将 `master` 的更新合入该分支并完成验证，最后按普通变更流程合并到 `main`。

推荐使用能表达用途的短分支名，例如 `feature/<name>`、`fix/<name>` 或 `chore/<name>`。开始开发前更新 `main`，再创建功能分支：

```sh
git switch main
git pull --ff-only <fork-remote> main
git switch -c feature/<name>
```

开发完成后，通过代码评审将功能分支合并到 `main`。确认合并结果已经进入 `main` 后，删除本地和个人远端的功能分支：

```sh
git switch main
git pull --ff-only <fork-remote> main
git branch -d feature/<name>
git push <fork-remote> --delete feature/<name>
```

`<fork-remote>` 表示二开仓库的 Git remote；不得把上述推送或删除操作指向 upstream remote。

## 插件优先架构

DeepSeek Harness 遵循“一切皆插件”。开始修改 `packages/` 前必须阅读[架构说明](docs/architecture.zh.md)，并优先使用其中列出的服务、事件、注册表、配置层和其他扩展点。

除必要的客户端实现外，针对内核、服务端和 WebUI 框架的所有新增能力都必须以 Cordis 插件实现。禁止为了接入业务功能直接修改既有插件的内部流程、在核心模块中加入业务分支，或绕过插件系统维护并行的全局注册表和生命周期。

客户端例外仅限视图渲染、本地交互和对既有协议的客户端适配。会影响会话日志、模型输入、系统提示词、工具、命令、权限、持久化、服务端状态或跨客户端行为的逻辑不属于客户端例外，必须放入插件及其公开服务或事件中。Web Client Chat 的新展示类型使用 `ConversationNodeDefinition` 和对应的 keyed renderer 注册，不直接修改通用渲染流程。

现有扩展点不能满足需求时，先说明缺失的通用能力和预期使用者。对内核的必要修改只允许新增最小、可复用且可测试的扩展点；具体业务行为仍由独立插件提供。修改 `agent-loop` 必须同步更新[架构说明](docs/architecture.zh.md)。

插件之间通过 `ctx.<service>`、类型化事件和公开注册 API 协作，不依赖其他插件的私有实现。新的完整能力按照 Service Definition、Service Provider 和 Consumer 三种角色设计；角色可以位于同一包中，但不得只实现其中一端并让调用方依赖具体实现。

## 树外插件仓库与发布

面向团队复用或公开分发的业务插件属于树外插件，必须在独立 Git 仓库中维护，并以独立 npm 包发布。主仓库只接受多个插件共同需要的最小通用扩展点；禁止把业务插件源码、构建产物、专用配置或安装 profile 放入本仓库。组合包与 profile 的完整机制见[打包与安装插件](docs/user/develop/basic/publish.zh.md)。

`dsh plugin --profile <name> <args...>` 把包规格交给 profile 内的 pnpm，并根据安装包的 `dsh.bundle` manifest 激活配置层。DSH 不要求额外的插件商店登记；公开 npm 包提供最短且无需安装时构建的分发路径，Git 仓库和 tarball 作为可固定源码版本或离线交付的补充路径。

### 包结构

可通过 `dsh plugin` 安装的 TypeScript Web 插件至少包含预编译的 Node 入口、Web client bundle、`cordis.patch.yml`、类型声明、README 和许可证。`package.json` 使用发布文件白名单，并声明以下入口和 DSH manifest：

```json
{
  "name": "@owner/dsh-plugin-example",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/index.d.ts",
      "default": "./lib/index.js"
    },
    "./client": "./lib/client.cjs"
  },
  "files": ["lib/", "cordis.patch.yml", "README.md", "LICENSE"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-runtime"]
    }
  },
  "publishConfig": { "access": "public" }
}
```

`cordis.patch.yml` 中的插件行必须按 npm 包名引用入口，不能引用开发机源码路径。Web 插件同时提供 `exports["./client"]` 和 `dsh.client.platform: web`；`dsh.client.inject` 只列出 client bundle 实际使用的宿主 client 包。Cordis、DSH 和 React 等宿主包放在 `peerDependencies` 及匹配的 `devDependencies` 中，并从构建产物 externalize，避免安装第二套运行时。

Git 安装拉取源码，因此包必须提供可独立运行的 `prepare` 构建，用户还必须在目标 profile 的 `pnpm-workspace.yaml` 中按 pnpm 输出的确切包键授权 `allowBuilds`。npm 和 tarball 必须携带已构建的 `lib/`，安装时不得依赖仓库旁边的 monorepo、全局构建工具或开发机路径。

### 配置和跨端实现

设置面板、服务端插件和 Web client 使用同一组带判别字段的配置类型。验证器只要求共享字段和当前启用分支的字段：例如选择域名入口时验证域名，选择 IP 加端口入口时验证 IP 和端口；未选择或未启用的分支不得因空字段阻止整个插件树加载。当前启用配置中可在加载时确定的错误仍必须立即报告。

设置服务注册时必须保留已经持久化的配置，更新操作基于完整当前值产生下一份配置，不能用表单的局部 payload 覆盖未显示字段。配置保存、启用、禁用和重载必须走同一生命周期所有者；认证代理、监听端口、临时文件和 `frpc` 等子进程全部由 `ctx.effect()` 管理，disposer 等待资源真正停止。

远程访问类插件必须同时保护 HTTP 和 WebSocket，访问凭据不得进入日志、进程参数或公开配置。普通局域网 HTTP 页面不属于 secure context，不能假设 `crypto.randomUUID()` 等浏览器 API 存在；兼容处理应在插件自己的 client bundle 中完成，不得为一个树外插件修改 Harness WebUI 内核。

### 发布和验收

npm scoped 包名必须写成 `@owner/package`，对应安装命令也保留 `@`；`owner/repository` 是 GitHub 仓库路径，对应包规格为 `github:owner/repository#<commit>`。两种来源不得混写：

```sh
dsh plugin --profile web add @owner/dsh-plugin-example
dsh plugin --profile web add github:owner/dsh-plugin-example#<commit>
```

发布前运行插件仓库自己的类型检查、测试和构建，并用 `npm pack --dry-run --json` 检查文件清单。清单必须包含所有运行入口和 patch，且不得包含源码凭据、`.env`、IDE 配置、测试缓存或本地 profile。公共 scoped 包通过 registry 要求的强认证发布：

```sh
pnpm run typecheck
pnpm run test
pnpm run build
npm pack --dry-run --json
npm publish --access public
npm view @owner/dsh-plugin-example version
```

最终验收必须从公共 registry 安装，不能只验证本地 checkout 或 tarball。同一 profile 中先移除旧的本地 link 或旧包名，避免同一个插件 id 被两个组合包重复加载；随后安装精确版本，启动时使用空闲端口避免把端口占用误判为插件加载失败：

```sh
dsh plugin --profile web remove dsh-plugin-example
dsh plugin --profile web add @owner/dsh-plugin-example@0.1.0
dsh web --port <unused-port>
```

远程连接插件 [`@xiaosenho/dsh-plugin-remote-access`](https://www.npmjs.com/package/@xiaosenho/dsh-plugin-remote-access) 是该交付方式的参考实现，源码位于 [`xiaosenho/dsh-plugin-remote-access`](https://github.com/xiaosenho/dsh-plugin-remote-access)。它把设置 UI、认证代理、局域网入口、域名隧道、IP 加端口隧道和 `frpc` 生命周期保留在独立插件仓库中，用户通过 `dsh plugin --profile web add @xiaosenho/dsh-plugin-remote-access` 安装，主仓库不承载其业务实现。

## Cordis 开发前置要求

插件作者在设计和编码前必须完成 [Cordis 入门](docs/cordis-primer.zh.md)和 [Cordis 教程](docs/cordis-tutorial/index.zh.md)，并理解以下机制：

- Context、Service、`inject` 和 fiber 状态决定插件的依赖与加载时机；依赖缺失时插件处于 `PENDING`，不得通过手工启动顺序规避依赖声明。
- `emit`、`waterfall`、`parallel` 和 `serial` 具有不同的调度语义；waterfall 监听器在需要继续委托时必须调用 `next()`。
- `ctx.effect()`、`ctx.on()`、子插件和注册 API 把资源归属到插件；卸载和热重载依赖这些 effect 完整撤销注册和外部资源。
- 配置变更、热重载、显式释放或依赖服务消失都会触发卸载。插件必须支持重复安装、加载、卸载和重新加载，不能假设进程生命周期等于插件生命周期。

## 生命周期和故障隔离

### 安装与加载

- 模块导入不得启动定时器、连接、子进程、文件监听或写入全局状态；这些资源只能在插件加载后创建。
- 插件通过 `inject` 声明必需服务，通过可校验的 `Config` 声明部署可变参数。能够在加载时确定的错误必须立即报告，禁止以静默跳过、隐式默认值或稍后崩溃代替配置错误。
- 资源获取必须由 effect 管理。初始化中途失败时，已经创建的资源和注册必须由 Cordis 回收，不得留下部分可用的插件状态。
- 插件不得调用 `process.exit()`，不得覆盖进程级异常处理器，也不得把自身的加载失败转换为整个应用退出。

### 运行

- 事件监听器、定时任务、异步回调和外部输入处理必须在插件负责的边界内处理预期故障，记录可定位的插件名、操作和错误原因。一个插件的回调异常不得中断其他监听器或形成未处理的 Promise rejection。
- 错误隔离不能吞掉错误。配置错误、违反公开约定和无法继续提供服务的状态必须通过 Cordis 日志或插件状态明确暴露；可降级错误必须返回调用方能够识别的结果。
- 并发任务必须拥有明确的取消和完成语义。插件开始卸载后，不得继续发布事件、写入状态或调用已经释放的服务。

### 卸载

- 监听器和注册使用 `ctx.on()` 或返回 disposer 的注册 API；定时器、连接、watcher、子进程及其他 Cordis 未直接管理的资源使用 `ctx.effect()` 并返回 disposer。
- disposer 必须可重复安全执行，并等待插件拥有的异步工作真正停止。仅发送 abort、kill 或 close 请求但不等待完成，不算卸载完成。
- 必须先阻止新的回调和通知，再停止后台工作，最后释放其依赖资源。存在严格顺序的异步清理步骤放在同一个 disposer 中顺序等待。
- 卸载完成后不得残留监听器、定时器、后台任务、临时文件或全局注册。需要保留的持久化数据必须有明确的数据所有者、格式和清理策略。

生命周期、并发和 teardown 代码还必须遵循[防御性模式](docs/defensive-patterns.zh.md)。

## 开发与验收流程

1. 从最新 `main` 创建功能分支，确认需求应落在哪个已有扩展点，并说明客户端例外或新增扩展点的必要性。
2. 编写插件、配置和文档。非平凡修改按仓库规则添加 Agent Note；用户可见或模型可见行为同步更新真实示例和 keyless snapshot。
3. 为插件覆盖正常加载、依赖缺失、无效配置、运行错误、重复加载、热重载和卸载。涉及异步资源时验证卸载完成后没有残留工作，涉及故障时验证其他插件和应用仍可运行。
4. 按 [AGENTS.md](AGENTS.md) 和[测试策略](docs/testing.zh.md)运行与修改范围匹配的测试、类型检查、lint、文档检查和构建检查。只报告实际执行的命令与结果。
5. 提交评审前确认没有对 `master` 的二开提交、没有直接侵入内核或 WebUI 框架的业务逻辑、没有未受 effect 管理的资源，也没有未记录的模型可见输入。
6. 评审和验证通过后合并到 `main`，确认集成结果，再清理个人功能分支。

## 评审阻断条件

出现以下任一情况时不得合并：

- 目标分支不是 `main`，或变更把二开提交带入 `master`。
- 可以通过现有扩展点实现，却直接修改内核、WebUI 框架或其他插件的私有流程。
- 必要客户端开发承载了应由插件负责的服务端、模型、工具、会话或策略逻辑。
- 插件未声明服务依赖，注册或资源没有 disposer，卸载未等待异步工作结束，或热重载产生重复注册。
- 插件错误可能形成未处理异常、未处理 Promise rejection、进程退出或其他插件的生命周期中断。
- 缺少与风险匹配的测试、用户可见 snapshot、文档或非平凡变更所需的 Agent Note。
