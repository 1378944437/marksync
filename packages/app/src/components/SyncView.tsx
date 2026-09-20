import { getStorageIdentifier } from '../core/storage/types';
import { RecoveryNotice } from './sync/RecoveryNotice';
/**
 * 同步主视图
 * 统一聚合状态、核心动作、细粒度进度反馈、底栏快照与相关抽屉/模态弹窗
 */
import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Cloud, Monitor, WifiOff } from 'lucide-react'
import { toast } from 'sonner'
import { snapshotManager } from '../core/backup'
import { useI18n } from '../i18n'
import { useStorage } from '../hooks/useStorage'
import { useActiveStorage } from '../hooks/useActiveStorage'
import { useSnapshots } from '../hooks/useSnapshots'
import { useCloudBackups } from '../hooks/useCloudBackups'
import { useBookmarkCounts } from '../hooks/useBookmarkCounts'
import { useSyncActions } from '../hooks/useSyncActions'
import { useSyncCompletionToast } from '../hooks/useSyncCompletionToast'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { cn } from '../infrastructure/utils/format'
import { Drawer } from './Drawer'
import { OverwriteConfirmDrawer, RestoreConfirmDrawer } from './sync/ConfirmDrawers'
import { ActionsPanel, CloudBackupsPanel, ConflictPanel, SnapshotHistoryPanel, SyncActivityPanel } from './sync/SyncDrawerPanels'
import { StatsCard } from './StatsCard'
import { SafetyConfirmationCard } from './sync/SafetyConfirmationCard'
import { SyncMainAction } from './sync/SyncMainAction'
import { SyncStatusFeedback } from './sync/SyncStatusFeedback'
import { SyncFooter } from './sync/SyncFooter'

const container = { hidden: { opacity: 0 }, show: { opacity: 1 } }
const item = { hidden: { opacity: 0 }, show: { opacity: 1 } }

