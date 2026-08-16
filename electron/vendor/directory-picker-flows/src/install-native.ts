/** Native directory-flow installer shared by native-capable client plugins. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { NativeFlowInjected } from './native-flow.ts'
import { NativeDirectoryFlow } from './native-flow.ts'

/**
 * Install the native chooser into both workspace directory-flow slots.
 * Registration and disposal belong to the calling plugin's Cordis fiber.
 * @param ctx - client context carrying slots and workspaces.
 */
export function installNativeDirectoryFlow(ctx: ClientContext): void {
  const injected = (): NativeFlowInjected => ({ pick: () => ctx.workspaces.pickDirectory() })
  ctx.slots.inject('conversation.hero.workspace.directoryFlow', () =>
    ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
      yield ctx.slots.register({
        name: 'conversation.hero.workspace.directoryFlow', inject: injected,
      }, NativeDirectoryFlow)
      yield ctx.slots.register({
        name: 'sidebar.workspaces.directoryFlow', inject: injected,
      }, NativeDirectoryFlow)
    }))
}
