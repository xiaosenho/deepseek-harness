# @deepseek-ai/dsh-tool-docx

English | [中文](README.zh.md)

The model-facing `export_docx` tool generates a compact, single-column Microsoft Word resume from structured, confirmed content. It creates OOXML with the maintained `docx` library and publishes the complete binary through `ctx.fs.writeBytes`, so local, sandboxed, and E2B filesystem providers retain their atomic-write, observation, and containment behavior.

This plugin is a specialized filesystem consumer. It does not parse an existing Word file and does not expose a general binary writer.

## Config

| Key | Default | Meaning |
|---|---:|---|
| `maxCharacters` | `40000` | Maximum total Unicode characters across the name, headline, contact items, headings, entries, and bullets. |
| `maxOutputBytes` | `5242880` | Maximum generated DOCX archive size before filesystem publication. |

Both values must be positive integers. The complete resume is generated in memory before the output bound is checked.

## Tool

`export_docx` accepts:

- `file_path`: destination ending in `.docx`, resolved against the calling session workspace;
- `name`, optional `headline`, and optional ordered `contact` strings;
- ordered `sections`, each with a non-empty `heading` and one or more `entries`;
- each entry has a required `title`, optional `meta`, optional `description`, and optional bullet strings.

Blank required text is rejected. The generated document uses US Letter pages, compact 0.65-inch margins, Arial with a Microsoft YaHei East Asian font preference, a restrained blue accent, compact paragraph spacing, real Word bullet numbering, and no tables. Entries and section headings use keep-with-next hints to reduce isolated headings.

The tool requests `fs/write-intent`, calls `writeBytes`, then emits `fs/observed`. With `dsh-fs-observation-policy`, creating a new path is allowed while replacing an existing file requires a prior read at the unchanged version. Under a confining filesystem provider, the session's sandbox policy is passed to the binary write; this tool does not advertise one-shot escalation fields.

Canonical success is `{ path, operation: 'create' | 'update', bytes, sections, entries }`. The model-facing result is:

```xml
<path>RESOLVED_PATH</path>
<type>document</type>
<content>
Created DOCX resume (BYTE_COUNT bytes)
</content>
```

`Updated` replaces `Created` for an authorized replacement.

## Model Experience

### System prompt

#### What the model sees

```markdown
Use export_docx only after the resume facts and wording are final. Supply structured sections, preserve every confirmed fact, and choose a new .docx path unless the user explicitly authorized replacement.
```

#### Token effect

The fixed guidance and one tool schema are present on every request in the plugin scope. Generated OOXML bytes never enter model history; only the structured call arguments and small result envelope do.

#### KV Cache effect

Prefix-stable while the plugin and schema are unchanged. Calls and results append after the reusable prefix.

### Tool schema and errors

#### What the model sees

The generated [`export_docx` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-docx) describes the structured fields. Validation and generation failures are normalized as `Error: <message>`, including `file_path must end with .docx`, empty section/entry messages, `resume content exceeds maxCharacters (<limit>)`, and `generated DOCX exceeds maxOutputBytes (<limit>)`. Filesystem policy and provider errors retain their structured codes.

#### Token effect

Large resume arguments remain in retained tool-call history until compaction. Result and error text are bounded.

#### KV Cache effect

Append-only after a call.

## Known Limitations and Deferred Work

- **Generation only** — no DOCX/PDF parsing, template import, comments, tracked changes, or layout-preserving round trip.
- **One layout preset** — no user-selectable page size, typography, color, columns, or photo layout.
- **No pagination promise** — content length can still produce multiple pages. The runtime does not render and inspect every generated file.
- **Whole-buffer generation** — document construction and ZIP packing occur in memory, bounded by config only before filesystem publication.
- **No one-shot sandbox escalation** — export to a new path inside the session workspace or an already writable root.
