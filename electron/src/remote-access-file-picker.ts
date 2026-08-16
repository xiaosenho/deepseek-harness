/** Native file dialogs for the two persisted FRP paths. */

import type { ElectronRemoteAccessFileKind } from '@deepseek-ai/dsh-client-ui-desktop-electron/bridge-contract'
import type { OpenDialogOptions, OpenDialogReturnValue } from 'electron/main'

interface RemoteAccessFileDialog {
  /** Show one unparented native open-file dialog. */
  showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogReturnValue>
}

/**
 * Select one FRP file with a purpose-specific title and filter.
 * @param nativeDialog - Electron dialog implementation.
 * @param kind - fixed file purpose selected by the managed renderer.
 * @returns the selected absolute path, or null after cancellation.
 */
export async function pickRemoteAccessFile(
  nativeDialog: RemoteAccessFileDialog,
  kind: ElectronRemoteAccessFileKind,
): Promise<string | null> {
  const result = await nativeDialog.showOpenDialog({
    title: kind === 'frpc-executable' ? 'Select frpc Executable' : 'Select frps CA Certificate',
    properties: ['openFile'],
    ...kind === 'trusted-ca'
      ? {
        filters: [
          { name: 'Certificates', extensions: ['cer', 'crt', 'pem'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      }
      : {},
  })
  return result.canceled ? null : result.filePaths[0] ?? null
}
