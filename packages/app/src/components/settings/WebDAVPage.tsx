import browser from 'webextension-polyfill'
import { validateSettings } from '../../application/settings-validation'
import { requestHostPermissions } from '../../infrastructure/browser/host-permissions'
/**
 * WebDAV 配置子页面
 * 提供模板与配置草稿，测试与保存分离，显式一次保存完整连接。
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Eye, EyeOff, Info, Loader2 } from 'lucide-react'
import { webdavTestInBackground } from '../../application/background-ops'
import { useI18n } from '../../i18n'
import { useStorage } from '../../hooks/useStorage'
import { Button } from '../Button'
import { Input } from '../Input'
import { Label } from '../Label'
import { SubPageHeader } from './SettingsShared'
import { cn } from '../../infrastructure/utils/format'

export function WebDAVPage({ onBack }: { onBack: () => void }) {
  const { t } = useI18n()
  const [webdavUrl] = useStorage('webdav_url', '')
  const [username] = useStorage('webdav_username', '')
  const [password] = useStorage('webdav_password', '')
  const [testing, setTesting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // 本地受控状态：避免击键高频触发 browser.storage.local.set 广播
  const [localUrl, setLocalUrl] = useState(webdavUrl)
  const [localUsername, setLocalUsername] = useState(username)
  const [localPassword, setLocalPassword] = useState(password)

  // 异步加载存储初值时对齐本地状态
  useEffect(() => {
    setLocalUrl((prev) => (prev === '' ? webdavUrl : prev))
  }, [webdavUrl])
  useEffect(() => {
    setLocalUsername((prev) => (prev === '' ? username : prev))
  }, [username])
  useEffect(() => {
    setLocalPassword((prev) => (prev === '' ? password : prev))
  }, [password])

  const saveDraft = async () => {
    try {
      const values = { webdav_url: localUrl.trim(), webdav_username: localUsername.trim(), webdav_password: localPassword }
      validateSettings(values)
      if (!values.webdav_url) throw new Error(t('settings.webdav.urlInvalid'))
      await requestHostPermissions([values.webdav_url])
      await browser.storage.local.set(values)
      toast.success(t('settings.security.savedToast'))
    } catch (error) { toast.error((error as Error).message) }
  }

  // 常见服务商快速配置模板
  const PROVIDER_TEMPLATES = [
    {
      id: 'jianguo',
      name: t('settings.webdav.providerJianguo'),
      url: 'https://dav.jianguoyun.com/dav/',
    },
    {
      id: 'nextcloud',
      name: t('settings.webdav.providerNextcloud'),
      url: 'https://your-cloud.com/remote.php/dav/files/USERNAME/',
    },
    {
      id: 'infini',
      name: t('settings.webdav.providerInfini'),
      url: 'https://teracloud.jp/dav/',
    },
  ]

  // 应用服务商预设
  const applyProviderTemplate = (templateUrl: string) => {
    setLocalUrl(templateUrl)
  }

  // 检查是否应用了坚果云
  const isJianguoyun = localUrl.includes('jianguoyun.com')

  const testConnection = async () => {
    setTesting(true)
    try {
      // 保存时自动 trim 去除首尾空格（密码保留原样）
      const trimmedUrl = localUrl.trim()
      const trimmedUsername = localUsername.trim()

      // URL 基本格式校验
      if (!/^https?:\/\/.+/i.test(trimmedUrl)) {
        toast.error(t('settings.webdav.urlInvalid'), { description: t('settings.webdav.urlInvalidDesc') })
        return
      }

      validateSettings({ webdav_url: trimmedUrl, webdav_username: trimmedUsername })
      await requestHostPermissions([trimmedUrl])
      // 测试连接（在后台 Service Worker 中执行）
      const testResult = await webdavTestInBackground({
        url: trimmedUrl,
        username: trimmedUsername,
        password: localPassword,
      })
      if (!testResult.ok) {
        throw new Error(testResult.error)
      }

      toast.success(t('settings.webdav.connected'))
    } catch (e) {
      toast.error(t('settings.webdav.connectFailed'), {
        description: (e as Error).message || t('common.unknownError'),
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="flex flex-col">
      <SubPageHeader title={t('settings.webdav.title')} onBack={onBack} />
      <div className="space-y-4 pb-4">
        {/* 常见服务商快速配置模板标签 */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t('settings.webdav.providerTemplates')}</Label>
          <div className="flex flex-wrap gap-2">
            {PROVIDER_TEMPLATES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyProviderTemplate(p.url)}
                className={cn(
                  "px-2.5 py-1 text-xs rounded-full border transition-all",
                  localUrl === p.url || (p.id === 'jianguo' && isJianguoyun)
                    ? "bg-primary/15 border-primary/40 text-primary font-medium shadow-sm"
                    : "bg-muted/50 hover:bg-muted border-border/70 text-muted-foreground hover:text-foreground"
                )}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* 服务器地址输入框 */}
        <div className="space-y-2">
          <Label htmlFor="webdav-url" className="text-muted-foreground">{t('settings.webdav.serverUrl')}</Label>
          <Input
            placeholder="https://dav.example.com/"
            id="webdav-url"
            value={localUrl}
            onChange={(e) => setLocalUrl(e.target.value)}
          />
          {/* 坚果云专用密码温馨提示 */}
          {isJianguoyun && (
            <div className="flex items-start gap-1.5 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-[11px] leading-relaxed">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{t('settings.webdav.jianguoTip')}</span>
            </div>
          )}
        </div>

        {/* 用户名输入框 */}
        <div className="space-y-2">
          <Label htmlFor="webdav-user" className="text-muted-foreground">{t('settings.webdav.username')}</Label>
          <Input
            placeholder="user@example.com"
            id="webdav-user"
            value={localUsername}
            onChange={(e) => setLocalUsername(e.target.value)}
            autoComplete="username"
          />
        </div>

        {/* 密码输入框（带明文显隐控制） */}
        <div className="space-y-2">
          <Label htmlFor="webdav-password" className="text-muted-foreground">{t('settings.webdav.password')}</Label>
          <div className="relative">
            <Input
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••"
              id="webdav-password"
            value={localPassword}
              onChange={(e) => setLocalPassword(e.target.value)}
              className="pr-10"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
              title={showPassword ? t('settings.webdav.hidePassword') : t('settings.webdav.showPassword')}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <Button onClick={saveDraft} disabled={testing} className="w-full">{t('repair.saveDraft')}</Button>
        {/* 测试草稿，不更改当前连接 */}
        <Button onClick={testConnection} disabled={testing} className="w-full mt-4">
          {testing ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('settings.webdav.testing')}</>
          ) : (
            t('repair.testDraft')
          )}
        </Button>
      </div>
    </div>
  )
}
