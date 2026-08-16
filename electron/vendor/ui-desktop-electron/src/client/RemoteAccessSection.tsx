import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import {
  Button,
  IconCopyOutline16,
  IconFolderOpenOutline16,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ElectronFrpConfiguration,
  ElectronRemoteAccessConfigurationInput,
  ElectronRemoteAccessMode,
} from '../bridge-contract.ts'
import type { DesktopControlFace } from './contract.ts'
import css from './desktop.module.css'

/** Remote-access Settings section props. */
export type RemoteAccessSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'desktop.electron'> & DesktopControlFace

interface FrpDraft {
  serverAddress: string
  serverPort: string
  remotePort: string
  publicOrigin: string
  executablePath: string
  tlsTrustedCaFile: string
  tlsServerName: string
  allowInsecureHttp: boolean
  authToken: string
  clearAuthToken: boolean
}

function draftFrom(configuration: ElectronFrpConfiguration): FrpDraft {
  return {
    serverAddress: configuration.serverAddress,
    serverPort: String(configuration.serverPort),
    remotePort: String(configuration.remotePort),
    publicOrigin: configuration.publicOrigin,
    executablePath: configuration.executablePath,
    tlsTrustedCaFile: configuration.tlsTrustedCaFile,
    tlsServerName: configuration.tlsServerName,
    allowInsecureHttp: configuration.allowInsecureHttp,
    authToken: '',
    clearAuthToken: false,
  }
}

function validPort(value: string, allowZero: boolean): boolean {
  if (!/^\d+$/u.test(value)) return false
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= (allowZero ? 0 : 1) && parsed <= 65_535
}

