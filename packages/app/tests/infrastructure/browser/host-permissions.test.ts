import { beforeEach, describe, expect, it, vi } from 'vitest'
import browser, { __resetMockStore } from '@src/__mocks__/webextension-polyfill'
import { hostPermissionPattern, missingHostPermissions, removeLegacyHostPermissions, requestHostPermissions, requireHostPermission } from '@src/infrastructure/browser/host-permissions'
import { WebDAVClient } from '@src/infrastructure/http/webdav-client'
import { GistClient } from '@src/infrastructure/storage/gist-client'
import { applyMigratedSettings } from '@src/application/settings-migrator'
import { getCloudBackupList } from '@src/core/sync/cloud-operations'
import { getStorageIdentifier } from '@src/core/storage/types'

const endpoint = 'https://dav.example.com/dav/'
const config = { url: endpoint, username: 'synthetic', password: 'synthetic' }
const fetchMock = vi.fn()
beforeEach(() => {
  vi.resetAllMocks()
  __resetMockStore()
  vi.stubGlobal('fetch', fetchMock)
})

describe('host permissions', () => {
  it.each([
    ['https://dav.example.com:8443/dav/a?key=value', 'https://dav.example.com/*'],
    ['http://127.0.0.1:8080/dav/', 'http://127.0.0.1/*'],
    ['http://localhost:8080/', 'http://localhost/*'],
    ['https://[::1]:8443/dav/', 'https://[::1]/*'],
  ])('normalizes %s without including path, port or credentials', (url, expected) => {
    expect(hostPermissionPattern(url)).toBe(expected)
  })
  it.each(['file:///x', 'javascript:alert(1)', 'https://user:pass@example.com/', 'https://*.example.com/', 'https://example.com/#secret'])('rejects %s', url => {
    expect(() => hostPermissionPattern(url)).toThrow()
  })
  it('requests synchronously in the click call stack and rejects denial', async () => {
    browser.permissions.request.mockResolvedValueOnce(false)
    const pending = requestHostPermissions([endpoint])
    expect(browser.permissions.request).toHaveBeenCalledWith({ origins: ['https://dav.example.com/*'] })
    expect(browser.permissions.getAll).not.toHaveBeenCalled()
    await expect(pending).rejects.toThrow('Site access required')
  })
  it('removes legacy broad grants and verifies the result', async () => {
    browser.permissions.getAll.mockResolvedValueOnce({ origins: ['<all_urls>', 'https://*/*', 'https://dav.example.com/*'] })
      .mockResolvedValueOnce({ origins: ['https://dav.example.com/*'] })
    await removeLegacyHostPermissions()
    expect(browser.permissions.remove).toHaveBeenCalledWith({ origins: ['<all_urls>', 'https://*/*'] })
  })
  it('fails closed if the broad permission cannot be removed', async () => {
    browser.permissions.getAll.mockResolvedValue({ origins: ['<all_urls>'] })
    await expect(new WebDAVClient(config).putFile('backup', 'data')).rejects.toThrow('Remove all-sites access')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('blocks all WebDAV verbs before network access and preserves sync state', async () => {
    browser.permissions.contains.mockResolvedValue(false)
    const preserved = { pending_bookmark_upload: { id: 'edit', target: endpoint }, acknowledged_bookmark_upload: 'old',
      syncState: { localHash: 'baseline' }, bookmark_recovery: { snapshotId: 7 } }
    await browser.storage.local.set(preserved)
    const client = new WebDAVClient(config)
    for (const operation of [() => client.testConnection(), () => client.getFile('backup'),
      () => client.putFile('backup', 'data'), () => client.deleteFile('backup'),
      () => client.createDirectory('dir'), () => client.exists('dir'), () => client.listFiles('dir')]) {
      await expect(operation()).rejects.toThrow('Site access required')
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await browser.storage.local.get(Object.keys(preserved))).toEqual(preserved)
    expect(browser.permissions.request).not.toHaveBeenCalled()
  })
  it('resumes after a grant and rechecks on revocation; redirects cannot bypass the gate', async () => {
    browser.permissions.contains.mockResolvedValue(false)
    const client = new WebDAVClient(config)
    await expect(client.getFile('backup')).rejects.toThrow('Site access required')
    browser.permissions.contains.mockResolvedValue(true)
    fetchMock.mockResolvedValue({ ok: true, text: async () => 'data' })
    expect(await client.getFile('backup')).toBe('data')
    expect(fetchMock.mock.calls[0][1].redirect).toBe('error')
    browser.permissions.contains.mockResolvedValue(false)
    await expect(client.getFile('backup')).rejects.toThrow('Site access required')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('records trusted raw access separately; refuses unknown raw hosts even when granted', async () => {
    const gist = new GistClient({ type: 'gist', token: 'synthetic', gistId: 'id' })
    browser.permissions.contains.mockImplementation(async ({ origins }: { origins?: string[] }) => !origins?.includes('https://gist.githubusercontent.com/*'))
    await expect(gist.fetchRaw('https://gist.githubusercontent.com/user/raw/file')).rejects.toThrow('Site access required')
    expect(await missingHostPermissions({ type: 'gist', token: 'synthetic', gistId: 'id' })).toEqual(['https://gist.githubusercontent.com/*'])
    expect(await missingHostPermissions({ type: 'gist', token: 'synthetic', gistId: 'other-id' })).toEqual([])
    browser.permissions.contains.mockResolvedValue(true)
    await expect(gist.fetchRaw('https://untrusted.example.com/file')).rejects.toThrow('Raw 文件地址不在允许的域内')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('supports a custom Gist API and trusted raw host without broad grants', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'id' }), text: async () => 'raw' })
    const gist = new GistClient({ type: 'gist', endpoint: 'https://gist.example.com/api/', token: 'synthetic', gistId: 'id' })
    await gist.getGist()
    await gist.fetchRaw('https://gist.example.com/raw/file')
    expect(fetchMock.mock.calls.every(([, options]) => options.redirect === 'error')).toBe(true)
    expect(browser.permissions.contains).toHaveBeenCalledWith({ origins: ['https://gist.example.com/*'] })
  })
  it('never turns missing permission into a successful Gist test/create/update', async () => {
    browser.permissions.contains.mockResolvedValue(false)
    const gist = new GistClient({ type: 'gist', token: 'synthetic', gistId: 'id' })
    expect(await gist.testConnection()).toMatchObject({ ok: false, message: expect.stringContaining('Site access required') })
    await expect(gist.createGist()).rejects.toThrow('Site access required')
    await expect(gist.updateGist({})).rejects.toThrow('Site access required')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('rejects an unauthorized partial import before replacing configuration or enabling sync', async () => {
    const original = { storage_type: 'gist', gist_endpoint: 'https://gist.example.com', gist_id: 'old', gist_token: 'old-token', auto_sync_enabled: false }
    await browser.storage.local.set(original)
    browser.permissions.contains.mockResolvedValue(false)
    await expect(applyMigratedSettings({ app: 'marksync', version: '1.0', exportedAt: 0,
      settings: { gist_id: 'new', gist_token: 'new-token', auto_sync_enabled: true } })).rejects.toThrow('Site access required')
    expect(await browser.storage.local.get(Object.keys(original))).toEqual(original)
  })
  it('does not disclose URL paths or query secrets in the pending permission record', async () => {
    browser.permissions.contains.mockResolvedValue(false)
    await expect(requireHostPermission(`${endpoint}?secret=synthetic`)).rejects.toThrow()
    const stored = await browser.storage.local.get(null)
    expect(Object.keys(stored)).toEqual([expect.stringMatching(/^host_permission_required:[a-f0-9]{64}$/)])
    expect(Object.values(stored)).toEqual(['https://dav.example.com/*'])
  })
  it('does not return a cached cloud list after access is revoked', async () => {
    await browser.storage.session.set({ cloud_backup_list_cache: { target: getStorageIdentifier(config), cachedAt: Date.now(), backups: [{ path: 'old' }] } })
    browser.permissions.contains.mockResolvedValue(false)
    await expect(getCloudBackupList(config)).rejects.toThrow('Site access required')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('does not fill a cloud list cache if access was revoked during the request', async () => {
    fetchMock.mockImplementationOnce(async () => {
      browser.permissions.contains.mockResolvedValue(false)
      return { ok: true, status: 207, text: async () => '<d:multistatus xmlns:d="DAV:"></d:multistatus>' }
    })
    await expect(getCloudBackupList(config, true)).rejects.toThrow('Site access required')
    expect((await browser.storage.session.get('cloud_backup_list_cache')).cloud_backup_list_cache).toBeUndefined()
  })
})
