/**
 * 云端备份列表抽屉面板
 * 展示自定义设备备注名称、浏览器标识徽章、书签总数与展开式/常驻恢复操作
 */
import { useState } from 'react'
import { ChevronDown, Download, Laptop, RefreshCw } from 'lucide-react'
import type { CloudBackupFile } from '../../core/sync'
import { cn } from '../../infrastructure/utils/format'
import { Button } from '../Button'

type Translate = (key: string, vars?: Record<string, string | number>) => string

export interface CloudBackupsPanelProps {
  t: Translate
  cloudBackups: CloudBackupFile[]
  loadingCloudBackups: boolean
  requestRestoreCloudBackup: (backup: CloudBackupFile) => void
}

export function CloudBackupsPanel({
  t,
  cloudBackups,
  loadingCloudBackups,
  requestRestoreCloudBackup,
}: CloudBackupsPanelProps) {
  const [expandedPath, setExpandedPath] = useState<string | null>(null)

  const toggleExpand = (path: string) => {
    setExpandedPath(expandedPath === path ? null : path)
  }

  return (
    <div className="space-y-2.5 pt-2 pb-1 select-none">
      <p className="text-xs text-muted-foreground mb-1">{t('sync.cloudBackups.pick')}</p>

      {loadingCloudBackups ? (
        <div className="text-center py-10">
          <RefreshCw className="w-6 h-6 text-muted-foreground animate-spin mx-auto mb-2" />
          <span className="text-xs text-muted-foreground">{t('common.loading')}</span>
        </div>
      ) : cloudBackups.length === 0 ? (
        <p className="text-center text-muted-foreground py-6 text-xs">{t('sync.cloudBackups.empty')}</p>
      ) : (
        cloudBackups.map((backup) => {
          const isExpanded = expandedPath === backup.path
          const displayName = backup.deviceName || (backup.browser ? backup.browser.toUpperCase() : backup.name)

          return (
            <div
              key={backup.path}
              className={cn(
                "rounded-xl border transition-colors overflow-hidden",
                isExpanded
                  ? "bg-accent/40 border-primary/50 shadow-sm"
                  : "bg-muted/40 dark:bg-white/[0.03] border-border hover:border-primary/40 hover:bg-muted/70"
              )}
            >
              {/* 主展示行 */}
              <button type="button" aria-expanded={isExpanded} onClick={() => toggleExpand(backup.path)}
                className="w-full p-3 flex items-center justify-between gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <span className="flex flex-col min-w-0 flex-1">
                  <span className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-1.5 gap-y-1">
                    <Laptop className="w-3.5 h-3.5 text-primary/80 shrink-0" />
                    <span title={displayName} className="min-w-0 text-xs font-semibold text-foreground tracking-tight truncate max-w-full">
                      {displayName}
                    </span>

                    {/* 浏览器类型徽章 */}
                    {backup.browser && (
                      <span className="col-start-2 justify-self-start text-[10px] px-1.5 py-0.5 rounded font-medium leading-none bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 uppercase">
                        {backup.browser}
                      </span>
                    )}
                  </span>

                  <span className="text-[10px] text-muted-foreground mt-1">
                    {new Date(backup.timestamp).toLocaleString()}
                  </span>
                </span>

                {/* 右侧书签数与展开箭头 */}
                <span className="flex items-center gap-1.5 shrink-0">
                  {backup.totalCount !== undefined && (
                    <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-full bg-background/80 border border-border text-foreground/80">
                      {t('sync.cloudBackups.bookmarks', { count: backup.totalCount })}
                    </span>
                  )}
                  <ChevronDown
                    className={cn(
                      "w-3.5 h-3.5 text-muted-foreground transition-transform duration-200",
                      isExpanded && "rotate-180 text-primary"
                    )}
                  />
                </span>
              </button>

              {/* 展开式操作面板 */}
              {isExpanded && (
                <div
                  className="px-3 py-2.5 border-t border-border/50 bg-background/60 flex items-center justify-between gap-2"
                >
                  <span className="text-[11px] text-muted-foreground truncate flex-1 font-mono">
                    {backup.name}
                  </span>
                  <Button
                    size="sm"
                    variant="default"
                    className="text-xs h-9 px-3 gap-1 shadow-sm shrink-0"
                    onClick={() => requestRestoreCloudBackup(backup)}
                  >
                    <Download className="w-3 h-3" />
                    {t('common.restore')}
                  </Button>
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
