/** Native confirmation, transition, detail, and clipboard flow for remote access. */

import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron/main'
import type {
  RemoteAccessController,
  RemoteAccessState,
  RemoteAccessTransitionResult,
} from './remote-access-controller.ts'

type ShowMessageBox = (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>

/** Main-process dependencies for native remote-access commands. */
export interface NativeRemoteAccessOptions {
  /** Installed application name used by native dialogs. */
  applicationName: string
  /** Authoritative backend lifecycle owner. */
  controller: Pick<RemoteAccessController, 'getState' | 'setEnabled'>
  /** Load a replacement backend origin in the Electron window. */
  navigate: (url: URL) => void
  /** Refresh installed menu items from controller state. */
  refreshMenu: () => void
  /** Native message-box presenter. */
  showMessageBox: ShowMessageBox
  /** Operating-system clipboard writer. */
  writeText: (text: string) => void
}

function settledUrl(state: RemoteAccessState): string | undefined {
  return state.enabled && !state.transitioning ? state.url : undefined
}

async function showCopyFailure(
  options: NativeRemoteAccessOptions,
  error: unknown,
): Promise<void> {
  await options.showMessageBox({
    type: 'error',
    title: options.applicationName,
    message: 'The remote access URL could not be copied.',
    detail: error instanceof Error ? error.message : String(error),
    buttons: ['OK'],
  })
}

/**
 * Copy the current settled URL, optionally requiring the URL shown by a dialog.
 * @param options - current controller and native integrations.
 * @param expectedUrl - URL previously displayed to the operator.
 * @returns whether the current URL was copied.
 */
export async function copyRemoteAccessUrl(
  options: NativeRemoteAccessOptions,
  expectedUrl?: string,
): Promise<boolean> {
  const url = settledUrl(options.controller.getState())
  if (url === undefined) return false
  if (expectedUrl !== undefined && url !== expectedUrl) {
    await options.showMessageBox({
      type: 'info',
      title: options.applicationName,
      message: 'The remote access URL changed.',
      detail: 'Open Connection Details again to copy the current URL.',
      buttons: ['OK'],
    })
    return false
  }
  try {
    options.writeText(url)
    return true
  } catch (error) {
    await showCopyFailure(options, error)
    return false
  }
}

/**
 * Present the complete bearer URL in a native dialog and offer a main-process copy action.
 * @param options - current controller and native integrations.
 * @returns whether the dialog copied the displayed URL.
 */
export async function showRemoteAccessDetails(
  options: NativeRemoteAccessOptions,
): Promise<boolean> {
  const url = settledUrl(options.controller.getState())
  if (url === undefined) return false
  const result = await options.showMessageBox({
    type: 'info',
    title: options.applicationName,
    message: 'Remote access is ready.',
    detail: `${url}\n\nTreat this complete URL as a credential. Anyone who has it can control the Harness Host.`,
    buttons: ['Copy URL', 'Close'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  return result.response === 0 ? copyRemoteAccessUrl(options, url) : false
}

function confirmationDialog(applicationName: string, enabled: boolean): MessageBoxOptions {
  return enabled
    ? {
      type: 'warning',
      title: applicationName,
      message: 'Start remote access?',
      detail: 'DeepSeek Harness will restart its WebUI. Anyone on the trusted LAN who receives the connection URL can control the Harness Host.',
      buttons: ['Start Remote Access', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    }
    : {
      type: 'warning',
      title: applicationName,
      message: 'Stop remote access?',
      detail: 'DeepSeek Harness will restart its WebUI and invalidate the current URL. Running tasks and connected remote clients will be interrupted.',
      buttons: ['Stop Remote Access', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    }
}

/**
 * Confirm and perform one native-menu exposure change.
 * @param enabled - requested LAN exposure state.
 * @param options - controller, navigation, menu, dialog, and clipboard integrations.
 * @returns whether the requested mode became active.
 */
export async function changeRemoteAccessFromMenu(
  enabled: boolean,
  options: NativeRemoteAccessOptions,
): Promise<boolean> {
  const initial = options.controller.getState()
  if (initial.transitioning || initial.enabled === enabled) return false
  const confirmation = await options.showMessageBox(
    confirmationDialog(options.applicationName, enabled),
  )
  if (confirmation.response !== 0) return false

  const current = options.controller.getState()
  if (current.transitioning || current.enabled === enabled) {
    options.refreshMenu()
    return false
  }

  let result: RemoteAccessTransitionResult
  try {
    const transition = options.controller.setEnabled(enabled)
    options.refreshMenu()
    result = await transition
  } finally {
    options.refreshMenu()
  }
  if (result.navigationUrl !== undefined) options.navigate(result.navigationUrl)
  if (!result.succeeded) return false
  if (enabled) await showRemoteAccessDetails(options)
  return true
}
