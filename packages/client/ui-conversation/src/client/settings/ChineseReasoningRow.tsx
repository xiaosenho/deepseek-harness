/** General Settings row for opt-in Chinese model reasoning and replies. */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReactNode } from 'react'
import css from './ChineseReasoningRow.module.css'

/** Registration-side preference face. */
export interface ChineseReasoningRowInjected {
  hooks: {
    /** Persisted preference bound as useChineseReasoning. */
    chineseReasoning: SnapshotStore<boolean>
  }
  /** Enable or disable Chinese model reasoning and replies. */
  setChineseReasoning: (enabled: boolean) => void
}

/** Full Settings-row props. */
export type ChineseReasoningRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'conversation'>
  & InjectFace<ChineseReasoningRowInjected>

/**
 * Render the Chinese-reasoning preference switch.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function ChineseReasoningRow({
  useChineseReasoning, setChineseReasoning, t,
}: ChineseReasoningRowProps): ReactNode {
  const enabled = useChineseReasoning(value => value)
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.chineseReasoning.title')}</div>
        <div className={css.desc}>{t('settings.chineseReasoning.description')}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={t('settings.chineseReasoning.title')}
        className={css.switch}
        onClick={() => { setChineseReasoning(!enabled) }}
      >
        <span className={css.thumb} />
      </button>
    </div>
  )
}