function validServerAddress(value: string): boolean {
  const normalized = value.trim()
  return normalized !== '' && !/[\s/@?#]/u.test(normalized) && !normalized.includes('://')
}

function validPublicOrigin(value: string): boolean {
  if (value.trim() === '') return true
  try {
    const origin = new URL(value.trim())
    return (origin.protocol === 'http:' || origin.protocol === 'https:')
      && origin.username === ''
      && origin.password === ''
      && origin.pathname === '/'
      && origin.search === ''
      && origin.hash === ''
  } catch {
    return false
  }
}

function configurationSignature(mode: ElectronRemoteAccessMode, configuration: ElectronFrpConfiguration): string {
  return JSON.stringify([mode, configuration])
}

/** Render the Electron-owned remote-access page without receiving either stored secret. */
export function RemoteAccessSection({
  useDesktopControl,
  setRemoteAccessEnabled,
  saveRemoteAccessConfiguration,
  selectRemoteAccessFile,
  copyRemoteAccessUrl,
  t,
}: RemoteAccessSectionProps): ReactNode {
  const authTokenId = useId()
  const executablePathId = useId()
  const trustedCaPathId = useId()
  const publicOriginId = useId()
  const publicOriginHintId = useId()
  const snapshot = useDesktopControl(value => value)
  const state = snapshot.phase === 'ready' ? snapshot.value.remoteAccess : undefined
  const [mode, setMode] = useState<ElectronRemoteAccessMode>('lan')
  const [draft, setDraft] = useState<FrpDraft>(() => draftFrom({
    serverAddress: '',
    serverPort: 7_000,
    remotePort: 0,
    publicOrigin: '',
    executablePath: 'frpc',
    tlsTrustedCaFile: '',
    tlsServerName: '',
    authTokenConfigured: false,
    allowInsecureHttp: false,
  }))
  const [confirming, setConfirming] = useState<boolean | undefined>(undefined)
  const [pending, setPending] = useState(false)
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const signature = state === undefined ? undefined : configurationSignature(state.preferredMode, state.frp)

  useEffect(() => {
    if (state === undefined) return
    setMode(state.preferredMode)
    setDraft(draftFrom(state.frp))
  }, [signature])
  useEffect(() => { setCopied(false) }, [state?.publicEndpoint, state?.activeMode])

  const enabled = state?.enabled === true
  const busy = pending || state?.transitioning === true
  const baseline = state === undefined ? undefined : draftFrom(state.frp)
  const dirty = state !== undefined && baseline !== undefined && (
    mode !== state.preferredMode
    || draft.serverAddress !== baseline.serverAddress
    || draft.serverPort !== baseline.serverPort
    || draft.remotePort !== baseline.remotePort
    || draft.publicOrigin !== baseline.publicOrigin
    || draft.executablePath !== baseline.executablePath
    || draft.tlsTrustedCaFile !== baseline.tlsTrustedCaFile
    || draft.tlsServerName !== baseline.tlsServerName
    || draft.allowInsecureHttp !== baseline.allowInsecureHttp
    || draft.authToken !== ''
    || draft.clearAuthToken
  )
  const serverInvalid = mode === 'frp' && !validServerAddress(draft.serverAddress)
  const serverPortInvalid = mode === 'frp' && !validPort(draft.serverPort, false)
  const remotePortInvalid = mode === 'frp' && !validPort(draft.remotePort, true)
  const originInvalid = mode === 'frp' && !validPublicOrigin(draft.publicOrigin)
  const automaticOriginInvalid = mode === 'frp'
    && draft.publicOrigin.trim() !== ''
    && draft.remotePort === '0'
  const executableInvalid = mode === 'frp' && draft.executablePath.trim() === ''
  const trustedCaInvalid = mode === 'frp' && draft.tlsTrustedCaFile.trim() === ''
  const tlsServerNameInvalid = mode === 'frp'
    && draft.tlsServerName.trim() !== ''
    && !validServerAddress(draft.tlsServerName)
  const plaintext = draft.publicOrigin.trim() === ''
    || (validPublicOrigin(draft.publicOrigin) && new URL(draft.publicOrigin.trim()).protocol === 'http:')
  const acknowledgementInvalid = mode === 'frp' && plaintext && !draft.allowInsecureHttp
  const invalid = serverInvalid
    || serverPortInvalid
    || remotePortInvalid
    || originInvalid
    || automaticOriginInvalid
    || executableInvalid
    || trustedCaInvalid
    || tlsServerNameInvalid
    || acknowledgementInvalid

  const apply = async (): Promise<void> => {
    if (confirming === undefined) return
    setPending(true)
    setFailed(false)
    try {
      const changed = await setRemoteAccessEnabled(confirming)
      if (!changed) setFailed(true)
      setConfirming(undefined)
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
    }
  }

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (state === undefined || invalid || enabled || !dirty) return
    setPending(true)
    setFailed(false)
    const authToken: ElectronRemoteAccessConfigurationInput['frp']['authToken'] = draft.clearAuthToken
      ? { action: 'clear' }
      : draft.authToken === ''
        ? { action: 'keep' }
        : { action: 'replace', value: draft.authToken }
    try {
      await saveRemoteAccessConfiguration({
        mode,
        frp: {
          serverAddress: draft.serverAddress,
          serverPort: Number(draft.serverPort),
          remotePort: Number(draft.remotePort),
          publicOrigin: draft.publicOrigin,
          executablePath: draft.executablePath,
          tlsTrustedCaFile: draft.tlsTrustedCaFile,
          tlsServerName: draft.tlsServerName,
          allowInsecureHttp: draft.allowInsecureHttp,
          authToken,
        },
      })
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
    }
  }

  const copy = async (): Promise<void> => {
    setFailed(false)
    try {
      const success = await copyRemoteAccessUrl()
      setCopied(success)
      if (!success) setFailed(true)
    } catch {
      setFailed(true)
    }
  }

  const selectFile = async (
    kind: 'frpc-executable' | 'trusted-ca',
    field: 'executablePath' | 'tlsTrustedCaFile',
  ): Promise<void> => {
    setPending(true)
    setFailed(false)
    try {
      const path = await selectRemoteAccessFile(kind)
      if (path !== null) patchDraft(field, path)
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
    }
  }

  const patchDraft = <K extends keyof FrpDraft>(key: K, value: FrpDraft[K]): void => {
    setDraft(current => ({ ...current, [key]: value }))
  }
  const authTokenConfigured = state !== undefined && state.frp.authTokenConfigured
  const publicEndpoint = state?.publicEndpoint
  const status = busy
    ? t('remoteChanging')
    : state?.enabled === true
      ? t(state.activeMode === 'frp' ? 'remoteOnFrp' : 'remoteOnLan')
      : t('remoteOff')
  const validationMessage = serverInvalid
    ? t('serverAddressInvalid')
    : serverPortInvalid
      ? t('serverPortInvalid')
      : remotePortInvalid
        ? t('remotePortInvalid')
        : originInvalid
          ? t('publicOriginInvalid')
          : automaticOriginInvalid
            ? t('automaticOriginInvalid')
            : executableInvalid
              ? t('executableInvalid')
              : trustedCaInvalid
                ? t('trustedCaRequired')
                : tlsServerNameInvalid
                  ? t('tlsServerNameInvalid')
                  : acknowledgementInvalid
                    ? t('plaintextRequired')
                    : undefined

  return (
    <section className={css.section} data-electron-remote-access>
      <div>
        <h2 className={css.title}>{t('remoteTitle')}</h2>
        <p className={css.intro}>{t('remoteIntro')}</p>
      </div>
      <div className={css.modeBlock}>
        <div className={css.rowTitle}>{t('accessMode')}</div>
        <div className={css.segmented} role="group" aria-label={t('accessMode')}>
          {(['lan', 'frp'] as const).map(option => (
            <button
              key={option}
              type="button"
              className={css.segment}
              data-selected={mode === option ? '' : undefined}
              aria-pressed={mode === option}
              disabled={busy || enabled || state === undefined}
              onClick={() => { setMode(option) }}
            >
              {t(option === 'lan' ? 'modeLan' : 'modeFrp')}
            </button>
          ))}
        </div>
      </div>
      {mode === 'frp' && (
        <form className={css.frpForm} onSubmit={(event) => { void save(event) }}>
          <div className={css.formGrid}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('serverAddress')}</span>
              <input
                className={css.input}
                value={draft.serverAddress}
                placeholder="203.0.113.10"
                aria-invalid={serverInvalid || undefined}
                disabled={busy || enabled}
                onChange={(event) => { patchDraft('serverAddress', event.target.value) }}
              />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('serverPort')}</span>
              <input
                className={css.input}
                inputMode="numeric"
                value={draft.serverPort}
                aria-invalid={serverPortInvalid || undefined}
                disabled={busy || enabled}
                onChange={(event) => { patchDraft('serverPort', event.target.value) }}
              />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('remotePort')}</span>
              <input
                className={css.input}
                inputMode="numeric"
                value={draft.remotePort}
                aria-invalid={remotePortInvalid || automaticOriginInvalid || undefined}
                disabled={busy || enabled}
                onChange={(event) => { patchDraft('remotePort', event.target.value) }}
              />
            </label>
            <div className={css.fieldWide}>
              <label className={css.fieldLabel} htmlFor={publicOriginId}>{t('publicOrigin')}</label>
              <input
                id={publicOriginId}
                className={css.input}
                value={draft.publicOrigin}
                placeholder="https://harness.example.com"
                aria-describedby={publicOriginHintId}
                aria-invalid={originInvalid || automaticOriginInvalid || undefined}
                disabled={busy || enabled}
                onChange={(event) => { patchDraft('publicOrigin', event.target.value) }}
              />
              <span id={publicOriginHintId} className={css.fieldHint}>{t('publicOriginHint')}</span>
            </div>
            <div className={css.fieldWide}>
              <label className={css.fieldLabel} htmlFor={executablePathId}>{t('frpcExecutable')}</label>
              <div className={css.fileInputRow}>
                <input
                  id={executablePathId}
                  className={css.input}
                  value={draft.executablePath}
                  aria-invalid={executableInvalid || undefined}
                  disabled={busy || enabled}
                  readOnly
                />
                <Button
                  type="button"
                  variant="outline"
                  icon={<IconFolderOpenOutline16 size={16} />}
                  disabled={busy || enabled}
                  onClick={() => { void selectFile('frpc-executable', 'executablePath') }}
                >
                  {t('selectFile')}
                </Button>
              </div>
            </div>
            <div className={css.fieldWide}>
              <label className={css.fieldLabel} htmlFor={trustedCaPathId}>{t('trustedCaFile')}</label>
              <div className={css.fileInputRow}>
                <input
                  id={trustedCaPathId}
                  className={css.input}
                  value={draft.tlsTrustedCaFile}
                  placeholder="/etc/frp/ca.crt"
                  aria-invalid={trustedCaInvalid || undefined}
                  disabled={busy || enabled}
                  readOnly
                />
                <Button
                  type="button"
                  variant="outline"
                  icon={<IconFolderOpenOutline16 size={16} />}
                  disabled={busy || enabled}
                  onClick={() => { void selectFile('trusted-ca', 'tlsTrustedCaFile') }}
                >
                  {t('selectFile')}
                </Button>
              </div>
            </div>
            <label className={css.fieldWide}>
              <span className={css.fieldLabel}>{t('tlsServerName')}</span>
              <input
                className={css.input}
                value={draft.tlsServerName}
                placeholder={draft.serverAddress.trim() || 'frps.example.com'}
                aria-invalid={tlsServerNameInvalid || undefined}
                disabled={busy || enabled}
                onChange={(event) => { patchDraft('tlsServerName', event.target.value) }}
              />
            </label>
            <div className={css.fieldWide}>
              <label className={css.fieldLabel} htmlFor={authTokenId}>{t('authToken')}</label>
              <input
                id={authTokenId}
                className={css.input}
                type="password"
                autoComplete="off"
                value={draft.authToken}
                placeholder={authTokenConfigured ? t('tokenConfigured') : t('tokenOptional')}
                disabled={busy || enabled || draft.clearAuthToken}
                onChange={(event) => { patchDraft('authToken', event.target.value) }}
              />
              {authTokenConfigured && (
                <button
                  type="button"
                  className={css.clearSecret}
                  disabled={busy || enabled}
                  onClick={() => {
                    patchDraft('clearAuthToken', !draft.clearAuthToken)
                    patchDraft('authToken', '')
                  }}
                >
                  {draft.clearAuthToken ? t('keepToken') : t('clearToken')}
                </button>
              )}
            </div>
          </div>
          {plaintext && (
            <label className={css.acknowledgement}>
              <input
                type="checkbox"
                checked={draft.allowInsecureHttp}
                disabled={busy || enabled}
                onChange={(event) => { patchDraft('allowInsecureHttp', event.target.checked) }}
              />
              <span>{t('plaintextAcknowledgement')}</span>
            </label>
          )}
          {validationMessage !== undefined && <p className={css.error} role="alert">{validationMessage}</p>}
          <div className={css.formActions}>
            <Button variant="primary" type="submit" disabled={!dirty || invalid || busy || enabled}>
              {t('saveConfiguration')}
            </Button>
          </div>
        </form>
      )}
      {mode === 'lan' && dirty && (
        <form className={css.formActions} onSubmit={(event) => { void save(event) }}>
          <Button variant="primary" type="submit" disabled={busy || enabled}>
            {t('saveConfiguration')}
          </Button>
        </form>
      )}
      <div className={css.settingRow}>
        <div>
          <div className={css.rowTitle}>{status}</div>
          <div className={css.rowCaption}>{enabled ? t('remoteDisable') : t('remoteEnable')}</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? t('remoteDisable') : t('remoteEnable')}
          className={css.switch}
          data-on={enabled ? '' : undefined}
          disabled={busy || state === undefined || dirty}
          onClick={() => { setConfirming(!enabled) }}
        >
          <span className={css.switchKnob} />
        </button>
      </div>
      {dirty && !enabled && <p className={css.notice}>{t('saveBeforeEnable')}</p>}
      {enabled && publicEndpoint !== undefined && (
        <div className={css.urlCard}>
          <div className={css.rowTitle}>{t('publicEndpoint')}</div>
          <code className={css.url}>{publicEndpoint}</code>
          <p className={css.warning}>{t('accessWarning')}</p>
          <Button variant="outline" icon={<IconCopyOutline16 size={16} />} onClick={() => { void copy() }}>
            {copied ? t('copied') : t('copyUrl')}
          </Button>
        </div>
      )}
      {(failed || snapshot.phase === 'failed') && <p className={css.error} role="alert">{t('operationFailed')}</p>}
      <Modal
        open={confirming !== undefined}
        onClose={() => { if (!pending) setConfirming(undefined) }}
        title={confirming === true ? t('remoteEnable') : t('remoteDisable')}
        closeLabel={t('close')}
        description={confirming === true
          ? t(state?.preferredMode === 'frp' ? 'remoteEnableConfirmFrp' : 'remoteEnableConfirmLan')
          : t('remoteDisableConfirm')}
        footer={(
          <>
            <Button variant="ghost" disabled={pending} onClick={() => { setConfirming(undefined) }}>{t('cancel')}</Button>
            <Button variant="primary" disabled={pending} onClick={() => { void apply() }}>
              {confirming === true ? t('confirmEnable') : t('confirmDisable')}
            </Button>
          </>
        )}
      />
    </section>
  )
}
