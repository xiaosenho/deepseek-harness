import { useState, type ReactNode } from 'react'
import { Button, IconDownloadOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ElectronUpdateState } from '../bridge-contract.ts'
import type { DesktopControlFace } from './contract.ts'
import css from './desktop.module.css'

/** Software-information row props. */
export type SoftwareInfoItemProps = PropsRuntime<'settings.general.item'>
  & PropsLocale<'desktop.electron'> & DesktopControlFace

function updateLabel(state: ElectronUpdateState, t: SoftwareInfoItemProps['t']): string {
  switch (state.status) {
    case 'idle': return t('updateNoRelease')
    case 'checking': return t('updateChecking')
    case 'current': return t('updateCurrent')
    case 'disabled':
    case 'unsupported': return t('updateUnavailable')
    case 'no-release': return t('updateNoRelease')
    case 'failed': return t('updateFailed')
    case 'ready': return t('updateReady').replace('{version}', state.version)
  }
}

/** Render installed version, release notes, and manual update actions in General Settings. */
export function SoftwareInfoItem({
  useDesktopControl, checkForUpdates, installUpdate, t,
}: SoftwareInfoItemProps): ReactNode {
  const snapshot = useDesktopControl(value => value)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  if (snapshot.phase !== 'ready') {
    return <section className={css.infoCard}><h2 className={css.title}>{t('softwareTitle')}</h2></section>
  }
  const { currentVersion, update } = snapshot.value
  const run = async (operation: () => Promise<unknown>): Promise<void> => {
    setPending(true)
    setFailed(false)
    try { await operation() } catch { setFailed(true) } finally { setPending(false) }
  }
  const canCheck = !['checking', 'disabled', 'unsupported', 'ready'].includes(update.status)

  return (
    <section className={css.infoCard}>
      <div className={css.infoHeader}>
        <div>
          <h2 className={css.title}>{t('softwareTitle')}</h2>
          <p className={css.versionLine}>{t('currentVersion')} <strong>{currentVersion}</strong></p>
        </div>
        <span className={css.updateStatus}>{updateLabel(update, t)}</span>
      </div>
      {update.status === 'ready' && (
        <div className={css.releaseNotes}>
          <h3>{t('releaseNotes')}</h3>
          <p>{update.changelog}</p>
        </div>
      )}
      <div className={css.actions}>
        {canCheck && (
          <Button variant="outline" disabled={pending} onClick={() => { void run(checkForUpdates) }}>
            {t('checkUpdates')}
          </Button>
        )}
        {update.status === 'ready' && (
          <Button
            variant="primary"
            icon={<IconDownloadOutline16 size={16} />}
            disabled={pending}
            onClick={() => { void run(installUpdate) }}
          >
            {t('installUpdate')}
          </Button>
        )}
      </div>
      {failed && <p className={css.error} role="alert">{t('operationFailed')}</p>}
    </section>
  )
}
