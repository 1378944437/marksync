import browser from 'webextension-polyfill'
import type { StorageConfig } from '../../core/storage/types'
import { getStorageIdentifier } from '../../core/storage/types'

const PENDING_PREFIX = 'host_permission_required:'
const BROAD_ORIGINS = new Set(['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*', 'ftp://*/*', 'file:///*'])

export function hostPermissionPattern(value: string): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.hash || url.hostname.includes('*')) throw new Error('Invalid server address / 服务器地址无效')
  // 浏览器主机授权不隔离端口或目录；请求仍使用原始 URL。
  return `${url.protocol}//${url.hostname}/*`
}

export function storageEndpoint(config: StorageConfig): string {
  return 'url' in config ? config.url : config.endpoint?.trim() || 'https://api.github.com'
}

async function pendingKey(config: StorageConfig | string): Promise<string> {
  const identity = typeof config === 'string' ? hostPermissionPattern(config) : getStorageIdentifier(config)
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))
  return PENDING_PREFIX + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** 更新后核对实际权限；撤销失败时停止网络操作，不宣称已收敛。 */
export async function removeLegacyHostPermissions(): Promise<void> {
  const origins = (await browser.permissions.getAll()).origins ?? []
  const broad = origins.filter(origin => BROAD_ORIGINS.has(origin))
  if (!broad.length) return
  await browser.permissions.remove({ origins: broad })
  if ((await browser.permissions.getAll()).origins?.some(origin => BROAD_ORIGINS.has(origin))) {
    throw new Error('Remove all-sites access in extension settings, then retry / 请在扩展管理中撤销全网站权限后重试')
  }
}

function permissionError(): Error {
  return new Error('Site access required; open MarkSync to authorize / 缺少网站访问权限，请打开 MarkSync 授权')
}

/** 必须在按钮事件中直接调用；首次 await 前就发起 request，保留用户手势。 */
export async function requestHostPermissions(urls: string[]): Promise<void> {
  const origins = [...new Set(urls.map(hostPermissionPattern))]
  if (!origins.length) return
  const granted = await browser.permissions.request({ origins })
  await removeLegacyHostPermissions()
  if (!granted || !await browser.permissions.contains({ origins })) throw permissionError()
}

/** 每次 HTTP 请求前检查，即使服务器允许 CORS 也不能绕过用户授权。 */
export async function requireHostPermission(url: string, target: StorageConfig | string = url): Promise<void> {
  const origin = hostPermissionPattern(url)
  await removeLegacyHostPermissions()
  if (await browser.permissions.contains({ origins: [origin] })) return
  // 同主机的不同账号/库也隔离；键只保存目标摘要，值只保存缺权主机。
  await browser.storage.local.set({ [await pendingKey(target)]: origin })
  throw permissionError()
}

export async function missingHostPermissions(config: StorageConfig): Promise<string[]> {
  const target = hostPermissionPattern(storageEndpoint(config))
  await removeLegacyHostPermissions()
  const key = await pendingKey(config)
  const pending = (await browser.storage.local.get(key))[key]
  const candidates = new Set([target])
  if (typeof pending === 'string' && hostPermissionPattern(pending) === pending) candidates.add(pending)
  const missing: string[] = []
  for (const origin of candidates) {
    if (!await browser.permissions.contains({ origins: [origin] })) missing.push(origin)
  }
  return missing
}

/** 将平台事件封装在 infrastructure 中，UI 与后台各自对账。 */
export function watchHostPermissions(listener: () => void): () => void {
  browser.permissions.onAdded.addListener(listener)
  browser.permissions.onRemoved.addListener(listener)
  return () => {
    browser.permissions.onAdded.removeListener(listener)
    browser.permissions.onRemoved.removeListener(listener)
  }
}
