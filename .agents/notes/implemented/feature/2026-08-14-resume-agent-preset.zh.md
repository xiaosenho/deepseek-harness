# Agent Note: 专用 preset 提供基于事实的简历创作

Status: implemented

[English](2026-08-14-resume-agent-preset.md) | 中文

## 问题

现有内置 preset 都是 coding agent（编程智能体）。简历任务需要不同的身份、事实完整性规则、对职位描述提示词注入的防护以及更小的能力集合；将这些指令加入部署 persona 会影响所有会话，而复制标准 preset 会暴露与简历工作无关的 Shell、网页、委派和编程指导。

简历修改还存在格式陷阱。通用文件系统工具读取 UTF-8 文本和受支持的光栅图像，而 DOCX 输入和保留布局的编辑需要专用解析器。直接交付 Word 文件仍需要确定性文档生成器，并且该生成器必须沿用现有文件系统策略，而不是通过宿主 I/O 或 Shell 转换绕过它。

## 决策

内置名单包含 `apps/cli/config/agent-presets/resume/`，并沿用 [agent preset](../architecture/2026-08-03-per-session-agent-presets.md) 所拥有的逐会话组合。其完整 persona 会在该作用域内替换编程身份，并要求每项表述都来自用户或所提供的文件。导入的简历文本和职位描述属于参考数据而非指令，建议与已确认事实保持区分，缺失且无法支持的信息会被报告而非虚构。

该 preset 只贡献 `@deepseek-ai/dsh-tool-fs`、`@deepseek-ai/dsh-tool-docx`、`@deepseek-ai/dsh-tool-skill` 和 `@deepseek-ai/dsh-tool-ask-user`。最终工具目录包含 `read`、条件启用的 `read_image`、`write`、`edit`、`export_docx`、`skill` 和 `ask_user_question`；其中不含 Shell、网页搜索、任务、目标、计划、委派及工作流工具。文件系统策略、持久图像附件、交互与分层注册表仍归 Host 所有。

3 个 preset 本地 skill（技能）分担模型工作流：`resume-authoring` 创建或编辑真实内容，`resume-tailoring` 将所提供职位描述映射到已有证据，`resume-review` 检查完整性、清晰度、一致性、ATS 可读结构和密度风险。本地文件系统 provider 设置 `includeDefaultRoots: false`，且只指定 preset 的 `skills/` 目录，从而阻止仓库和用户的编程 skill 进入此专用层。部署级 skill 仍通过[分层 skill 注册表](../architecture/2026-08-09-layered-skill-registry.md)合并。

`@deepseek-ai/dsh-tool-docx` 接受有界的结构化简历，并通过 `docx` 生成紧凑、单栏的 OOXML 文档。它使用新增的 `FileSystem.writeBytes` 原语发布完整归档，因此本地、沙箱化和 E2B 提供方会继续保留原子发布、写入意图、观察和路径约束行为。二进制写入共享 `FsWriteIntent`，但返回字节元数据而不是文本 diff 基础。该工具默认选择新的 `.docx` 路径，且不公开通用二进制写入或 Shell。

该 preset 可以创建或编辑 Markdown／纯文本，在当前模型支持图像输入时检查所提供的页面图像，并把最终内容导出为新的 Word 文档。它仍不能解析现有 DOCX 或 PDF，也不能保留其布局；对于二进制输入，指令会要求用户提供文本导出、粘贴文本或页面图像，并禁止声称已经检查不受支持的内容。会话日志之外不存在简历专用运行时状态：persona、工具 schema、结构化导出参数、skill 目录消息、skill 加载和文件工具调用全部复用现有日志路径。

## 验证

内置 Web 组合测试通过真实名单挂载 `resume`，并固定其完整 persona、精确的 7 工具目录、3 个作用域 skill、全局 skill 视图隔离和成功的 `resume-authoring` 加载。无密钥的 resume preset 快照通过真实 Loader 启动相同的 bundle 层，执行 `export_docx`，并记录模型可见的 persona、目录摘要、已加载的创作指令和生成的 ZIP 签名。提供方与工具测试覆盖二进制字节保真、沙箱拒绝、观察防护的替换、校验和 OOXML 归档签名；渲染后的 fixture 用于视觉检查内置版式。

## 考虑过的替代方案

**将简历指令加入标准 persona。** 这会让每个编程会话携带无关约束，并继续启用 Shell、网页、委派和工作区指令。逐会话 preset 已经提供所需隔离。

**复制完整的标准 preset 并添加简历 skill。** 额外能力会增加 schema 成本，并允许简历工作流不需要的操作。专用目录可以让产品身份与能力声明一致。

**通过 Shell 转换添加 DOCX 导出。** 这会让行为依赖宿主二进制程序、绕过文件系统提供方的执行世界，并把产物生成隐藏在提示词指令中。专用工具能让 schema、上限、策略和结果保持显式。

**同时解析并保留现有 DOCX／PDF 文档。** 可靠的二进制输入和保留布局的修订需要独立的结构化解析与渲染能力。生成能力无需声称检查过不受支持的输入就能提供价值，因此更大的往返能力继续延期。

## 结果

用户可以选择身份、工具和内置指导一同交付的简历专用 agent，而无需改变现有会话或默认编程模式。更小的目录会减少无关操作，并通过参考数据处理规则限制导入文档中的提示词注入。

该 preset 可以直接生成有界的 `.docx` 产物，无需授予 Shell 或通用二进制写入能力。新增 `writeBytes` 还为专用消费方提供与提供方无关的二进制发布原语，同时让文档格式知识留在文件系统 seam 之外。

该 preset 不提供 DOCX／PDF 输入、保留布局的编辑、PDF 导出、可选模板、保证页数或通用 ATS 评分。agent 必须针对二进制输入请求受支持的表示形式；除非实际检查了渲染结果，否则不得声称完成了逐文件视觉验证；评审分数必须说明为编辑启发式结果。
