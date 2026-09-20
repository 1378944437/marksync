/**
 * 端到端加密设置区块
 * 采用显式保存与草稿隔离架构，彻底杜绝打字即落盘；
 * 清晰划分「未配置」、「已启用保护」、「修改主密码」三大状态，支持密码强度分析与安全关闭防手滑确认
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { Eye, EyeOff, KeyRound, Loader2, Lock } from 'lucide-react'
import { getActiveStorageConfig } from '../../application/state-manager'
import { migrateEncryptionInBackground, cancelEncryptionMigrationInBackground } from '../../application/background-ops'
import { useI18n } from '../../i18n'
import { useStorage } from '../../hooks/useStorage'
import { Button } from '../Button'
import { Input } from '../Input'
import { Label } from '../Label'
import { cn } from '../../infrastructure/utils/format'
import { PasswordStrengthBar } from './PasswordStrengthBar'
import { DisableE2EConfirmCard } from './DisableE2EConfirmCard'
import { E2EEnabledCard } from './E2EEnabledCard'
import { HelpTip } from '../HelpTip'

export function E2EEncryptionSection() {
  const { t } = useI18n()
  const [e2eEnabled] = useStorage('e2e_enabled', false)
  const [e2ePassphrase] = useStorage('e2e_passphrase', '')

  const [pending] = useStorage('encryption_migration', null)

  // 纯本地草稿状态：未点击保存前绝不写入持久化存储
  const [draftPassword, setDraftPassword] = useState('')
  const [draftConfirm, setDraftConfirm] = useState('')
  const [showDraftPassword, setShowDraftPassword] = useState(false)

  // 界面模式控制
  const [showDisableConfirm, setShowDisableConfirm] = useState(false)
  const [reuploading, setReuploading] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const isMismatch = draftConfirm.length > 0 && draftPassword !== draftConfirm

  const handleCancelMigration = async () => {
    if (cancelling) return
    setCancelling(true)
    try {
      const { config } = await getActiveStorageConfig()
      if (!config) throw new Error(t('settings.sync.e2eNeedWebdav'))
      const result = await cancelEncryptionMigrationInBackground(config)
      if (!result.success) throw new Error(result.message)
      toast.success(result.message)
    } catch (error) { toast.error((error as Error).message) }
    finally { setCancelling(false) }
  }

  const handleReupload = async (enabled = e2eEnabled, passphrase = e2ePassphrase) => {
    if (reuploading) return
    setReuploading(true)
    try {
      const { config } = await getActiveStorageConfig()
      if (!config) throw new Error(t('settings.sync.e2eNeedWebdav'))
      const result = await migrateEncryptionInBackground(config, { enabled, passphrase })
      if (!result.success) throw new Error(result.message)
      setDraftPassword(''); setDraftConfirm(''); setShowDisableConfirm(false)
      toast.success(result.message)
    } catch (error) { toast.error((error as Error).message) }
    finally { setReuploading(false) }
  }
  const handleEnableAndSave = () => {
    if (draftPassword.length < 8 || draftPassword !== draftConfirm) return
    void handleReupload(true, draftPassword)
  }
  const handleSaveNewPassword = (passphrase: string) => { void handleReupload(true, passphrase) }
  const handleToggleClick = (enabled: boolean) => {
    if (!enabled) setShowDisableConfirm(true)
    else if (e2ePassphrase.length >= 8) void handleReupload(true)
    else toast.error(t('settings.security.passwordMinLength'))
  }
  const confirmDisable = () => { void handleReupload(false, '') }

  return (
    <div className="space-y-4">
      {pending && (
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={reuploading || cancelling} onClick={() => void handleReupload()}>{t('repair.resumeEncryption')}</Button>
          <Button size="sm" variant="outline" disabled={cancelling || reuploading} onClick={() => void handleCancelMigration()}>
            {cancelling && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
            {t('repair.cancelEncryption')}
          </Button>
        </div>
      )}
      {/* 核心卡片容器 */}
      <div className="p-4 surface-card space-y-4 border border-border/60 dark:border-white/[0.08]">
        {/* 顶部标题与主开关 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Label className="text-foreground text-sm font-semibold flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-primary" />
              <span>{t('settings.sync.e2eSection')}</span>
            </Label>
            <HelpTip content={t('settings.sync.e2eDesc')} />
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              disabled={reuploading || !!pending}
              aria-label={t('settings.sync.e2eSection')}
              checked={e2eEnabled}
              onChange={(e) => handleToggleClick(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-zinc-300/70 dark:bg-white/15 rounded-full peer peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:shadow after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
          </label>
        </div>

        {/* 状态 1：已开启端到端加密 */}
        {e2eEnabled ? (
          <E2EEnabledCard
            passphrase={e2ePassphrase}
            onSaveNewPassword={handleSaveNewPassword}
            onReupload={() => void handleReupload()}
            reuploading={reuploading}
          />
        ) : (
          /* 状态 2：未开启端到端加密表单 */
          <div className="space-y-3 pt-2 border-t border-border/50">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t('settings.sync.e2ePassword')}</Label>
              <div className="relative">
                <Input
                  type={showDraftPassword ? 'text' : 'password'}
                  value={draftPassword}
                  onChange={(e) => setDraftPassword(e.target.value)}
                  placeholder={t('settings.sync.e2ePasswordPlaceholder')}
                  className="pr-10 text-xs h-9"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowDraftPassword(!showDraftPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showDraftPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* 密码强度条 */}
            <PasswordStrengthBar password={draftPassword} t={t} />

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t('settings.sync.e2eConfirm')}</Label>
              <Input
                type={showDraftPassword ? 'text' : 'password'}
                value={draftConfirm}
                onChange={(e) => setDraftConfirm(e.target.value)}
                placeholder={t('settings.sync.e2eConfirmPlaceholder')}
                className={cn("text-xs h-9", isMismatch && "border-rose-500 focus-visible:ring-rose-500")}
                autoComplete="new-password"
              />
              {isMismatch && (
                <p className="text-[11px] text-rose-500 font-medium">
                  {t('settings.security.passwordMismatch')}
                </p>
              )}
            </div>

            <p className="text-[11px] text-amber-600 dark:text-amber-400/90 leading-normal">
              {t('settings.sync.e2eWarn')}
            </p>

            <Button
              size="sm"
              onClick={handleEnableAndSave}
              disabled={reuploading || draftPassword.length < 8 || draftPassword !== draftConfirm}
              className="w-full h-8 text-xs font-medium shadow-sm"
            >
              {reuploading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5 mr-1.5" />}
              {t('settings.security.enableAndSave')}
            </Button>
          </div>
        )}
      </div>

      {/* 关闭加密确认防手滑弹层 */}
      {showDisableConfirm && (
        <DisableE2EConfirmCard
          onCancel={() => setShowDisableConfirm(false)}
          onConfirm={confirmDisable}
          t={t}
        />
      )}
    </div>
  )
}
