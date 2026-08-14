// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://127.0.0.1/"}
import { describe, it } from 'vitest'
import { installAssembledBootEnv } from './assembled-boot.ts'
import {
  assertElectronDirectoryPickerSelection,
  electronDirectoryPickerArtifactsAvailable,
  mountElectronDirectoryPicker,
} from './electron-directory-picker-assembled.ts'

installAssembledBootEnv()

describe('Electron directory-picker assembled loopback entry', () => {
  it.skipIf(!electronDirectoryPickerArtifactsAvailable())('loads the catalog bundle and installs only the native flow pair', async () => {
    await assertElectronDirectoryPickerSelection(
      await mountElectronDirectoryPicker(),
      { isLoopback: true, componentName: 'NativeDirectoryFlow' },
    )
  })
})
