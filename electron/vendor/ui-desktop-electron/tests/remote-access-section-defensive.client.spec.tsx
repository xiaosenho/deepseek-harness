// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { DesktopControlSnapshot } from '../src/client/desktop-controller.ts'
import type { RemoteAccessSectionProps } from '../src/client/RemoteAccessSection.tsx'
import { en } from '../src/client/locales.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>()
  return {
    ...actual,
    Modal: ({ footer }: { footer?: ReactNode }) => <div data-testid="modal-footer-probe">{footer}</div>,
  }
})

const { RemoteAccessSection } = await import('../src/client/RemoteAccessSection.tsx')

afterEach(cleanup)

it('keeps the closed confirmation footer inert', () => {
  const setRemoteAccessEnabled = vi.fn(() => Promise.resolve(true))
  const t: RemoteAccessSectionProps['t'] = key => (en as Record<string, string>)[key] ?? key
  render(<RemoteAccessSection
    useSessions={vi.fn() as never}
    useWorkspaces={vi.fn() as never}
    close={vi.fn()}
    useDesktopControl={function useDesktopControl<S>(
      selector: (value: DesktopControlSnapshot) => S,
    ): S { return selector({ phase: 'failed' }) }}
    setRemoteAccessEnabled={setRemoteAccessEnabled}
    saveRemoteAccessConfiguration={vi.fn(() => Promise.resolve())}
    selectRemoteAccessFile={vi.fn(() => Promise.resolve(null))}
    copyRemoteAccessUrl={vi.fn(() => Promise.resolve(true))}
    checkForUpdates={vi.fn(() => Promise.resolve())}
    installUpdate={vi.fn(() => Promise.resolve(true))}
    t={t}
  />)

  fireEvent.click(screen.getByRole('button', { name: en.confirmDisable }))
  expect(setRemoteAccessEnabled).not.toHaveBeenCalled()
})
