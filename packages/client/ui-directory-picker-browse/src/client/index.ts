/** In-app directory-browser client plugin. */

import { installBrowseDirectoryFlow } from '@deepseek-ai/dsh-client-directory-picker-flows'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** Required services: the slot registry, wire-facing workspace service, and locale. */
export const inject = ['slots', 'workspaces', 'locale']

/**
 * Install the in-app directory browser into both workspace picker slots.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  installBrowseDirectoryFlow(ctx)
}
