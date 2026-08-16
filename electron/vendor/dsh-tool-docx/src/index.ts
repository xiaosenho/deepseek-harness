/**
 * Model-facing structured resume export to DOCX through `ctx.fs`.
 * @module @deepseek-ai/dsh-tool-docx
 */

import { extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, GenericResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { buildResumeMarkdown } from './document.ts'
import type { ResumeDocument, ResumeEntry, ResumeSection } from './document.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-docx'
/** Services required by the DOCX export tool. */
export const inject = ['tools', 'fs', 'systemPrompt']

/** DOCX export bounds. */
export interface Config {
  /** Maximum total Unicode characters accepted across the structured resume. */
  maxCharacters?: number
  /** Maximum generated DOCX byte length. */
  maxOutputBytes?: number
}

export const Config: z<Config> = z.object({
  maxCharacters: z.number().default(40_000),
  maxOutputBytes: z.number().default(5 * 1024 * 1024),
})

type ResolvedConfig = Required<Config>

interface ExportArgs extends ResumeDocument {
  file_path: string
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`tool-docx: ${name} must be a positive integer`)
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) throw new Error(`${field} must be a non-empty string`)
  return normalized
}

function optionalText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim()
  return normalized.length === 0 ? undefined : normalized
}

function parseEntry(entry: ResumeEntry, sectionIndex: number, entryIndex: number): ResumeEntry {
  const title = requiredText(entry.title, `sections[${sectionIndex}].entries[${entryIndex}].title`)
  const meta = optionalText(entry.meta)
  const description = optionalText(entry.description)
  const bullets = entry.bullets?.map((bullet, bulletIndex) =>
    requiredText(bullet, `sections[${sectionIndex}].entries[${entryIndex}].bullets[${bulletIndex}]`))
  return {
    title,
    ...(meta === undefined ? {} : { meta }),
    ...(description === undefined ? {} : { description }),
    ...(bullets === undefined ? {} : { bullets }),
  }
}

function parseSections(sections: ResumeSection[]): ResumeSection[] {
  if (sections.length === 0) throw new Error('sections must contain at least one section')
  return sections.map((section, sectionIndex) => {
    const heading = requiredText(section.heading, `sections[${sectionIndex}].heading`)
    if (section.entries.length === 0) {
      throw new Error(`sections[${sectionIndex}].entries must contain at least one entry`)
    }
    return {
      heading,
      entries: section.entries.map((entry, entryIndex) => parseEntry(entry, sectionIndex, entryIndex)),
    }
  })
}

/**
 * Normalize tool arguments and enforce complete-input bounds.
 * @param args - schema-validated export arguments.
 * @param maxCharacters - inclusive total character bound.
 * @returns normalized output path and resume document.
 */
function parseExportArgs(args: ExportArgs, maxCharacters: number): { filePath: string; resume: ResumeDocument } {
  const filePath = requiredText(args.file_path, 'file_path')
  if (!['.md', '.markdown'].includes(extname(filePath).toLowerCase())) {
    throw new Error('file_path must end with .md or .markdown')
  }
  const headline = optionalText(args.headline)
  const contact = args.contact?.map((item, index) => requiredText(item, `contact[${index}]`))
  const resume: ResumeDocument = {
    name: requiredText(args.name, 'name'),
    ...(headline === undefined ? {} : { headline }),
    ...(contact === undefined ? {} : { contact }),
    sections: parseSections(args.sections),
  }
  let characters = resume.name.length + (resume.headline?.length ?? 0)
  for (const item of resume.contact ?? []) characters += item.length
  for (const section of resume.sections) {
    characters += section.heading.length
    for (const entry of section.entries) {
      characters += entry.title.length + (entry.meta?.length ?? 0) + (entry.description?.length ?? 0)
      for (const bullet of entry.bullets ?? []) characters += bullet.length
    }
  }
  if (characters > maxCharacters) throw new Error(`resume content exceeds maxCharacters (${maxCharacters})`)
  return { filePath, resume }
}

