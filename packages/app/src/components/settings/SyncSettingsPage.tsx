/**
 * 同步策略子页面
 * 专注于同步行为：按触发机制、同步范围、高级规则清晰分三组
 */
import { toast } from 'sonner'
import { Clock, Cloud, FolderTree, History, RefreshCw, Sliders, Timer } from 'lucide-react'
import { SYNC_SCOPE_KEYS, type SyncScope } from '../../core/bookmark'
import { useI18n } from '../../i18n'
import { useStorage } from '../../hooks/useStorage'
import { cn } from '../../infrastructure/utils/format'
import { SubPageHeader } from './SettingsShared'
import { SettingGroup, SettingRow } from './SettingRow'
import { Input } from '../Input'

export function SyncSettingsPage({ onBack }: { onBack: () => void }) {
  const { t } = useI18n()
  const [autoSyncEnabled, setAutoSyncEnabled] = useStorage('auto_sync_enabled', true)
  const [scheduledSyncEnabled, setScheduledSyncEnabled] = useStorage('scheduled_sync_enabled', false)
  const [scheduledSyncInterval, setScheduledSyncInterval] = useStorage('scheduled_sync_interval', 30)
  const [backupFileInterval, setBackupFileInterval] = useStorage('backup_file_interval', 1)
  const [maxLocalSnapshots, setMaxLocalSnapshots] = useStorage('max_local_snapshots', 15)
  const [maxCloudBackups, setMaxCloudBackups] = useStorage('max_cloud_backups', 15)
  const [missingFolderFallback, setMissingFolderFallback] = useStorage('missing_folder_fallback', false)
  const [syncScope, setSyncScope] = useStorage<SyncScope>('sync_scope', {
    'bookmarks-bar': true,
    other: false,
    mobile: false,
  })

  // 步进调节与规范化（保底 5 份，上限 100 份）
  const stepLocalSnapshots = (delta: number) => {
    const next = Math.max(5, Math.min(100, (Number(maxLocalSnapshots) || 15) + delta))
    setMaxLocalSnapshots(next)
  }

  const stepCloudBackups = (delta: number) => {
    const next = Math.max(5, Math.min(100, (Number(maxCloudBackups) || 15) + delta))
    setMaxCloudBackups(next)
  }

  const normalizeQuota = (val: number, setter: (v: number) => void) => {
    if (isNaN(val) || val < 5) {
      setter(5)
    } else if (val > 100) {
      setter(100)
    } else {
      setter(Math.floor(val))
    }
  }

  // 同步范围校验：至少保留一项
  const updateSyncScope = (key: keyof SyncScope, value: boolean) => {
    if (!value && !SYNC_SCOPE_KEYS.some((k) => k !== key && syncScope[k])) {
      toast.error(t('settings.sync.scopeAllOff'))
      return
    }
    setSyncScope({ ...syncScope, [key]: value })
  }

  // 定时同步配置变更由后台 registerConfigWatcher（storage.onChanged）对账：
  // 页面不得直接触发 updateScheduledSync/maybeRunScheduledSync——
  // popup 中途关闭会中断执行中的同步，留下半恢复的书签树与残留锁。

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <SubPageHeader title={t('settings.sync.title')} onBack={onBack} />
      <div className="space-y-4 pb-4">
        {/* 触发机制 */}
        <SettingGroup title={t('settings.sync.groupTrigger')}>
          <SettingRow
            icon={RefreshCw}
            iconColor="text-indigo-600 bg-indigo-500/10 dark:text-indigo-400"
            label={t('settings.sync.autoSync')}
            description={t('settings.sync.autoSyncDesc')}
            type="switch"
            checked={autoSyncEnabled}
            onCheckedChange={setAutoSyncEnabled}
          />
          <SettingRow
            icon={Clock}
            iconColor="text-sky-600 bg-sky-500/10 dark:text-sky-400"
            label={t('settings.sync.scheduled')}
            description={t('settings.sync.scheduledDesc')}
            type="switch"
            checked={scheduledSyncEnabled}
            onCheckedChange={setScheduledSyncEnabled}
          />
          {scheduledSyncEnabled && (
            <div className="p-3.5 space-y-2 bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="text-xs text-foreground font-medium">{t('settings.sync.interval')}</span>
                <span className="text-[11px] text-muted-foreground">{scheduledSyncInterval} min</span>
              </div>
              <Input
                type="number"
                min={1}
                max={1440}
                value={scheduledSyncInterval}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  if (!isNaN(val) && val >= 1 && val <= 1440) setScheduledSyncInterval(val)
                }}
                className="h-8 text-xs"
              />
              {/* 快捷间隔预设 Pill */}
              <div className="flex items-center gap-1.5 pt-1">
                {[15, 30, 60, 120].map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => setScheduledSyncInterval(mins)}
                    className={cn(
                      'px-2 py-0.5 rounded text-[10px] font-mono border transition-colors',
                      scheduledSyncInterval === mins
                        ? 'bg-primary text-primary-foreground border-primary font-bold shadow-sm'
                        : 'bg-muted/60 text-muted-foreground border-border hover:text-foreground'
                    )}
                  >
                    {mins}m
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">{t('settings.sync.intervalHint')}</p>
            </div>
          )}
        </SettingGroup>

        {/* 2. 同步范围 */}
        <SettingGroup title={t('settings.sync.groupScope')}>
          <div className="px-3.5 py-2 bg-muted/20 border-b border-border/50">
            <p className="text-[11px] text-muted-foreground leading-relaxed">{t('settings.sync.scopeHint')}</p>
          </div>
          {SYNC_SCOPE_KEYS.map((key) => (
            <SettingRow
              key={key}
              icon={FolderTree}
              iconColor="text-emerald-600 bg-emerald-500/10 dark:text-emerald-400"
              label={t(`settings.sync.scope_${key.replace(/-/g, '_')}`)}
              type="switch"
              checked={syncScope[key]}
              onCheckedChange={(checked) => updateSyncScope(key, checked)}
            />
          ))}
        </SettingGroup>

        {/* 3. 快照与容灾配额 */}
        <SettingGroup title={t('settings.sync.groupBackup')}>
          <SettingRow
            icon={History}
            iconColor="text-teal-600 bg-teal-500/10 dark:text-teal-400"
            label={t('settings.sync.maxLocalSnapshots')}
            tooltip={t('settings.sync.maxLocalSnapshotsDesc')}
            type="custom"
          >
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => stepLocalSnapshots(-1)}
                disabled={maxLocalSnapshots <= 5}
                className="w-7 h-7 flex items-center justify-center rounded-md border border-border bg-background hover:bg-secondary active:scale-95 text-xs text-foreground font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                -
              </button>
              <Input
                type="number"
                min={5}
                max={100}
                value={maxLocalSnapshots}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  if (!isNaN(val)) setMaxLocalSnapshots(Math.min(100, Math.max(1, val)))
                }}
                onBlur={() => normalizeQuota(maxLocalSnapshots, setMaxLocalSnapshots)}
                className="w-11 h-7 text-xs text-center p-0 font-medium"
                inputMode="numeric"
              />
              <button
                type="button"
                onClick={() => stepLocalSnapshots(1)}
                disabled={maxLocalSnapshots >= 100}
                className="w-7 h-7 flex items-center justify-center rounded-md border border-border bg-background hover:bg-secondary active:scale-95 text-xs text-foreground font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                +
              </button>
              <span className="text-[11px] text-muted-foreground ml-1">{t('settings.sync.copies')}</span>
            </div>
          </SettingRow>

          <SettingRow
            icon={Cloud}
            iconColor="text-sky-600 bg-sky-500/10 dark:text-sky-400"
            label={t('settings.sync.maxCloudBackups')}
            tooltip={t('settings.sync.maxCloudBackupsDesc')}
            type="custom"
          >
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => stepCloudBackups(-1)}
                disabled={maxCloudBackups <= 5}
                className="w-7 h-7 flex items-center justify-center rounded-md border border-border bg-background hover:bg-secondary active:scale-95 text-xs text-foreground font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                -
              </button>
              <Input
                type="number"
                min={5}
                max={100}
                value={maxCloudBackups}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  if (!isNaN(val)) setMaxCloudBackups(Math.min(100, Math.max(1, val)))
                }}
                onBlur={() => normalizeQuota(maxCloudBackups, setMaxCloudBackups)}
                className="w-11 h-7 text-xs text-center p-0 font-medium"
                inputMode="numeric"
              />
              <button
                type="button"
                onClick={() => stepCloudBackups(1)}
                disabled={maxCloudBackups >= 100}
                className="w-7 h-7 flex items-center justify-center rounded-md border border-border bg-background hover:bg-secondary active:scale-95 text-xs text-foreground font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                +
              </button>
              <span className="text-[11px] text-muted-foreground ml-1">{t('settings.sync.copies')}</span>
            </div>
          </SettingRow>

          <SettingRow
            icon={Timer}
            iconColor="text-amber-600 bg-amber-500/10 dark:text-amber-400"
            label={t('settings.sync.backupInterval')}
            tooltip={t('settings.sync.backupIntervalHint')}
            type="select"
          >
            <select
              value={backupFileInterval}
              onChange={(e) => setBackupFileInterval(parseInt(e.target.value, 10))}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-background border border-border text-foreground focus:outline-none"
            >
              <option value={1}>{t('settings.sync.minute1')}</option>
              <option value={5}>{t('settings.sync.minute5')}</option>
              <option value={10}>{t('settings.sync.minute10')}</option>
              <option value={30}>{t('settings.sync.minute30')}</option>
            </select>
          </SettingRow>
        </SettingGroup>

        {/* 4. 高级容错规则 */}
        <SettingGroup title={t('settings.sync.groupAdvanced')}>
          <SettingRow
            icon={Sliders}
            iconColor="text-zinc-600 bg-zinc-500/10 dark:text-zinc-400"
            label={t('settings.sync.missingFolderFallback')}
            tooltip={t('settings.sync.missingFolderFallbackDesc')}
            type="switch"
            checked={missingFolderFallback}
            onCheckedChange={setMissingFolderFallback}
          />
        </SettingGroup>
      </div>
    </div>
  )
}
