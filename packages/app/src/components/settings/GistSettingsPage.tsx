import browser from 'webextension-polyfill'
import { validateSettings } from '../../application/settings-validation'
import { requestHostPermissions } from '../../infrastructure/browser/host-permissions'
import { GistHistoryAdoption } from './GistHistoryAdoption'
/**
 * GitHub Gist 存储配置子页面
 * 提供 Token 填写、一键自动创建私密 Gist、自定义端点与连通性测试
 */
import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Github,
  Loader2,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { useI18n } from '../../i18n'
import { useStorage } from '../../hooks/useStorage'
import { gistTestInBackground, gistCreateInBackground, type CreatedGist } from '../../application/background-ops'
import { Button } from '../Button'
import { Input } from '../Input'
import { Label } from '../Label'
import { SubPageHeader } from './SettingsShared'

export function GistSettingsPage({ onBack }: { onBack: () => void }) {
  const { t } = useI18n()
  const [token] = useStorage('gist_token', '')
  const [gistId] = useStorage('gist_id', '')
  const [endpoint] = useStorage('gist_endpoint', 'https://api.github.com')
  const [createdGist] = useStorage<CreatedGist | null>('last_created_gist', null)

  // 本地受控输入状态
  const [localToken, setLocalToken] = useState(token)
  const [localGistId, setLocalGistId] = useState(gistId)
  const [localEndpoint, setLocalEndpoint] = useState(endpoint)

  const [showToken, setShowToken] = useState(false)
  const [testing, setTesting] = useState(false)
  const [creating, setCreating] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    setLocalToken((prev) => (prev === '' ? token : prev))
  }, [token])
  useEffect(() => {
    setLocalGistId((prev) => (prev === '' ? gistId : prev))
  }, [gistId])
  useEffect(() => {
    setLocalEndpoint((prev) => (prev === 'https://api.github.com' ? endpoint : prev))
  }, [endpoint])

  const saveDraft = async () => {
    try {
      const values = { gist_token: localToken.trim(), gist_id: localGistId.trim(), gist_endpoint: localEndpoint.trim() }
      validateSettings(values)
      if (!values.gist_id || !values.gist_token) throw new Error(t('settings.gist.tokenRequired'))
      await requestHostPermissions([values.gist_endpoint || 'https://api.github.com'])
      await browser.storage.local.set(values)
      toast.success(t('settings.security.savedToast'))
    } catch (error) { toast.error((error as Error).message) }
  }

  // 测试连通性
  const handleTest = async () => {
    if (!localToken.trim()) {
      toast.error(t('settings.gist.tokenRequired'))
      return
    }

    setTesting(true)
    try {
      await requestHostPermissions([localEndpoint.trim() || 'https://api.github.com'])
      const res = await gistTestInBackground({
        token: localToken.trim(),
        gistId: localGistId.trim(),
        endpoint: localEndpoint.trim(),
      })
      if (res.ok) {
        toast.success(t('settings.gist.connected'), { description: res.message })
      } else {
        toast.error(t('settings.gist.connectFailed'), { description: res.error })
      }
    } catch (err) {
      toast.error(t('settings.gist.connectError'), { description: (err as Error).message })
    } finally {
      setTesting(false)
    }
  }

  // 自动在云端创建全新的私密 Gist
  const handleAutoCreateGist = async () => {
    if (!localToken.trim()) {
      toast.error(t('settings.gist.tokenRequiredAuto'))
      return
    }

    setCreating(true)
    try {
      await requestHostPermissions([localEndpoint.trim() || 'https://api.github.com'])
      const res = await gistCreateInBackground(
        { token: localToken.trim(), endpoint: localEndpoint.trim(), gistId: '' },
        'MarkSync Bookmarks Sync (汇签云端私密书签备份)',
        false,
      )
      if (!res.ok) throw new Error(res.error)
      setLocalGistId(res.id)
      toast.success(t('settings.gist.created'), { description: `Gist ID: ${res.id}` })
    } catch (err) {
      toast.error(t('settings.gist.createFailed'), { description: (err as Error).message })
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-4 pb-4">
      <SubPageHeader title={t('settings.gist.title')} onBack={onBack} />
      {createdGist && (createdGist.id !== gistId || createdGist.endpoint !== endpoint.replace(/\/+$/, '')) && (
        <div className="p-3 rounded-xl border border-border space-y-2 text-xs">
          <p>{t('repair.gistCreatedDraft')}</p>
          <p className="font-mono break-all">{createdGist.endpoint} · {createdGist.id}</p>
          <Button size="sm" disabled={creating || testing} onClick={() => {
            setLocalGistId(createdGist.id)
            setLocalEndpoint(createdGist.endpoint)
          }}>{t('repair.gistUseCreated')}</Button>
        </div>
      )}

      {/* 优势与安全提示条 */}
      <div className="flex items-start gap-2.5 p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-xs">
        <Github className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold">{t('settings.gist.bannerTitle')}</p>
          <p className="text-[11px] opacity-90">
            {t('settings.gist.bannerDesc')}
          </p>
        </div>
      </div>

      {/* Token 输入 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="gist-token" className="text-xs">{t('settings.gist.tokenLabel')}</Label>
          <a
            href="https://github.com/settings/tokens/new?scopes=gist&description=MarkSync"
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-primary hover:underline flex items-center gap-0.5"
          >
            <span>{t('settings.gist.generateToken')}</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <div className="relative">
          <Input
            type={showToken ? 'text' : 'password'}
            id="gist-token"
            value={localToken}
            onChange={(e) => setLocalToken(e.target.value)}
            placeholder={t('settings.gist.tokenPlaceholder')}
            className="pr-9 font-mono text-xs"
          />
          <button
            type="button"
            onClick={() => setShowToken(!showToken)}
            aria-label={t(showToken ? 'settings.webdav.hidePassword' : 'settings.webdav.showPassword')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Gist ID 输入与自动创建 */}
      <div className="space-y-2">
        <Label htmlFor="gist-id" className="text-xs">{t('settings.gist.idLabel')}</Label>
        <div className="flex gap-2">
          <Input
            id="gist-id"
            value={localGistId}
            onChange={(e) => setLocalGistId(e.target.value)}
            placeholder={t('settings.gist.idPlaceholder')}
            className="font-mono text-xs flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAutoCreateGist}
            disabled={creating || !localToken}
            className="gap-1 text-xs shrink-0"
            title={t('settings.gist.autoCreateTooltip')}
          >
            {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-indigo-500" />}
            <span>{t('settings.gist.autoCreate')}</span>
          </Button>
        </div>
        {localGistId && (
          <a
            href={`https://gist.github.com/${localGistId}`}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 mt-1"
          >
            <span>{t('settings.gist.viewHistory')}</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {/* 高级选项折叠：自定义 API 端点（支持自建反代/镜像） */}
      <div className="pt-1">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <span>{showAdvanced ? t('settings.gist.advancedCollapse') : t('settings.gist.advancedExpand')}</span>
        </button>

        {showAdvanced && (
          <div className="mt-2.5 space-y-1.5 p-3 rounded-xl bg-muted/40 border border-border">
            <Label htmlFor="gist-endpoint" className="text-xs">{t('settings.gist.endpointLabel')}</Label>
            <Input
              id="gist-endpoint"
            value={localEndpoint}
              onChange={(e) => setLocalEndpoint(e.target.value)}
              placeholder="https://api.github.com"
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              {t('settings.gist.endpointDesc')}
            </p>
          </div>
        )}
      </div>

      <Button onClick={saveDraft} disabled={testing || creating} className="w-full">{t('repair.saveDraft')}</Button>
      <GistHistoryAdoption config={{ type: 'gist', token, gistId, endpoint }} />
      {/* 底部操作按钮 */}
      <div className="pt-2">
        <Button
          onClick={handleTest}
          disabled={testing || !localToken}
          className="w-full gap-2 h-10 text-xs font-semibold"
        >
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          <span>{testing ? t('settings.gist.testing') : t('settings.gist.testBtn')}</span>
        </Button>
      </div>
    </div>
  )
}