const ENTRY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', required: true, description: 'Role/company, project, education, or skill-group title.' },
    meta: { type: 'string', description: 'Optional date, location, or secondary metadata.' },
    description: { type: 'string', description: 'Optional concise explanatory paragraph.' },
    bullets: { type: 'array', items: { type: 'string' }, description: 'Evidence-based accomplishment or responsibility bullets.' },
  },
} as const

const SECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    heading: { type: 'string', required: true, description: 'Visible section heading in the resume language.' },
    entries: { type: 'array', required: true, items: ENTRY_SCHEMA, description: 'Ordered entries in this section.' },
  },
} as const

/**
 * Register the structured Markdown resume exporter.
 * @param ctx - the plugin context providing tools, filesystem, prompt, and optional sandbox policy.
 * @param config - schema-validated export bounds.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  assertPositiveInteger('maxCharacters', resolved.maxCharacters)
  assertPositiveInteger('maxOutputBytes', resolved.maxOutputBytes)
  const sandboxPolicy = ctx.fs.sandboxMode === undefined ? undefined : ctx.get('sandboxPolicy')
  if (ctx.fs.sandboxMode !== undefined && sandboxPolicy === undefined) {
    throw new Error('tool-docx: the mounted filesystem confines but ctx.sandboxPolicy is missing')
  }

  ctx.systemPrompt.section({
    name: 'tool:export-resume',
    order: 104,
    text: 'Use export_resume only after the resume facts and wording are final. Supply structured sections, preserve every confirmed fact, and choose a new .md path unless the user explicitly authorized replacement.',
  })

  ctx.tools.register(defineTool({
    name: 'export_resume',
    description: 'Export a finalized, structured resume as a professional Markdown document.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Destination path ending in .md or .markdown, resolved in the session workspace.' },
      name: { type: 'string', required: true, description: 'Candidate name shown as the document title.' },
      headline: { type: 'string', description: 'Optional professional headline.' },
      contact: { type: 'array', items: { type: 'string' }, description: 'Confirmed contact facts in display order.' },
      sections: { type: 'array', required: true, items: SECTION_SCHEMA, description: 'Ordered resume sections and entries.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          operation: { type: 'string', required: true, enum: ['create', 'update'] },
          bytes: { type: 'integer', required: true },
          sections: { type: 'integer', required: true },
          entries: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `<path>${value.path}</path>\n<type>document</type>\n<content>\n${value.operation === 'create' ? 'Created' : 'Updated'} Markdown resume (${value.bytes} bytes)\n</content>`,
      }],
    },
    async execute(args, exec) {
      const { filePath, resume } = parseExportArgs(args, resolved.maxCharacters)
      const markdown = buildResumeMarkdown(resume)
      const bytes = Buffer.byteLength(markdown)
      if (bytes > resolved.maxOutputBytes) {
        throw new Error(`generated resume exceeds maxOutputBytes (${resolved.maxOutputBytes})`)
      }
      const policy: SandboxExecutionPolicy | undefined = sandboxPolicy?.resolve(
        exec.agent === undefined ? {} : { session: exec.agent.session },
      )
      const cwd = exec.agent?.session.header.cwd ?? policy?.workspaceRoot
      const target = await ctx.fs.resolve(filePath, {
        ...(cwd === undefined ? {} : { cwd }),
        signal: exec.signal,
      })
      const intent = await ctx.waterfall('fs/write-intent', target, exec, () => undefined)
      const outcome = await ctx.fs.writeText(target, markdown, intent, exec.signal, policy)
      ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, exec)
      return {
        path: target.displayPath,
        operation: outcome.operation,
        bytes,
        sections: resume.sections.length,
        entries: resume.sections.reduce((total, section) => total + section.entries.length, 0),
      }
    },
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `Export resume to ${args.file_path}`,
        kind: 'edit',
        locations: [{ path: args.file_path }],
      }
    },
    presentResult(args, result: ToolResult): GenericResultView | undefined {
      if (result.isError) return undefined
      return {
        card: 'generic',
        title: `Exported resume to ${args.file_path}`,
        content: result.content,
      }
    },
  }))
}
