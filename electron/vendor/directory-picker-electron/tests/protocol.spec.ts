/** Runtime validation of the Electron directory-picker parent IPC protocol. */

import { describe, expect, it } from 'vitest'
import {
  electronDirectoryPickerRequestId, isElectronDirectoryPickerChildMessage,
  isElectronDirectoryPickerParentMessage,
} from '../src/protocol.ts'

describe('Electron directory-picker IPC protocol', () => {
  it('brands non-empty ids and rejects blank ids', () => {
    expect(electronDirectoryPickerRequestId('pick-1')).toBe('pick-1')
    expect(() => electronDirectoryPickerRequestId('  ')).toThrow('must not be blank')
  })

  it('accepts only exact child request and cancel messages', () => {
    const requestId = electronDirectoryPickerRequestId('child-1')
    expect(isElectronDirectoryPickerChildMessage({
      type: 'dsh/electron-directory-picker/request', requestId,
    })).toBe(true)
    expect(isElectronDirectoryPickerChildMessage({
      type: 'dsh/electron-directory-picker/cancel', requestId,
    })).toBe(true)
    expect(isElectronDirectoryPickerChildMessage({
      type: 'dsh/electron-directory-picker/request', requestId, extra: true,
    })).toBe(false)
    expect(isElectronDirectoryPickerChildMessage({
      type: 'dsh/electron-directory-picker/request', requestId: '',
    })).toBe(false)
    expect(isElectronDirectoryPickerChildMessage({
      type: 'dsh/electron-directory-picker/unknown', requestId,
    })).toBe(false)
    expect(isElectronDirectoryPickerChildMessage(null)).toBe(false)
    expect(isElectronDirectoryPickerChildMessage([])).toBe(false)
  })

  it('accepts only exact picked, cancelled, and failed parent messages', () => {
    const requestId = electronDirectoryPickerRequestId('parent-1')
    expect(isElectronDirectoryPickerParentMessage({
      type: 'dsh/electron-directory-picker/picked', requestId, path: '/workspace',
    })).toBe(true)
    expect(isElectronDirectoryPickerParentMessage({
      type: 'dsh/electron-directory-picker/cancelled', requestId,
    })).toBe(true)
    expect(isElectronDirectoryPickerParentMessage({
      type: 'dsh/electron-directory-picker/failed', requestId, message: 'dialog failed',
    })).toBe(true)
    expect(isElectronDirectoryPickerParentMessage({
      type: 'dsh/electron-directory-picker/picked', requestId, path: '',
    })).toBe(false)
    expect(isElectronDirectoryPickerParentMessage({
      type: 'dsh/electron-directory-picker/failed', requestId, message: ' ',
    })).toBe(false)
    expect(isElectronDirectoryPickerParentMessage({
      type: 'dsh/electron-directory-picker/cancelled', requestId, extra: true,
    })).toBe(false)
    expect(isElectronDirectoryPickerParentMessage({
      type: 'dsh/electron-directory-picker/unknown', requestId,
    })).toBe(false)
    expect(isElectronDirectoryPickerParentMessage('message')).toBe(false)
  })
})
