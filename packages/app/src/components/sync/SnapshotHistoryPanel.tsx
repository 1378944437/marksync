/**
 * 本地快照历史抽屉面板
 * 支持标签化时机徽章、卡片轻点展开操作、防误触二次确认与移动端触控适配
 */
import { useState } from 'react'
import { AlertCircle, ChevronDown, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Snapshot } from '../../core/backup'
import { parseSnapshotReason } from '../../infrastructure/utils/snapshot-parser'
import { cn } from '../../infrastructure/utils/format'
import { Button } from '../Button'

type Translate = (key: string, vars?: Record<string, string | number>) => string

export interface SnapshotHistoryPanelProps {
  t: Translate
  snapshots: Snapshot[]
  loadSnapshots: () => void
  requestRestoreSnapshot: (snapshot: Snapshot) => void
  snapshotManager: { deleteSnapshot: (id: number) => Promise<void> }
}

export function SnapshotHistoryPanel({
  t,
  snapshots,
  loadSnapshots,
  requestRestoreSnapshot,
  snapshotManager,
}: SnapshotHistoryPanelProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  const toggleExpand = (id: number) => {
    if (expandedId === id) {
      setExpandedId(null)
      setConfirmDeleteId(null)
    } else {
      setExpandedId(id)
      setConfirmDeleteId(null)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await snapshotManager.deleteSnapshot(id)
      loadSnapshots()
      setExpandedId(null)
      setConfirmDeleteId(null)
      toast.success(t('sync.toast.snapshotDeleted'))
    } catch (e) {
      toast.error('删除快照失败', { description: (e as Error).message })
    }
  }

  return (
    <div className="space-y-2.5 pt-2 pb-1 select-none">
      <p className="text-xs text-muted-foreground mb-1">{t('sync.history.pick')}</p>

      {snapshots.map((s) => {
        const isExpanded = expandedId === s.id
        const isConfirmingDelete = confirmDeleteId === s.id
        const parsed = parseSnapshotReason(s.reason, t('sync.history.autoBackup'))

        return (
          <div
            key={s.id}
            className={cn(
              "rounded-xl border transition-colors overflow-hidden",
              isExpanded
                ? "bg-accent/40 border-primary/50 shadow-sm"
                : "bg-muted/40 dark:bg-white/[0.03] border-border hover:border-primary/40 hover:bg-muted/70"
            )}
          >
            {/* 卡片主展示行 */}
            <button type="button" aria-expanded={isExpanded} onClick={() => toggleExpand(s.id)}
              className="w-full p-3 flex items-center justify-between gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              <span className="flex flex-col min-w-0 flex-1">
                <span className="flex items-center gap-1.5 flex-wrap">
                  <span title={parsed.title} className="min-w-0 line-clamp-2 [overflow-wrap:anywhere] text-xs font-semibold text-foreground tracking-tight">
                    {parsed.title}
                  </span>

                  {/* 触发方式徽章（自动 / 手动） */}
                  {parsed.triggerLabel && (
                    <span
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded font-medium leading-none border",
                        parsed.triggerLabel === '手动'
                          ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20"
                          : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                      )}
                    >
                      {parsed.triggerLabel}
                    </span>
                  )}

                  {/* 动作类型徽章（备份 / 合并 / 覆盖 / 恢复） */}
                  {parsed.actionLabel && (
                    <span
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded font-medium leading-none border",
                        parsed.actionLabel === '合并'
                          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                          : parsed.actionLabel === '覆盖'
                          ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
                          : parsed.actionLabel === '恢复'
                          ? "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20"
                          : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                      )}
                    >
                      {parsed.actionLabel}
                    </span>
                  )}
                </span>

                <span className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(s.timestamp).toLocaleString()}
                  </span>

                  {/* 差分变动微标：绿色 +X，蓝色 ~Y，红色 -Z */}
                  {s.diff && (s.diff.added > 0 || s.diff.updated > 0 || s.diff.deleted > 0) && (
                    <span className="flex items-center gap-1 font-mono text-[9px] font-semibold leading-none">
                      {s.diff.added > 0 && (
                        <span
                          title={`新增 ${s.diff.added} 个书签`}
                          className="text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1 py-0.5 rounded border border-emerald-500/20"
                        >
                          +{s.diff.added}
                        </span>
                      )}
                      {s.diff.updated > 0 && (
                        <span
                          title={`更新 ${s.diff.updated} 个书签`}
                          className="text-sky-600 dark:text-sky-400 bg-sky-500/10 px-1 py-0.5 rounded border border-sky-500/20"
                        >
                          ~{s.diff.updated}
                        </span>
                      )}
                      {s.diff.deleted > 0 && (
                        <span
                          title={`删除 ${s.diff.deleted} 个书签`}
                          className="text-rose-600 dark:text-rose-400 bg-rose-500/10 px-1 py-0.5 rounded border border-rose-500/20"
                        >
                          -{s.diff.deleted}
                        </span>
                      )}
                    </span>
                  )}
                </span>
              </span>

              {/* 右侧数量徽章与展开箭头 */}
              <span className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-full bg-background/80 border border-border text-foreground/80">
                  {t('sync.history.bookmarks', { count: s.count })}
                </span>
                <ChevronDown
                  className={cn(
                    "w-3.5 h-3.5 text-muted-foreground transition-transform duration-200",
                    isExpanded && "rotate-180 text-primary"
                  )}
                />
              </span>
            </button>

            {/* 展开式操作面板（彻底消除隐形误触与空间挤占） */}
            {isExpanded && (
              <div
                className="px-3 py-2.5 border-t border-border/50 bg-background/60 flex items-center justify-between gap-2"
              >
                {isConfirmingDelete ? (
                  <div className="flex items-center justify-between flex-wrap w-full gap-2 py-0.5">
                    <span className="text-xs text-destructive font-medium flex items-center gap-1 shrink-0">
                      <AlertCircle className="w-3.5 h-3.5" /> {t('sync.history.confirmDelete')}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-9 px-2 text-xs"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        {t('common.cancel')}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-9 px-2.5 text-xs"
                        onClick={() => handleDelete(s.id)}
                      >
                        {t('sync.history.confirmDeleteBtn')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-9 px-2.5 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/25"
                      onClick={() => setConfirmDeleteId(s.id)}
                    >
                      <Trash2 className="w-3 h-3 mr-1" />
                      {t('sync.history.delete')}
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      className="text-xs h-9 px-3 gap-1 shadow-sm"
                      onClick={() => requestRestoreSnapshot(s)}
                    >
                      <RotateCcw className="w-3 h-3" />
                      {t('common.restore')}
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}

      {snapshots.length === 0 && (
        <p className="text-center text-muted-foreground py-6 text-xs">{t('sync.history.empty')}</p>
      )}
    </div>
  )
}
