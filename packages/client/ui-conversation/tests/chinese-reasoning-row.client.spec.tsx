// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { ChineseReasoningRow } from '../src/client/settings/ChineseReasoningRow.tsx'
import type { ChineseReasoningRowProps } from '../src/client/settings/ChineseReasoningRow.tsx'
import { en } from '../src/client/locales.ts'

describe('ChineseReasoningRow', () => {
  it('renders a switch and forwards the next preference', () => {
    const store = createSnapshotStore(false)
    const setChineseReasoning = vi.fn()
    const props = {
      useChineseReasoning: (select: (value: boolean) => unknown) => select(store.getSnapshot()),
      setChineseReasoning,
      t: (key: keyof typeof en) => en[key],
    } as ChineseReasoningRowProps

    render(<ChineseReasoningRow {...props} />)
    const control = screen.getByRole('switch', { name: en['settings.chineseReasoning.title'] })
    expect(control.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(control)

    expect(setChineseReasoning).toHaveBeenCalledWith(true)
  })
})
