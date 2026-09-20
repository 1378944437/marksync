import { Activity, Archive, ArrowUpRight, Bookmark, LayoutDashboard, Settings, ShieldCheck } from 'lucide-react'
import { useI18n } from '../../i18n'
import type { FullTabNavKey } from './FullTabHeader'

export function FullTabSidebar({ activeNav, onNavigate }: {
  activeNav: FullTabNavKey; onNavigate: (nav: FullTabNavKey) => void
}) {
  const { t } = useI18n()
  const items = [
    { key: 'dashboard' as const, icon: LayoutDashboard },
    { key: 'activity' as const, icon: Activity },
    { key: 'snapshots' as const, icon: Archive },
    { key: 'settings' as const, icon: Settings },
  ]
  return <aside className="console-sidebar">
    <a className="console-brand" href="#dashboard" onClick={event => { event.preventDefault(); onNavigate('dashboard') }}>
      <span className="console-brand-mark"><Bookmark size={21} strokeWidth={2} /></span>
      <span><strong>MarkSync</strong><small>{t('fulltab.workspace')}</small></span>
    </a>
    <p className="console-nav-caption">{t('fulltab.navigation')}</p>
    <nav aria-label={t('fulltab.navigation')} className="console-navigation">
      {items.map(({ key, icon: Icon }) => <button key={key} type="button"
        aria-label={t(`fulltab.nav.${key}`)} title={t(`fulltab.nav.${key}`)}
        aria-current={activeNav === key ? 'page' : undefined} onClick={() => onNavigate(key)}>
        <Icon size={18} /><span>{t(`fulltab.nav.${key}`)}</span>
        {activeNav === key && <span className="console-nav-indicator" aria-hidden="true" />}
      </button>)}
    </nav>
    <div className="console-sidebar-footer">
      <ShieldCheck size={20} />
      <strong>{t('fulltab.privateTitle')}</strong>
      <p>{t('fulltab.privateHint')}</p>
      <button type="button" onClick={() => onNavigate('settings')}>{t('fulltab.manageConnection')}<ArrowUpRight size={15} /></button>
    </div>
  </aside>
}
