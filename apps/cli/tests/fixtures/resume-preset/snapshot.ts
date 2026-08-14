import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'

const compositionPath = process.argv[2]
if (compositionPath === undefined) throw new Error('resume preset snapshot requires its composition path')

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const basePatch = join(repoRoot, 'packages/bundle/base/cordis.patch.yml')
const webPatch = join(repoRoot, 'packages/bundle/web-app/cordis.patch.yml')
const rootConfig = join(repoRoot, 'packages/bundle/base/tests/fixtures/root.cordis.yml')
const presetRoot = dirname(dirname(compositionPath))
const dshHome = process.env.DSH_HOME
if (dshHome === undefined) throw new Error('resume preset snapshot requires DSH_HOME')

const ctx = await boot('resume-preset-snapshot', rootConfig, [
  ...loadOverlayPatches('resume-preset-snapshot', basePatch),
  ...loadOverlayPatches('resume-preset-snapshot', webPatch),
  { id: 'settings', config: { path: join(dshHome, 'settings.yaml'), watch: false } },
  { id: 'storage-json', config: { root: join(dshHome, 'storages') } },
  { id: 'typert-loader', disabled: true },
  { id: 'typert-gateway', disabled: true },
  { id: 'webserver', disabled: true },
  { id: 'web-runtime', disabled: true },
  { id: 'session-telemetry-otel', disabled: true },
  { id: 'modules', disabled: true },
  { id: 'connection', disabled: true },
  { id: 'client-hmr', disabled: true },
  { id: 'directory-picker', disabled: true },
  { id: 'api-gateway', disabled: true },
  {
    id: 'agent-presets',
    config: {
      default: 'standard',
      roots: [{ path: presetRoot, trust: 'system' }],
      includeUserRoot: false,
    },
  },
], (bootCtx) => {
  provideCmdline(bootCtx, { args: [], exit: () => {} })
})

try {
  const handle = await ctx.agents.create({
    sessionId: SessionId('resume-preset-snapshot'),
    setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'resume').then(() => undefined),
  })
  try {
    const assembly = await ctx.systemPrompt.assemble({ scope: handle.agent })
    const skills = (await ctx.skills.list({ scope: handle.agent })).map(({ name, description }) => ({ name, description }))
    const loaded = await ctx.tools.execute({
      callId: CallId('resume-preset-snapshot'),
      name: 'skill',
      arguments: { name: 'resume-authoring' },
      signal: new AbortController().signal,
      agent: handle.agent,
    })
    const exported = await ctx.tools.execute({
      callId: CallId('resume-preset-export'),
      name: 'export_docx',
      arguments: {
        file_path: 'resume.docx',
        name: '张伟',
        headline: 'AI 工程师',
        contact: ['Shanghai', 'zhang@example.com'],
        sections: [{
          heading: '工作经历',
          entries: [{
            title: 'AI 工程师 · 示例科技',
            meta: '2023–至今',
            bullets: ['搭建可追踪的模型评测流程。'],
          }],
        }],
      },
      signal: new AbortController().signal,
      agent: handle.agent,
    })
    if (exported.isError) throw new Error(`DOCX snapshot export failed: ${JSON.stringify(exported.content)}`)
    const docxTarget = await ctx.fs.resolve('resume.docx', { cwd: handle.agent.session.header.cwd })
    const docxBytes = await ctx.fs.readBytes(docxTarget, undefined, 5 * 1024 * 1024)
    const exportValue = exported.value as { operation: string }
    process.stdout.write(`${JSON.stringify({
      persona: assembly.sections.find(section => section.name === 'deployment:persona')?.text ?? null,
      tools: assembly.tools.map(tool => tool.name).sort(),
      skills,
      loaded: loaded.content,
      docx: {
        operation: exportValue.operation,
        zipMagic: Buffer.from(docxBytes.subarray(0, 4)).toString('hex'),
        nonEmpty: docxBytes.byteLength > 0,
      },
    })}\n`)
  } finally {
    await handle.dispose()
  }
} finally {
  await ctx.fiber.dispose()
}
