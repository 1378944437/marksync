/**
 * 关于页面（版本与应用信息、检查更新）
 * 自 SettingsView 拆出
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Button } from '../Button'
import { SubPageHeader } from './SettingsShared'
import { requestHostPermissions, requireHostPermission } from '../../infrastructure/browser/host-permissions'

// 顶部引入 semver
import semver from 'semver'
import browser from 'webextension-polyfill'
// ...

// ...
export function AboutPage({ onBack }: { onBack: () => void }) {
  const { t } = useI18n()
  const [checking, setChecking] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null)
  
  // 获取当前版本
  const currentVersion = browser.runtime.getManifest().version 

  const checkUpdate = async () => {
    setChecking(true)
    try {
      await requestHostPermissions(['https://api.github.com'])
      await requireHostPermission('https://api.github.com')
      const res = await fetch('https://api.github.com/repos/1378944437/marksync/releases/latest', { redirect: 'error' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      // GitHub release tag might be "v1.0.1", semver needs "1.0.1"
      const remoteVersion = data.tag_name?.replace(/^v/, '')
      if (!semver.valid(remoteVersion)) throw new Error('Invalid release version')
      
      if (remoteVersion && semver.gt(remoteVersion, currentVersion)) {
        setUpdateAvailable(data.tag_name)
        toast.success(t('settings.about.newVersion', { version: data.tag_name }), {
          description: '',
          action: {
            label: t('settings.about.download'),
            onClick: () => window.open(data.html_url, '_blank')
          }
        })
      } else {
        toast.info(t('settings.about.upToDate'))
      }
    } catch (e) {
      toast.error(t('settings.about.checkFailed'), { description: t('settings.about.checkFailedDesc') })
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <SubPageHeader title={t('settings.about.title')} onBack={onBack} />
      <div className="space-y-4 pb-4">
        <div className="p-4 surface-card text-center">
          <h3 className="text-xl font-bold text-foreground">
            <a href="https://github.com/1378944437/marksync" target="_blank" rel="noopener noreferrer" className="hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">MarkSync</a>
          </h3>
          <p className="text-sm text-muted-foreground mt-1">v{currentVersion}</p>
          <p className="text-sm text-muted-foreground mt-2">
            {t('settings.about.forkedFrom')}{' '}
            <a href="https://github.com/Yueby/bookmark-syncer" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Yueby/bookmark-syncer</a>
          </p>
        </div>
        <div className="p-4 surface-card">
          <p className="text-sm text-muted-foreground">
            {t('settings.about.desc')}
          </p>
        </div>
        <div className="p-4 surface-card">
          <p className="text-xs text-muted-foreground">
            {t('settings.about.support')}
          </p>
        </div>
        
        {updateAvailable ? (
          <Button
            className="w-full bg-green-600 hover:bg-green-700 text-white"
            onClick={() => window.open(`https://github.com/1378944437/marksync/releases/tag/${updateAvailable}`, '_blank')}
          >
            {t('settings.about.downloadNew', { version: updateAvailable })}
          </Button>
        ) : (
          <Button
            className="w-full"
            onClick={checkUpdate}
            disabled={checking}
          >
            {checking ? (
               <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('settings.about.checking')}</>
            ) : t('settings.about.checkUpdate')}
          </Button>
        )}
      </div>
    </div>
  )
}
