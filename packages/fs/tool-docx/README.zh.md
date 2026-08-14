# @deepseek-ai/dsh-tool-docx

[English](README.md) | 中文

面向模型的 `export_docx` 工具会从结构化且已确认的内容生成紧凑、单栏的 Microsoft Word 简历。它使用维护中的 `docx` 库创建 OOXML，并通过 `ctx.fs.writeBytes` 发布完整二进制内容，因此本地、沙箱化和 E2B 文件系统提供方会继续保留原子写入、观察策略和路径约束行为。

该插件是专用文件系统消费方。它不解析现有 Word 文件，也不公开通用二进制写入工具。

## 配置

| 键 | 默认值 | 含义 |
|---|---:|---|
| `maxCharacters` | `40000` | 姓名、职业标题、联系方式、章节标题、条目和要点的 Unicode 字符总上限。 |
| `maxOutputBytes` | `5242880` | 文件系统发布之前允许生成的 DOCX 归档大小上限。 |

两个值都必须是正整数。完整简历会先在内存中生成，再检查输出上限。

## 工具

`export_docx` 接受：

- `file_path`：以 `.docx` 结尾的目标路径，以调用会话工作区为基准解析；
- `name`、可选 `headline` 和按顺序排列的可选 `contact` 字符串；
- 按顺序排列的 `sections`，每个章节都包含非空 `heading` 和一个或多个 `entries`；
- 每个条目都包含必填 `title`，以及可选 `meta`、`description` 和要点字符串。

必填文本为空白时会被拒绝。生成文档采用 US Letter 页面、紧凑的 0.65 英寸页边距、Arial 字体与 Microsoft YaHei 东亚字体偏好、克制的蓝色强调色、紧凑段落间距、真正的 Word 项目符号编号，且不使用表格。条目和章节标题使用与下一段同页的提示，以减少孤立标题。

工具会请求 `fs/write-intent`、调用 `writeBytes`，然后发出 `fs/observed`。加载 `dsh-fs-observation-policy` 时，可以创建新路径；替换现有文件则要求先读取该文件，且版本保持不变。文件系统提供方实施约束时，会把会话沙箱策略传给二进制写入；本工具不公开单次权限升级字段。

规范成功值是 `{ path, operation: 'create' | 'update', bytes, sections, entries }`。面向模型的结果为：

```xml
<path>RESOLVED_PATH</path>
<type>document</type>
<content>
Created DOCX resume (BYTE_COUNT bytes)
</content>
```

获得授权的替换操作会用 `Updated` 代替 `Created`。

## 模型体验

### 系统提示词

#### 模型看到的内容

```markdown
Use export_docx only after the resume facts and wording are final. Supply structured sections, preserve every confirmed fact, and choose a new .docx path unless the user explicitly authorized replacement.
```

#### Token 影响

插件作用域内的每次请求都会包含固定指导和一个工具 schema。生成的 OOXML 字节不会进入模型历史，历史只保留结构化调用参数和简短结果信封。

#### KV Cache 影响

插件和 schema 不变时前缀保持稳定。调用与结果追加在可复用前缀之后。

### 工具 schema 与错误

#### 模型看到的内容

生成的 [`export_docx` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-docx) 描述结构化字段。校验与生成失败会规范化为 `Error: <message>`，包括 `file_path must end with .docx`、章节／条目为空的消息、`resume content exceeds maxCharacters (<limit>)` 和 `generated DOCX exceeds maxOutputBytes (<limit>)`。文件系统策略和提供方错误会保留其结构化代码。

#### Token 影响

较大的简历参数会保留在工具调用历史中，直至压缩。结果与错误文本有界。

#### KV Cache 影响

调用后仅追加。

## 已知限制与延期工作

- **只支持生成**：不解析 DOCX／PDF，不导入模板，不支持批注、修订模式或保留布局的往返修改。
- **只有一种版式预设**：不能选择页面尺寸、字体、颜色、分栏或照片布局。
- **不承诺页数**：内容较长时仍可能产生多页。运行时不会渲染并检查每个生成文件。
- **整缓冲生成**：文档构建与 ZIP 打包在内存中完成，只在文件系统发布前通过配置限制。
- **不支持单次沙箱权限升级**：请导出到会话工作区内的新路径或其他已可写根目录。
