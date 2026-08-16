/** Electron directory-picker client plugin with per-page connection routing. */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import {
  installBrowseDirectoryFlow,
  installNativeDirectoryFlow,
} from '@deepseek-ai/dsh-client-directory-picker-flows'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** Required services for connection routing and both directory-flow implementations. */
export const inject = ['connection', 'slots', 'workspaces', 'locale']

/**
 * Install exactly one directory flow for this page authority: the Electron
 * native chooser on loopback, or the in-app browser on a remote connection.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  if (connection.isLoopback) {
    installNativeDirectoryFlow(ctx)
  } else {
    installBrowseDirectoryFlow(ctx)
  }
}
