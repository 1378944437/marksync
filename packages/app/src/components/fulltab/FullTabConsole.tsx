import { useState } from 'react'
import { useActiveStorage } from '../../hooks/useActiveStorage'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { useI18n } from '../../i18n'
import { FullTabHeader, type FullTabNavKey } from './FullTabHeader'
import { FullTabSidebar } from './FullTabSidebar'
import { FullTabDashboard } from './FullTabDashboard'
import { FullTabSnapshots } from './FullTabSnapshots'
import { FullTabSettings } from './FullTabSettings'
import { FullTabActivity } from './FullTabActivity'
import { HostPermissionNotice } from '../HostPermissionNotice'

export function FullTabConsole() {
  const [activeNav, setActiveNav] = useState<FullTabNavKey>('dashboard')
  const { isConfigured } = useActiveStorage()
  const isOnline = useOnlineStatus()
  const { t } = useI18n()
  return <div className="console-shell">
    <a className="console-skip-link" href="#console-content">{t('fulltab.skipContent')}</a>
    <FullTabSidebar activeNav={activeNav} onNavigate={setActiveNav} />
    <main id="console-content" className="console-main" aria-labelledby="console-page-title" tabIndex={-1}>
      <FullTabHeader activeNav={activeNav} isOnline={isOnline} isConfigured={isConfigured} />
      <HostPermissionNotice />
      <div className="console-view-slot" key={activeNav}>
        {activeNav === 'dashboard' && <FullTabDashboard onNavigate={setActiveNav} />}
        {activeNav === 'activity' && <FullTabActivity />}
        {activeNav === 'snapshots' && <FullTabSnapshots />}
        {activeNav === 'settings' && <FullTabSettings />}
      </div>
    </main>
  </div>
}
