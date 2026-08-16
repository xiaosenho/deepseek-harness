import { describe, expect, it, vi } from 'vitest'
import { pickRemoteAccessFile } from '../src/remote-access-file-picker.ts'

describe('remote-access file picker', () => {
  it('selects an frpc executable without a certificate filter', async () => {
    const showOpenDialog = vi.fn(async () => ({
      canceled: false,
      filePaths: ['/opt/homebrew/bin/frpc'],
    }))

    await expect(pickRemoteAccessFile({ showOpenDialog }, 'frpc-executable'))
      .resolves.toBe('/opt/homebrew/bin/frpc')
    expect(showOpenDialog).toHaveBeenCalledWith({
      title: 'Select frpc Executable',
      properties: ['openFile'],
    })
  })

  it('filters CA certificates and returns null after cancellation', async () => {
    const showOpenDialog = vi.fn(async () => ({ canceled: true, filePaths: [] }))

    await expect(pickRemoteAccessFile({ showOpenDialog }, 'trusted-ca')).resolves.toBeNull()
    expect(showOpenDialog).toHaveBeenCalledWith({
      title: 'Select frps CA Certificate',
      properties: ['openFile'],
      filters: [
        { name: 'Certificates', extensions: ['cer', 'crt', 'pem'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
  })

  it('returns null when a completed dialog has no selected file', async () => {
    const showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: [] }))
    await expect(pickRemoteAccessFile({ showOpenDialog }, 'trusted-ca')).resolves.toBeNull()
  })
})