export function SyncView() {
  const { t, locale } = useI18n()
  const { isConfigured, getConfig } = useActiveStorage()
  const [syncState] = useStorage<{ time: number; url: string; type: string } | null>('syncState', null)
  const [remoteDevice] = useStorage<{ target?: string; deviceId?: string; deviceName?: string; time: number } | null>('last_remote_device', null)
  const lastRemoteDevice = isConfigured && remoteDevice?.target === getStorageIdentifier(getConfig()) ? remoteDevice : null
  const isOnline = useOnlineStatus()

  useSyncCompletionToast(syncState, t('sync.toast.completed'))

  // 取消恢复流程
  const cancelRestore = () => {
    snapshotsApi.clearPendingRestoreSnapshot()
    cloudBackupsApi.clearPendingRestoreCloudBackup()
    actionsApi.closeConfirm()
  }

  // 计数加载 hook
  const countsApi = useBookmarkCounts({ t, isConfigured, getConfig })

  // 跨 hook 刷新回调（ref 延迟取用，避免循环依赖）
  const refreshersRef = useRef({ loadSnapshots: () => {}, loadCloudBackups: () => {} })

  // 同步动作与视图状态 hook
  const actionsApi = useSyncActions({
    t,
    locale,
    isConfigured,
    isOnline,
    localCount: countsApi.localCount,
    getConfig,
    loadCounts: countsApi.loadCounts,
    setCloudMeta: countsApi.setCloudMeta,
    refreshers: refreshersRef,
  })

  // 视图上下文
  const viewCtx = {
    t,
    setSyncStatus: actionsApi.setSyncStatus,
    setMsg: actionsApi.setMsg,
    setDrawerOpen: actionsApi.setDrawerOpen,
    openConfirm: actionsApi.openConfirm,
    closeConfirm: actionsApi.closeConfirm,
    loadCounts: countsApi.loadCounts,
  }

  const snapshotsApi = useSnapshots(viewCtx)
  const cloudBackupsApi = useCloudBackups({
    ...viewCtx,
    isConfigured,
    getConfig,
    locale,
    loadSnapshots: snapshotsApi.loadSnapshots,
  })

  refreshersRef.current = {
    loadSnapshots: snapshotsApi.loadSnapshots,
    loadCloudBackups: cloudBackupsApi.loadCloudBackups,
  }

  // 存储凭据与同步状态联动刷新（在 countsApi 与 snapshotsApi 声明后按序执行，无 TDZ 风险）
  useEffect(() => {
    const signal = { aborted: false }
    countsApi.loadCounts(signal)
    snapshotsApi.loadSnapshots()
    return () => { signal.aborted = true }
  }, [isConfigured, getConfig, syncState?.time])

  // 两端书签是否完全一致
  const isSynced =
    isConfigured &&
    !countsApi.loading &&
    countsApi.localCount > 0 &&
    countsApi.verified

  return (
    <>
      <RecoveryNotice />
      {countsApi.error && <p role="alert" className="text-sm text-destructive break-words">{countsApi.error}</p>}
      <motion.div
        variants={container}
        initial={false}
        animate="show"
        className="console-sync-view space-y-5 pt-3 h-full flex flex-col relative"
      >
        {/* 离线警示条 */}
        {!isOnline && (
          <motion.div variants={item} className="px-4 py-2 mx-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center justify-center gap-2">
            <WifiOff className="w-4 h-4 shrink-0" />
            <span>{t('sync.offlineBanner')}</span>
          </motion.div>
        )}

        {/* 防误删安全熔断拦截卡片 */}
        <SafetyConfirmationCard
          t={t}
          getConfig={getConfig}
          onOpenHistory={actionsApi.openHistory}
          loadCounts={countsApi.loadCounts}
        />

        {/* 书签统计卡片（支持点击直达快照历史与云端备份列表） */}
        <motion.div variants={item} className="grid grid-cols-2 gap-3 px-1">
          <StatsCard
            label={t('sync.stats.local')}
            count={countsApi.localCount}
            loading={false}
            color="zinc"
            icon={Monitor}
            onClick={actionsApi.openHistory}
            tooltip={t('sync.stats.viewLocalSnapshots')}
          />
          <StatsCard
            label={t('sync.stats.cloud')}
            count={countsApi.cloudCount}
            unknown={!!countsApi.error}
            loading={countsApi.loading}
            color="indigo"
            icon={Cloud}
            isSynced={isSynced}
            syncedTooltip={t('sync.stats.synced')}
            onClick={() => {
              if (!isConfigured) return void toast.info(t('sync.needConfigFirst'))
              if (!isOnline) return void toast.warning(t('sync.offlineBanner'))
              actionsApi.openCloudBackups()
            }}
            tooltip={t('sync.stats.viewCloudBackups')}
          />
        </motion.div>

        {/* 未配置提示 */}
        {!isConfigured && (
          <motion.div variants={item} className="px-4 py-2 mx-2 rounded-lg bg-primary/10 border border-primary/20 text-muted-foreground text-xs text-center">
            {t('sync.stats.notConfigured')}
          </motion.div>
        )}

        {/* 核心同步交互区 */}
        <motion.div variants={item} className="flex-1 flex flex-col justify-center items-center space-y-4 px-4">
          {!isConfigured ? (
            <div className="text-center text-muted-foreground py-8 text-sm">{t('sync.needConfigFirst')}</div>
          ) : (
            <>
              {/* 大圆主同步按钮（无附属小按钮干扰） */}
              <SyncMainAction
                isOnline={isOnline}
                isConfigured={isConfigured}
                syncStatus={actionsApi.syncStatus}
                isSyncBusy={actionsApi.isSyncBusy}
                onSync={actionsApi.handleSmartSync}
                t={t}
              />

              {/* 细粒度步骤推进文案、错误气泡与独立更多选项入口 */}
              <SyncStatusFeedback
                t={t}
                isOnline={isOnline}
                isSyncBusy={actionsApi.isSyncBusy}
                syncStatus={actionsApi.syncStatus}
                msg={actionsApi.msg}
                cloudMeta={countsApi.cloudMeta}
                lastRemoteDevice={lastRemoteDevice}
                onOpenMoreActions={actionsApi.openMoreActions}
              />
            </>
          )}
        </motion.div>

        {/* 底栏快照入口（含真实快照数量与展开箭头） */}
        <motion.div variants={item} className="mt-auto">
          <SyncFooter
            t={t}
            snapshotCount={snapshotsApi.snapshots.length}
            onOpenHistory={actionsApi.openHistory}
          />
        </motion.div>
      </motion.div>

      {/* 抽屉面板（操作/云端备份/快照历史/冲突处理） */}
      <Drawer
        isOpen={actionsApi.drawerOpen}
        onClose={actionsApi.closeDrawer}
        title={
          actionsApi.drawerMode === 'history'
            ? t('sync.drawer.title.history')
            : actionsApi.drawerMode === 'cloudBackups'
            ? t('sync.drawer.title.cloudBackups')
            : actionsApi.drawerMode === 'actions'
            ? t('sync.drawer.title.actions')
            : actionsApi.drawerMode === 'activity'
            ? t('repair.activityTitle')
            : t('sync.drawer.title.conflict')
        }
      >
        {actionsApi.drawerMode === 'actions' ? (
          <ActionsPanel
            t={t}
            cn={cn}
            isOnline={isOnline}
            isSyncBusy={actionsApi.isSyncBusy}
            localCount={countsApi.localCount}
            openCloudBackups={actionsApi.openCloudBackups}
            requestForcePush={actionsApi.requestForcePush}
            openActivity={actionsApi.openActivity}
          />
        ) : actionsApi.drawerMode === 'cloudBackups' ? (
          <CloudBackupsPanel
            t={t}
            cloudBackups={cloudBackupsApi.cloudBackups}
            loadingCloudBackups={cloudBackupsApi.loadingCloudBackups}
            requestRestoreCloudBackup={cloudBackupsApi.requestRestoreCloudBackup}
          />
        ) : actionsApi.drawerMode === 'history' ? (
          <SnapshotHistoryPanel
            t={t}
            snapshots={snapshotsApi.snapshots}
            loadSnapshots={snapshotsApi.loadSnapshots}
            requestRestoreSnapshot={snapshotsApi.requestRestoreSnapshot}
            snapshotManager={snapshotManager}
          />
        ) : actionsApi.drawerMode === 'activity' ? (
          <SyncActivityPanel />
        ) : actionsApi.drawerMode === 'conflict' ? (
          <ConflictPanel
            t={t}
            cn={cn}
            isOnline={isOnline}
            isSyncBusy={actionsApi.isSyncBusy}
            localCount={countsApi.localCount}
            cloudCount={countsApi.cloudCount}
            cloudMeta={countsApi.cloudMeta}
            executePull={actionsApi.executePull}
            forceNewBackup={actionsApi.forceNewBackup}
            requestForcePush={actionsApi.requestForcePush}
          />
        ) : null}
      </Drawer>

      {/* 居中二次确认模态框 */}
      <OverwriteConfirmDrawer
        isOpen={actionsApi.confirmPushOpen}
        onClose={actionsApi.closeConfirmPush}
        onConfirm={actionsApi.confirmForcePush}
        busy={actionsApi.isSyncBusy}
        online={isOnline}
        localCount={countsApi.localCount}
        t={t}
      />

      <RestoreConfirmDrawer
        isOpen={actionsApi.confirmDrawerOpen}
        onClose={cancelRestore}
        snapshot={snapshotsApi.pendingRestoreSnapshot}
        cloudBackup={cloudBackupsApi.pendingRestoreCloudBackup}
        onConfirmSnapshot={snapshotsApi.confirmRestoreSnapshot}
        onConfirmCloudBackup={cloudBackupsApi.confirmRestoreCloudBackup}
        passphrase={cloudBackupsApi.restorePassphrase}
        onPassphraseChange={cloudBackupsApi.setRestorePassphrase}
        t={t}
      />
    </>
  )
}
