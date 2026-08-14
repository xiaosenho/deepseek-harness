import { describe, expect, it } from 'vitest'
import { isApplicationNavigation, isExternalNavigation } from '../src/navigation.ts'

const applicationUrl = new URL('http://127.0.0.1:43127/')

describe('Electron renderer navigation', () => {
  it('keeps only the active Web-profile origin in the desktop window', () => {
    expect(isApplicationNavigation('http://127.0.0.1:43127/settings', applicationUrl)).toBe(true)
    expect(isApplicationNavigation('http://127.0.0.1:43128/', applicationUrl)).toBe(false)
    expect(isApplicationNavigation('https://example.com/', applicationUrl)).toBe(false)
    expect(isApplicationNavigation('not-a-url', applicationUrl)).toBe(false)
  })

  it('hands only HTTP links to the operating system', () => {
    expect(isExternalNavigation('https://example.com/')).toBe(true)
    expect(isExternalNavigation('http://example.com/')).toBe(true)
    expect(isExternalNavigation('file:///etc/passwd')).toBe(false)
    expect(isExternalNavigation('javascript:alert(1)')).toBe(false)
  })
})
