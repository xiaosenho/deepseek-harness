/** Structured DOCX export behavior over the real local filesystem provider. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolDocx from '@deepseek-ai/dsh-tool-docx'

const signal = new AbortController().signal
let callCounter = 0
let dir: string
let ctx: Context

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-tool-docx-'))
  ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: dir })
  await ctx.plugin(ToolDocx)
})

afterEach(async () => {
  await ctx.fiber.dispose()
  await rm(dir, { recursive: true, force: true })
})

function call(args: unknown) {
  return ctx.tools.execute({
    callId: CallId(`docx-${++callCounter}`),
    name: 'export_docx',
    arguments: args,
    signal,
  })
}

function resume(filePath = 'resume.docx') {
  return {
    file_path: filePath,
    name: '张伟',
    headline: 'AI 工程师',
    contact: ['Shanghai', 'zhang@example.com'],
    sections: [{
      heading: '工作经历',
      entries: [{
        title: 'AI 工程师 · 示例科技',
        meta: '2023–至今',
        bullets: ['将推理服务延迟降低 35%。', '搭建可追踪的模型评测流程。'],
      }],
    }],
  }
}

describe('export_docx', () => {
  it('registers one exclusive tool and its finalization guidance', async () => {
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual(['export_docx'])
    expect(ctx.tools.executionMode({ callId: CallId('mode'), name: 'export_docx', arguments: resume(), signal }))
      .toEqual({ kind: 'exclusive' })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('Use export_docx only after')
  })

  it('writes a valid OOXML zip with structured metadata', async () => {
    const result = await call(resume())
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected DOCX export success')
    expect(result.value).toMatchObject({ operation: 'create', sections: 1, entries: 1 })

    const bytes = await readFile(join(dir, 'resume.docx'))
    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    expect(result.value).toMatchObject({ bytes: bytes.byteLength })
  })

  it('rejects non-DOCX paths and structurally empty resumes', async () => {
    const wrongExtension = await call(resume('resume.pdf'))
    expect(wrongExtension.isError).toBe(true)
    expect(wrongExtension.content.map(item => item.type === 'text' ? item.text : '').join('\n'))
      .toContain('file_path must end with .docx')

    const empty = await call({ ...resume(), sections: [] })
    expect(empty.isError).toBe(true)
    expect(empty.content.map(item => item.type === 'text' ? item.text : '').join('\n'))
      .toContain('sections must contain at least one section')
  })

  it('does not blindly replace an existing Word file under observation policy', async () => {
    await ctx.plugin((await import('@deepseek-ai/dsh-fs-observation-policy')))
    await writeFile(join(dir, 'resume.docx'), 'existing')

    const result = await call(resume())

    expect(result.isError).toBe(true)
    expect(result.content.map(item => item.type === 'text' ? item.text : '').join('\n'))
      .toContain('without reading it first')
    expect(await readFile(join(dir, 'resume.docx'), 'utf8')).toBe('existing')
  })
})
