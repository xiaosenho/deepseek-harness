import { describe, expect, it } from 'vitest'
import {
  createApplicationNavigationGuard,
  isApplicationNavigation,
  isExternalNavigation,
  loadRestartedApplication,
} from '../src/navigation.ts'

const applicationUrl = new URL('http://127.0.0.1:43127/')

describe('Electron renderer navigation', () => {
  it('keeps only the active Web-profile origin in the desktop window', () => {
    expect(isApplicationNavigation('http://127.0.0.1:43127/settings', applicationUrl)).toBe(true)
    expect(isApplicationNavigation('http://127.0.0.1:43128/', applicationUrl)).toBe(false)
    expect(isApplicationNavigation('https://example.com/', applicationUrl)).toBe(false)
    expect(isApplicationNavigation('not-a-url', applicationUrl)).toBe(false)
  })

  it('switches its allowlist when a restarted backend gets a new origin', () => {
    let current = applicationUrl
    const isCurrentApplicationNavigation = createApplicationNavigationGuard(() => current)

    expect(isCurrentApplicationNavigation('http://127.0.0.1:43127/settings')).toBe(true)
    expect(isCurrentApplicationNavigation('http://127.0.0.1:43128/settings')).toBe(false)
    current = new URL('http://127.0.0.1:43128/')
    expect(isCurrentApplicationNavigation('http://127.0.0.1:43127/settings')).toBe(false)
    expect(isCurrentApplicationNavigation('http://127.0.0.1:43128/settings')).toBe(true)
  })

  it('updates authorization before loading a restarted backend', async () => {
    const events: string[] = []
    const replacement = new URL('http://127.0.0.1:43128/')

    await loadRestartedApplication(
      replacement,
      (url) => { events.push(`update:${url.origin}`) },
      async (url) => { events.push(`load:${url}`) },
      () => { events.push('fatal') },
    )

    expect(events).toEqual([
      'update:http://127.0.0.1:43128',
      'load:http://127.0.0.1:43128/',
    ])
  })

  it('reports a failed replacement load as fatal after adopting its origin', async () => {
    const events: string[] = []
    const replacement = new URL('http://127.0.0.1:43128/')

    await loadRestartedApplication(
      replacement,
      (url) => { events.push(`update:${url.origin}`) },
      async () => { throw new Error('renderer rejected') },
      (error) => { events.push(`fatal:${error.message}`) },
    )

    expect(events[0]).toBe('update:http://127.0.0.1:43128')
    expect(events[1]).toContain('fatal:The WebUI restarted at http://127.0.0.1:43128')
    expect(events[1]).toContain('renderer rejected')
  })

  it('hands only HTTP links to the operating system', () => {
    expect(isExternalNavigation('https://example.com/')).toBe(true)
    expect(isExternalNavigation('http://example.com/')).toBe(true)
    expect(isExternalNavigation('file:///etc/passwd')).toBe(false)
    expect(isExternalNavigation('javascript:alert(1)')).toBe(false)
  })
})
