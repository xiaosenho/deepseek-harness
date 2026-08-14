/** Host registration for browser conversation preferences. */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { CONVERSATION_SETTINGS_NAMESPACE, ConversationSettingsSchema } from './submission-settings.ts'

export {
  BUSY_ENTER_BEHAVIORS, BUSY_ENTER_FIELD, CHINESE_REASONING_FIELD, CONVERSATION_SETTINGS_NAMESPACE,
  DEFAULT_BUSY_ENTER_BEHAVIOR, DEFAULT_CHINESE_REASONING, type BusyEnterBehavior, type ConversationSettings,
} from './submission-settings.ts'

/** Model guidance enabled by the user's Chinese-reasoning preference. */
export const CHINESE_REASONING_PROMPT = 'Do all reasoning in Chinese. Reply in Chinese unless the user explicitly requests another language.'

/**
 * Register the durable conversation section when a settings provider exists.
 * @param ctx - Host context whose optional settings service owns the section.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    const scope = settingsCtx.settings.register(
      settingsNamespace(CONVERSATION_SETTINGS_NAMESPACE),
      ConversationSettingsSchema,
    )
    settingsCtx.inject(['systemPrompt'], promptCtx => promptCtx.systemPrompt.section({
      name: 'user:chinese-reasoning',
      order: 10,
      text: () => scope.get().chineseReasoning ? CHINESE_REASONING_PROMPT : '',
      appendAfterComplete: true,
    }))
  })
}
