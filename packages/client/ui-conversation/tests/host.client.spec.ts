import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import {
  CHINESE_REASONING_PROMPT, CONVERSATION_SETTINGS_NAMESPACE, DEFAULT_BUSY_ENTER_BEHAVIOR, apply,
} from '@deepseek-ai/dsh-client-ui-conversation'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-conversation host', () => {
  it('registers, validates, and disposes the durable busy-Enter preference', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    await ctx.plugin(SystemPrompt).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = settingsNamespace(CONVERSATION_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({
      busyEnter: DEFAULT_BUSY_ENTER_BEHAVIOR,
      chineseReasoning: false,
    })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain(CHINESE_REASONING_PROMPT)
    await ctx.settings.update(ns, { busyEnter: 'steer' })
    expect(ctx.settings.get(ns)).toEqual({ busyEnter: 'steer', chineseReasoning: false })
    await ctx.settings.update(ns, { chineseReasoning: true })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain(CHINESE_REASONING_PROMPT)
    ctx.systemPrompt.section({
      name: 'test:complete-persona', order: 0, text: 'Exact persona.', complete: true,
    })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe(
      `Exact persona.\n\n${CHINESE_REASONING_PROMPT}`,
    )
    await expect(ctx.settings.update(ns, { busyEnter: 'invalid' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain(CHINESE_REASONING_PROMPT)
  })
})
