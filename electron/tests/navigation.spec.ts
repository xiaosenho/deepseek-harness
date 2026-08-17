import { describe, expect, it } from 'vitest'
import {
  createApplicationNavigationGuard,
  isApplicationNavigation,
  isExternalNavigation,
} from '../src/navigation.ts'

const appUrl = new URL('http://127.0.0.1:43127/')

describe('navigation', () => {
  it('allows only the current origin in the app window', () => {
    expect(isApplicationNavigation('http://127.0.0.1:43127/session', appUrl)).toBe(true)
    expect(isApplicationNavigation('http://127.0.0.1:43128/', appUrl)).toBe(false)
    expect(isApplicationNavigation('not a url', appUrl)).toBe(false)
  })

  it('follows a later application origin', () => {
    let current = appUrl
    const guard = createApplicationNavigationGuard(() => current)
    expect(guard('http://127.0.0.1:43127/x')).toBe(true)
    current = new URL('http://127.0.0.1:5000/')
    expect(guard('http://127.0.0.1:5000/x')).toBe(true)
    expect(guard('http://127.0.0.1:43127/x')).toBe(false)
  })

  it('only hands HTTP(S) links to the operating system', () => {
    expect(isExternalNavigation('https://example.com')).toBe(true)
    expect(isExternalNavigation('file:///tmp/x')).toBe(false)
    expect(isExternalNavigation('bad')).toBe(false)
  })
})
