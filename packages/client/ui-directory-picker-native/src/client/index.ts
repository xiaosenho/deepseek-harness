/** Native directory-picker client plugin. */

import { installNativeDirectoryFlow } from '@deepseek-ai/dsh-client-directory-picker-flows'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** Required services: the slot registry and wire-facing workspace service. */
export const inject = ['slots', 'workspaces']

/**
 * Install the native directory flow into both workspace picker slots.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  installNativeDirectoryFlow(ctx)
}
