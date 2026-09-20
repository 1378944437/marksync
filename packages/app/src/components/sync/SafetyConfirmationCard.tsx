/**
 * 防误删安全熔断二次确认警示卡片
 * 当检测到本地大规模删除触发熔断时展示，提供放行上传与一键恢复选项
 */
import { useState } from "react";
import { RotateCcw, ShieldAlert, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { useStorage } from "../../hooks/useStorage";
import {
  clearPendingSafetyConfirmation,
  type PendingSafetyConfirmation,
} from "../../core/sync/utils/safety-guard";
import { smartPushInBackground, smartPullInBackground, restoreCloudBackupInBackground } from "../../application/background-ops";
import { getStorageIdentifier, type StorageConfig } from "../../core/storage/types";
import { SYNC_SCOPE_KEYS } from '../../core/bookmark/sync-scope';
import { Button } from "../Button";

export interface SafetyConfirmationCardProps {
  t: (key: string, vars?: Record<string, string | number>) => string;
  getConfig: () => StorageConfig;
  onOpenHistory: () => void;
  loadCounts?: () => void;
}

export function SafetyConfirmationCard({
  t,
  getConfig,
  onOpenHistory,
  loadCounts,
}: SafetyConfirmationCardProps) {
  const [pending, setPending] = useStorage<PendingSafetyConfirmation | null>(
    "pending_safety_confirmation",
    null
  );
  const [isPushing, setIsPushing] = useState(false);
  const [passphrase, setPassphrase] = useState('');

  if (!pending) return null;
  const empty = !!pending.emptyAction;
  const receiving = pending.emptyAction === 'pull' || pending.emptyAction === 'restore';
  let currentTarget = '';
  try { currentTarget = getStorageIdentifier(getConfig()); } catch { /* 未配置时不能确认。 */ }
  const wrongTarget = !!pending.target && pending.target !== currentTarget;

  const handleDismiss = async () => {
    await clearPendingSafetyConfirmation();
    setPending(null);
  };

  const handleConfirmPush = async () => {
    if (isPushing || wrongTarget) return;
    setIsPushing(true);
    try {
      const config = getConfig();
      const result = pending.emptyAction === 'pull'
        ? await smartPullInBackground(config, 'overwrite', pending.id)
        : pending.emptyAction === 'restore' && pending.backupPath
          ? await restoreCloudBackupInBackground(config, pending.backupPath, passphrase || undefined, pending.id)
          : await smartPushInBackground(config, { skipSafetyGuard: true, confirmationId: pending.id, confirmEmpty: empty });
      if (result.success) {
        toast.success(t(empty ? 'repair.dangerDone' : "safety.banner.pushSuccess"));
        await clearPendingSafetyConfirmation();
        setPending(null);
        loadCounts?.();
      } else {
        toast.error(t('repair.dangerFailed'), { description: result.message });
      }
    } catch (error) {
      toast.error(t('repair.dangerFailed'), { description: (error as Error).message });
    } finally {
      setIsPushing(false);
    }
  };

  return (
    <div className="mx-1 my-2 p-3.5 rounded-xl border border-rose-500/30 bg-rose-500/10 dark:bg-rose-950/20 text-foreground relative shadow-sm">
      <div className="flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-rose-500/20 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0 mt-0.5">
          <ShieldAlert className="w-5 h-5" />
        </div>

        <div className="flex-1 min-w-0 pr-6">
          <h4 className="text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
            <span>{t(empty ? (receiving ? 'repair.emptyReceiveTitle' : 'repair.emptyPushTitle') : "safety.banner.title")}</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-rose-500/20 border border-rose-500/30">
              -{pending.deletedCount} ({pending.deletePercentage}%)
            </span>
          </h4>

          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
            {t(empty ? (receiving ? 'repair.emptyReceiveHint' : 'repair.emptyPushHint') : "safety.banner.desc", {
              deleted: pending.deletedCount,
              percent: pending.deletePercentage,
              threshold: pending.threshold,
            })}
          </p>
          {empty && <div className="text-[11px] mt-2 space-y-1 break-all">
            <p>{t('repair.emptyTarget', { target: pending.target || '' })}</p>
            <p>{t('repair.emptyScope', { scope: SYNC_SCOPE_KEYS.filter(key => (pending.affectedScope ?? pending.scope)?.[key])
              .map(key => t('settings.sync.scope_' + key.replace('-', '_'))).join(' / ') })}</p>
            {pending.emptyAction === 'restore' && <label className="block">
              {t('repair.oldPassword')}
              <input type="password" autoComplete="off" value={passphrase} onChange={event => setPassphrase(event.target.value)}
                className="mt-1 w-full rounded border bg-background px-2 py-1" />
            </label>}
            {wrongTarget && <p>{t('repair.emptyWrongTarget')}</p>}
          </div>}

          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7 px-2.5 bg-background/80 hover:bg-muted"
              onClick={onOpenHistory}
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              {t("safety.banner.restoreSnapshot")}
            </Button>

            <Button
              size="sm"
              variant="destructive"
              className="text-xs h-7 px-2.5 bg-rose-600 hover:bg-rose-700 text-white"
              disabled={isPushing || wrongTarget}
              onClick={handleConfirmPush}
            >
              <Upload className="w-3.5 h-3.5 mr-1" />
              {isPushing ? t('common.loading') : t(empty ? (receiving ? 'repair.emptyConfirmReceive' : 'repair.emptyConfirmPush') : "safety.banner.confirmPush")}
            </Button>
          </div>
        </div>

        <button
          type="button"
          onClick={handleDismiss}
          title={t("safety.banner.dismiss")}
          className="absolute top-3 right-3 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-rose-500/10 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
