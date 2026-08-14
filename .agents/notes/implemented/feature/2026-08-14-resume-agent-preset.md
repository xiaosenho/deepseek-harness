# Agent Note: A focused preset ships truthful resume authoring

Status: implemented

English | [中文](2026-08-14-resume-agent-preset.zh.md)

## Problem

The shipped presets are coding agents. A resume task needs a different identity, factual-integrity rules, job-description prompt-injection resistance, and a smaller capability set; adding those instructions to the deployment persona would affect every session, while copying the standard preset would expose shell, web, delegation, and coding guidance unrelated to resume work.

Resume modification also creates a format trap. The general filesystem tools read UTF-8 text and supported raster images, while DOCX intake and layout-preserving edits need dedicated parsers. Direct Word delivery still requires a deterministic document generator that stays inside the existing filesystem policy instead of bypassing it through host I/O or shell conversion.

## Decision

The shipped roster includes `apps/cli/config/agent-presets/resume/`, following the per-session composition owned by [agent presets](../architecture/2026-08-03-per-session-agent-presets.md). Its complete persona replaces the coding identity for that scope and requires every claim to come from the user or supplied files. Imported resume text and job descriptions are reference data rather than instructions, suggestions remain distinct from confirmed facts, and unsupported missing information is reported instead of invented.

The preset contributes only `@deepseek-ai/dsh-tool-fs`, `@deepseek-ai/dsh-tool-docx`, `@deepseek-ai/dsh-tool-skill`, and `@deepseek-ai/dsh-tool-ask-user`. The resulting catalog contains `read`, conditional `read_image`, `write`, `edit`, `export_docx`, `skill`, and `ask_user_question`; it omits shell, web search, jobs, goals, planning, delegation, and workflow tools. Filesystem policy, durable image attachments, interaction, and the layered registries remain host-owned.

Three preset-local skills divide the model workflow: `resume-authoring` creates or edits truthful content, `resume-tailoring` maps a supplied job description to existing evidence, and `resume-review` checks integrity, clarity, consistency, ATS-readable structure, and density risks. The local filesystem provider sets `includeDefaultRoots: false` and names only the preset's `skills/` directory, preventing repository and user coding skills from entering this focused layer. Deployment-level skills still merge through the [layered skill registry](../architecture/2026-08-09-layered-skill-registry.md).

`@deepseek-ai/dsh-tool-docx` accepts a bounded structured resume and generates a compact, single-column OOXML document through `docx`. It publishes the complete archive through a new `FileSystem.writeBytes` primitive, so local, sandboxed, and E2B providers keep their atomic publication, write-intent, observation, and containment behavior. Binary writes share `FsWriteIntent`; they return byte metadata rather than a text diff basis. The tool defaults to a new `.docx` path and does not expose a general binary writer or shell.

The preset can author or edit Markdown/plain text, inspect supplied page images when the active model supports image input, and export finalized content as a new Word document. It still cannot parse an existing DOCX or PDF or preserve its layout; for binary input, the instructions require a text export, pasted text, or page images and prohibit claiming that unsupported content was inspected. No resume-specific runtime state exists outside the session log: the persona, tool schemas, structured export arguments, skill catalog messages, skill loads, and file tool calls use the existing logged paths.

## Verification

The shipped Web composition test mounts `resume` through the real roster and pins its complete persona, exact seven-tool catalog, three scoped skills, exclusion from the global skill view, and successful `resume-authoring` load. The keyless resume-preset snapshot boots the same bundle layers through the real Loader, executes `export_docx`, and records the model-visible persona, catalog summaries, loaded authoring instructions, and generated ZIP signature. Provider and tool tests cover binary byte fidelity, sandbox denials, observation-guarded replacement, validation, and the OOXML archive signature; a rendered fixture verifies the shipped layout visually.

## Alternatives considered

**Add resume instructions to the standard persona.** This would make every coding session carry unrelated constraints and would leave the shell, web, delegation, and workspace instruction surfaces active. Per-session presets already provide the required isolation.

**Copy the complete standard preset and add resume skills.** The extra capabilities increase schema cost and permit operations the resume workflow does not need. A focused catalog makes the product identity and capability claim agree.

**Add DOCX export through shell conversion.** This would make behavior depend on host binaries, bypass the filesystem provider's execution world, and hide artifact generation inside prompt instructions. A dedicated tool keeps schema, bounds, policy, and results explicit.

**Also parse and preserve existing DOCX/PDF documents.** Reliable binary intake and layout-preserving revision need a separate structured parsing and rendering capability. Generation is useful without claiming that unsupported input was inspected, so that larger round trip remains deferred.

## Consequences

Users can select a resume-specific agent whose identity, tools, and bundled guidance travel together without changing existing sessions or the default coding mode. The smaller catalog reduces irrelevant actions and limits imported-document prompt injection to the reference-data handling rules.

The preset directly produces a bounded `.docx` artifact without granting shell or general binary-write access. Adding `writeBytes` also gives specialized consumers a provider-neutral binary publication primitive while leaving document format knowledge outside the filesystem seam.

The preset does not provide DOCX/PDF input, layout-preserving edits, PDF export, selectable templates, a guaranteed page count, or a universal ATS score. The agent must request a supported representation for binary input, avoid claiming per-file visual verification unless a render was inspected, and describe review scores as editorial heuristics.
