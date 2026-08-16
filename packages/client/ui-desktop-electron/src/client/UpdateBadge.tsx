import { useState, type ReactNode } from 'react'
import { Button, IconDownloadOutline16, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopControlFace } from './contract.ts'
import css from './desktop.module.css'

/** Product-mark update badge props. */
export type UpdateBadgeProps = PropsRuntime<'sidebar.brand.badge'>
  & PropsLocale<'desktop.electron'> & DesktopControlFace

/** Render a red update dot whose dialog exposes release notes and manual installation. */
export function UpdateBadge({ useDesktopControl, installUpdate, t }: UpdateBadgeProps): ReactNode {
  const snapshot = useDesktopControl(value => value)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const update = snapshot.phase === 'ready' ? snapshot.value.update : undefined
  if (update?.status !== 'ready') return null
  const label = t('updateBadge').replace('{version}', update.version)
  const install = async (): Promise<void> => {
    setPending(true)
    setFailed(false)
    try {
      const started = await installUpdate()
      if (!started) setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
    }
  }
  return (
    <>
      <Tooltip label={label} delayMs={300}>
        <button type="button" className={css.updateDotButton} aria-label={label} onClick={() => { setOpen(true) }}>
          <span className={css.updateDot} />
        </button>
      </Tooltip>
      <Modal
        open={open}
        onClose={() => { if (!pending) setOpen(false) }}
        title={t('updateDialogTitle')}
        closeLabel={t('close')}
        description={t('updateReady').replace('{version}', update.version)}
        footer={(
          <>
            <Button variant="ghost" disabled={pending} onClick={() => { setOpen(false) }}>{t('cancel')}</Button>
            <Button
              variant="primary"
              icon={<IconDownloadOutline16 size={16} />}
              disabled={pending}
              onClick={() => { void install() }}
            >
              {t('installUpdate')}
            </Button>
          </>
        )}
      >
        <div className={css.releaseNotes}>
          <h3>{t('releaseNotes')}</h3>
          <p>{update.changelog}</p>
          {failed && <p className={css.error} role="alert">{t('operationFailed')}</p>}
        </div>
      </Modal>
    </>
  )
}
