// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://remote.example/"}
import { describe, it } from 'vitest'
import { installAssembledBootEnv } from './assembled-boot.ts'
import {
  assertElectronDirectoryPickerSelection,
  electronDirectoryPickerArtifactsAvailable,
  mountElectronDirectoryPicker,
} from './electron-directory-picker-assembled.ts'

installAssembledBootEnv()

describe('Electron directory-picker assembled remote entry', () => {
  it.skipIf(!electronDirectoryPickerArtifactsAvailable())('loads the catalog bundle and installs only the browse flow pair', async () => {
    await assertElectronDirectoryPickerSelection(
      await mountElectronDirectoryPicker(),
      { isLoopback: false, componentName: 'BrowseDirectoryFlow' },
    )
  })
})
