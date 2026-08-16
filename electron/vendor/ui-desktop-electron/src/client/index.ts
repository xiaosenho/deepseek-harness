/** Electron-managed WebUI settings contributions. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { DesktopControlInjected } from './contract.ts'
import { DesktopControlController, resolveElectronDesktopBridge } from './desktop-controller.ts'
import { RemoteAccessSection } from './RemoteAccessSection.tsx'
import { SoftwareInfoItem } from './SoftwareInfoItem.tsx'
import { en, zh, type DesktopElectronLocaleKey } from './locales.ts'

export type { ElectronDesktopBridge, ElectronDesktopState } from '../bridge-contract.ts'
export type { DesktopElectronLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Electron desktop controls and status copy. */
    'desktop.electron': DesktopElectronLocaleKey
  }
}

const NS = 'desktop.electron'

/** Services required by the Electron-only slot contributions. */
export const inject = ['slots', 'locale']

/** Register desktop controls only when the narrow Electron preload is present. */
export function apply(ctx: ClientContext): void {
  const bridge = resolveElectronDesktopBridge(globalThis.window.dshElectron)
  if (bridge === undefined) return

  const controller = new DesktopControlController(bridge)
  ctx.effect(() => {
    void controller.start()
    return () => { controller.dispose() }
  }, 'ui-desktop-electron: controller')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-desktop-electron: dictionaries')

  const t = ctx.locale.bind(NS)
  const injected = (): DesktopControlInjected => ({
    hooks: { desktopControl: controller },
    setRemoteAccessEnabled: enabled => controller.setRemoteAccessEnabled(enabled),
    saveRemoteAccessConfiguration: input => controller.saveRemoteAccessConfiguration(input),
    selectRemoteAccessFile: kind => controller.selectRemoteAccessFile(kind),
    copyRemoteAccessUrl: () => controller.copyRemoteAccessUrl(),
    checkForUpdates: () => controller.checkForUpdates(),
    installUpdate: () => controller.installUpdate(),
    checkWebKernelUpdate: () => controller.checkWebKernelUpdate(),
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'remote-access',
    order: 30,
    label: () => t('remoteNav'),
    locale: NS,
    inject: injected,
  }, RemoteAccessSection))
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'software-information',
    order: 100,
    locale: NS,
    inject: injected,
  }, SoftwareInfoItem))
}
