import { INDEX_FILE } from '@src/infrastructure/storage/gist-index';
import { fileManager } from '@src/core/storage/file-manager';
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { GistStorageProvider } from '@src/infrastructure/storage/gist-provider'
import { GistClient } from '@src/infrastructure/storage/gist-client'
import { createStorageProvider } from '@src/infrastructure/storage/provider-factory'
import { getStorageIdentifier } from '@src/core/storage/types'

describe('GistClient & GistStorageProvider 测试', () => {
  const mockConfig = {
    token: 'ghp_mock_token_123456',
    gistId: 'gist_mock_id_789',
    endpoint: 'https://api.github.com',
  }

  function memoryGist(provider: GistStorageProvider) {
    const gist: any = { updated_at: '2026-09-14T12:00:00Z', files: {} };
    vi.spyOn(provider.getClient(), 'getGist').mockImplementation(async () => structuredClone(gist));
    const patch = vi.spyOn(provider.getClient(), 'updateGist').mockImplementation(async files => {
      for (const [name, file] of Object.entries(files)) {
        if (file === null) delete gist.files[name];
        else gist.files[name] = { filename: name, size: file.content.length, ...file };
      }
      return structuredClone(gist);
    });
    return { gist, patch };
  }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('GistStorageProvider 正确声明驱动类型为 gist', () => {
    const provider = new GistStorageProvider(mockConfig)
    expect(provider.type).toBe('gist')
  })

  it('testConnection 在 Gist 存在且权限正常时返回 { ok: true }', async () => {
    const provider = new GistStorageProvider(mockConfig)
    const client = provider.getClient()

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'gist_mock_id_789' }),
    } as any)

    const res = await provider.testConnection()
    expect(res.ok).toBe(true)
  })

  it('testConnection 在 Token 无效或 401 时返回友好的错误提示', async () => {
    const provider = new GistStorageProvider(mockConfig)

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
    } as any)

    const res = await provider.testConnection()
    expect(res.ok).toBe(false)
    expect(res.message).toContain('401')
  })

  it('createGist 发起 POST 请求自动创建私密 Gist 并返回 ID', async () => {
    const client = new GistClient(mockConfig)

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'new_created_gist_id',
        updated_at: '2026-09-14T10:00:00Z',
      }),
    } as any)

    const result = await client.createGist('测试备份', false)
    expect(result.id).toBe('new_created_gist_id')
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.github.com/gists',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('一次 PATCH 写入备份和版本索引并读回确认', async () => {
    const provider = new GistStorageProvider(mockConfig);
    const { gist, patch } = memoryGist(provider);
    await provider.putFile('MarkSync/bookmarks_test.json.gz', 'content');
    expect(patch).toHaveBeenCalledTimes(1);
    expect(Object.keys(patch.mock.calls[0][0])).toEqual(['bookmarks_test.json.gz', INDEX_FILE]);
    expect(JSON.parse(gist.files[INDEX_FILE].content).current).toBe('bookmarks_test.json.gz');
  })

  it('getFile 正确提取 Gist 中的文件内容', async () => {
    const provider = new GistStorageProvider(mockConfig)

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'gist_mock_id_789',
        files: {
          'bookmarks.json': {
            filename: 'bookmarks.json',
            content: '{"hello":"world"}',
            size: 17,
          },
        },
      }),
    } as any)

    const content = await provider.getFile('bookmarks.json')
    expect(content).toBe('{"hello":"world"}')
  })

  it('版本顺序独立于共享时间，清理永不删除当前版本', async () => {
    const provider = new GistStorageProvider(mockConfig);
    const { gist } = memoryGist(provider);
    for (let i = 0; i < 6; i++) await provider.putFile('MarkSync/bookmarks_' + i + '.json.gz', 'data');
    expect((await fileManager.getLatestBackupFile(provider))?.path).toBe('MarkSync/bookmarks_5.json.gz');
    await fileManager.cleanOldBackups(provider, { minToKeep: 5, maxToKeep: 5 });
    expect(gist.files['bookmarks_0.json.gz']).toBeUndefined();
    expect(gist.files['bookmarks_5.json.gz']).toBeDefined();
    await expect(provider.deleteFile('MarkSync/bookmarks_5.json.gz')).rejects.toThrow('当前版本');
  })

  it('旧库多版本先选择再接管，未知历史不自动清理', async () => {
    const provider = new GistStorageProvider(mockConfig);
    const { gist, patch } = memoryGist(provider);
    for (let i = 0; i < 6; i++) gist.files['bookmarks_' + i + '.json.gz'] = { content: 'old' };
    await expect(fileManager.getLatestBackupFile(provider)).rejects.toThrow('顺序未确定');
    await fileManager.cleanOldBackups(provider, { minToKeep: 5, maxToKeep: 5 });
    expect(patch).not.toHaveBeenCalled();
    await provider.adoptBackup('MarkSync/bookmarks_3.json.gz');
    expect((await fileManager.getLatestBackupFile(provider))?.path).toBe('MarkSync/bookmarks_3.json.gz');
    await provider.putFile('MarkSync/bookmarks_new.json.gz', 'new');
    await fileManager.cleanOldBackups(provider, { minToKeep: 5, maxToKeep: 5 });
    expect(Object.keys(gist.files).filter(name => name.startsWith('bookmarks_'))).toHaveLength(7);
  })

  it('createStorageProvider 正确识别 Gist 配置', () => {
    const provider = createStorageProvider({
      token: 'ghp_token',
      gistId: 'gist_id',
    })
    expect(provider.type).toBe('gist')
  })

  it.each(['corrupt', 'truncated', 'unindexed'])('fails closed for an unsafe Gist index: %s', async kind => {
    const provider = new GistStorageProvider(mockConfig);
    const { gist, patch } = memoryGist(provider);
    await provider.putFile('MarkSync/bookmarks_one.json.gz', 'one');
    patch.mockClear();
    if (kind === 'corrupt') gist.files[INDEX_FILE].content = '{';
    if (kind === 'truncated') gist.files[INDEX_FILE].truncated = true;
    if (kind === 'unindexed') gist.files['bookmarks_unknown.json.gz'] = { content: 'unknown' };
    await expect(provider.putFile('MarkSync/bookmarks_two.json.gz', 'two')).rejects.toThrow();
    expect(patch).not.toHaveBeenCalled();
    expect(gist.files['bookmarks_one.json.gz']).toBeDefined();
  });

  it('detects a remote revision change before publishing or deleting', async () => {
    const provider = new GistStorageProvider(mockConfig);
    const { gist, patch } = memoryGist(provider);
    await provider.putFile('MarkSync/bookmarks_one.json.gz', 'one');
    await provider.putFile('MarkSync/bookmarks_two.json.gz', 'two');
    await provider.listFiles('MarkSync');
    const index = JSON.parse(gist.files[INDEX_FILE].content);
    index.revision = 'another-device';
    gist.files[INDEX_FILE].content = JSON.stringify(index);
    patch.mockClear();
    await expect(provider.putFile('MarkSync/bookmarks_three.json.gz', 'three')).rejects.toThrow('版本已变化');
    await expect(provider.deleteFile('MarkSync/bookmarks_one.json.gz')).rejects.toThrow('版本已变化');
    expect(patch).not.toHaveBeenCalled();
  });

  it('createStorageProvider 正确识别 WebDAV 配置', () => {
    const provider = createStorageProvider({
      url: 'https://dav.example.com',
      username: 'user',
      password: 'pwd',
    })
    expect(provider.type).toBe('webdav')
  })

  it('getStorageIdentifier 对 Gist 与 WebDAV 正确生成状态存储目标标识', () => {
    expect(getStorageIdentifier({ token: 't', gistId: 'gist_abc' })).toBe('gist:https://api.github.com/gist_abc')
    expect(getStorageIdentifier({ url: 'https://dav.example.com', username: 'u', password: 'p' })).toBe('webdav:https://dav.example.com|u')
  })

  it.each([false, true])('rolls back a migration without deleting the previous or newer version: newer=%s', async newer => {
    const provider = new GistStorageProvider(mockConfig);
    const { gist, patch } = memoryGist(provider);
    const previous = 'MarkSync/bookmarks_old.json.gz';
    const candidate = 'MarkSync/bookmarks_candidate.json.gz.enc';
    await provider.putFile(previous, 'old');
    await provider.putFile(candidate, 'candidate');
    if (newer) await provider.putFile('MarkSync/bookmarks_new.json.gz', 'new');
    patch.mockClear();
    await provider.rollbackBackup(candidate, previous, 'candidate');
    expect(patch).toHaveBeenCalledTimes(1);
    expect(gist.files['bookmarks_candidate.json.gz.enc']).toBeUndefined();
    expect(gist.files['bookmarks_old.json.gz']).toBeDefined();
    expect(JSON.parse(gist.files[INDEX_FILE].content).current).toBe(newer ? 'bookmarks_new.json.gz' : 'bookmarks_old.json.gz');
    await provider.rollbackBackup(candidate, previous, 'candidate');
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it('can cancel the first indexed backup while preserving unrelated files', async () => {
    const provider = new GistStorageProvider(mockConfig);
    const { gist } = memoryGist(provider);
    gist.files['README.md'] = { content: 'readme' };
    await provider.putFile('MarkSync/bookmarks_first.json.gz.enc', 'first');
    await provider.rollbackBackup('MarkSync/bookmarks_first.json.gz.enc', null, 'first');
    expect(JSON.parse(gist.files[INDEX_FILE].content).current).toBeNull();
    expect(gist.files['README.md']).toBeDefined();
  });

  it.each(['changed', 'missing-previous', 'unknown-previous'])('refuses unsafe rollback: %s', async kind => {
    const provider = new GistStorageProvider(mockConfig);
    const { gist, patch } = memoryGist(provider);
    await provider.putFile('MarkSync/bookmarks_old.json.gz', 'old');
    await provider.putFile('MarkSync/bookmarks_candidate.json.gz.enc', 'candidate');
    patch.mockClear();
    await expect(provider.rollbackBackup('MarkSync/bookmarks_candidate.json.gz.enc',
      kind === 'unknown-previous' ? null : `MarkSync/bookmarks_${kind === 'missing-previous' ? 'absent' : 'old'}.json.gz`,
      kind === 'changed' ? 'different' : 'candidate')).rejects.toThrow();
    expect(patch).not.toHaveBeenCalled();
    expect(gist.files['bookmarks_candidate.json.gz.enc']).toBeDefined();
  });

  it('keeps rollback failure visible when the remote read-back disagrees', async () => {
    const provider = new GistStorageProvider(mockConfig);
    const { patch } = memoryGist(provider);
    await provider.putFile('MarkSync/bookmarks_first.json.gz.enc', 'first');
    patch.mockResolvedValueOnce({} as any);
    await expect(provider.rollbackBackup('MarkSync/bookmarks_first.json.gz.enc', null, 'first')).rejects.toThrow('未确认');
  });
})
