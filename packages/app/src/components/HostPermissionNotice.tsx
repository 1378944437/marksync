import { useEffect, useState } from 'react'
import browser from 'webextension-polyfill'
import { toast } from 'sonner'
import { useActiveStorage } from '../hooks/useActiveStorage'
import { useI18n } from '../i18n'
import { missingHostPermissions, requestHostPermissions, watchHostPermissions } from '../infrastructure/browser/host-permissions'
import { getStorageIdentifier } from '../core/storage/types'
import { Button } from './Button'

/** 已保存目标与后台遇到的受信任下载主机；切换目标后重新检查。 */
export function HostPermissionNotice() {
  const { t } = useI18n()
  const { isConfigured, getConfig } = useActiveStorage()
  const [status, setStatus] = useState({ target: '', missing: [] as string[], error: '' })
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const target = isConfigured ? getStorageIdentifier(getConfig()) : ''
  const { missing, error } = status.target === target ? status : { missing: [], error: '' }

  useEffect(() => {
    let active = true
    let sequence = 0
    const refresh = async () => {
      const current = ++sequence
      try {
        const next = target ? await missingHostPermissions(getConfig()) : []
        if (active && current === sequence) setStatus({ target, missing: next, error: '' })
      } catch (e) {
        if (active && current === sequence) setStatus({ target, missing: [], error: (e as Error).message })
      }
    }
    const changed = (_changes: unknown, area: string) => { if (area === 'local') void refresh() }
    const unwatch = watchHostPermissions(() => { void refresh() })
    browser.storage.onChanged.addListener(changed)
    void refresh()
    return () => { active = false; unwatch(); browser.storage.onChanged.removeListener(changed) }
  }, [target, getConfig, revision])

  if (!isConfigured || (!missing.length && !error)) return null
  return <div role="status" className="mx-4 my-2 p-3 rounded-xl border border-amber-500/40 bg-amber-500/10 text-xs space-y-2 shrink-0">
    <p>{t('repair.hostPermissionHint')}</p>
    {missing.map(origin => <p key={origin} className="font-mono break-all">{origin}</p>)}
    {error && <p>{error}</p>}
    <Button size="sm" disabled={busy} onClick={async () => {
      setBusy(true)
      try {
        await requestHostPermissions(missing)
        setRevision(value => value + 1)
      } catch (e) { toast.error((e as Error).message) }
      finally { setBusy(false) }
    }}>{missing.length ? t('repair.authorizeHost') : t('repair.retry')}</Button>
  </div>
}
