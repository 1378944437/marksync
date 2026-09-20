import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import browser, { __resetMockStore } from '../../../src/__mocks__/webextension-polyfill';
import { migrateEncryption, cancelEncryptionMigration } from '../../../src/core/sync/encryption-migration';
import { getE2ESettings } from '../../../src/core/sync/sync-settings';
import { decryptText, encryptText } from '../../../src/infrastructure/utils/crypto';
import { compressText, decompressText } from '../../../src/infrastructure/utils/compression';
import { smartPush } from '../../../src/core/sync/strategies/push-strategy';
import { smartPull } from '../../../src/core/sync/strategies/pull-strategy';
import { bookmarkRepository } from '../../../src/core/bookmark';
import { fileManager } from '../../../src/core/storage/file-manager';
import { getStorageIdentifier } from '../../../src/core/storage/types';
const mocks = vi.hoisted(() => ({ client: { type: 'webdav', getFile: vi.fn(), putFile: vi.fn(), listFiles: vi.fn(), exists: vi.fn(), deleteFile: vi.fn() }, snapshot: vi.fn() }));
vi.mock('@src/infrastructure/storage/provider-factory', () => ({ createStorageProvider: () => mocks.client }));
vi.mock('@src/core/backup', () => ({ snapshotManager: { createSnapshot: mocks.snapshot } }));
const config = { url: 'https://dav.example.com', username: 'test', password: 'test' };
const tree = [{ id: '0', title: '', children: [{ id: '1', title: 'Bar', folderType: 'bookmarks-bar', children: [{ title: 'Example', url: 'https://example.com' }] }] }];
let files: Map<string, string>;
beforeEach(() => {
  __resetMockStore(); vi.clearAllMocks(); files = new Map();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true, userAgent: 'Chrome/120' } });
  vi.mocked(browser.bookmarks.getTree).mockResolvedValue(tree);
  mocks.snapshot.mockResolvedValue(1);
  mocks.client.exists.mockImplementation(async path => path === 'MarkSync' || files.has(path));
  mocks.client.getFile.mockImplementation(async path => { if (!files.has(path)) throw new Error('not found'); return files.get(path); });
  mocks.client.putFile.mockImplementation(async (path, content) => { files.set(path, content); });
  mocks.client.deleteFile.mockImplementation(async path => { files.delete(path); });
  mocks.client.listFiles.mockImplementation(async () => [...files.keys()].map((path, i) => ({ path, name: path.split('/').pop(), lastModified: i + 1 })));
});
afterEach(() => vi.restoreAllMocks());
it.each([false, true])('joins encrypted cloud without publishing the local tree (empty=%s)', async empty => {
  if (empty) {
    const local = structuredClone(tree); local[0].children[0].children = [];
    vi.mocked(browser.bookmarks.getTree).mockResolvedValue(local);
  }
  const path = 'MarkSync/bookmarks_existing.json.gz.enc';
  const content = await encryptText(await compressText(JSON.stringify({ data: tree })), 'cloud-password');
  files.set(path, content);
  expect(await migrateEncryption(config, { enabled: true, passphrase: 'cloud-password' })).toMatchObject({ success: true, action: 'skipped' });
  expect(await getE2ESettings()).toEqual({ enabled: true, passphrase: 'cloud-password' });
  expect(mocks.client.putFile).not.toHaveBeenCalled();
  expect(mocks.client.deleteFile).not.toHaveBeenCalled();
  expect(mocks.snapshot).not.toHaveBeenCalled();
  expect((await browser.storage.local.get(['syncState', 'encryption_migration', 'pending_safety_confirmation']))).toEqual({});
  expect(files.get(path)).toBe(content);
  if (empty) {
    const restore = vi.spyOn(bookmarkRepository, 'restoreFromBackup').mockImplementation(async () => {
      vi.mocked(browser.bookmarks.getTree).mockResolvedValue(tree);
    });
    expect(await smartPull(config, 'manual')).toMatchObject({ success: true, action: 'downloaded' });
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({ data: expect.any(Array) }), expect.any(Object));
    expect(mocks.client.putFile).not.toHaveBeenCalled();
    expect(mocks.client.deleteFile).not.toHaveBeenCalled();
  }
});
it.each(['wrong-password', 'corrupt', 'changed-version'])('keeps settings unchanged when joining fails: %s', async kind => {
  const path = 'MarkSync/bookmarks_existing.json.gz.enc';
  files.set(path, await encryptText(await compressText(kind === 'corrupt' ? '{bad' : JSON.stringify({ data: tree })), 'cloud-password'));
  if (kind === 'changed-version') {
    const read = mocks.client.getFile.getMockImplementation()!;
    mocks.client.getFile.mockImplementationOnce(async name => {
      const content = await read(name);
      files.set('MarkSync/bookmarks_new.json.gz.enc', content);
      return content;
    });
  }
  await expect(migrateEncryption(config, { enabled: true, passphrase: kind === 'wrong-password' ? 'wrong-password' : 'cloud-password' })).rejects.toThrow();
  expect((await getE2ESettings()).enabled).toBe(false);
  expect(mocks.client.putFile).not.toHaveBeenCalled();
  expect(mocks.client.deleteFile).not.toHaveBeenCalled();
});
it.each([false, true])('keeps empty-sync confirmation usable before migration starts (legacy record=%s)', async legacy => {
  files.set('MarkSync/bookmarks_old.json.gz', await compressText(JSON.stringify({ data: tree })));
  const empty = structuredClone(tree); empty[0].children[0].children = [];
  vi.mocked(browser.bookmarks.getTree).mockResolvedValue(empty);
  const next = { enabled: true, passphrase: 'new-password' };
  if (legacy) await browser.storage.local.set({ encryption_migration: { target: getStorageIdentifier(config), next } });
  await expect(migrateEncryption(config, next)).rejects.toThrow('重新设置加密');
  const stored = await browser.storage.local.get(['encryption_migration', 'pending_safety_confirmation']);
  expect(stored.encryption_migration).toBeUndefined();
  expect(mocks.client.putFile).not.toHaveBeenCalled();
  expect((await smartPush(config, 'manual', { confirmEmpty: true,
    confirmationId: stored.pending_safety_confirmation.id })).success).toBe(true);
  expect((await migrateEncryption(config, next)).success).toBe(true);
  expect(await getE2ESettings()).toEqual(next);
});
it('resumes an atomic settings/baseline commit after local storage fails, without republishing', async () => {
  const originalSet = vi.mocked(browser.storage.local.set).getMockImplementation()!;
  let fail = true;
  vi.mocked(browser.storage.local.set).mockImplementation(async data => {
    if ('syncState' in data && 'e2e_enabled' in data && fail) { fail = false; throw new Error('local quota'); }
    return originalSet(data);
  });
  await expect(migrateEncryption(config, { enabled: true, passphrase: 'new-password' })).rejects.toThrow('local quota');
  expect((await getE2ESettings()).enabled).toBe(false);
  expect((await browser.storage.local.get('syncState')).syncState).toBeUndefined();
  expect((await migrateEncryption(config, { enabled: true, passphrase: 'new-password' })).success).toBe(true);
  expect(mocks.client.putFile).toHaveBeenCalledTimes(1);
  const saved = await browser.storage.local.get(['syncState', 'e2e_enabled']);
  expect(saved.e2e_enabled).toBe(true);
  expect(saved.syncState).toMatchObject({ basis: { filePath: [...files.keys()][0] } });
});
it.each([true, false])('migrates encrypted history using the old password and writes enabled=%s', async enabled => {
  const oldPath = 'MarkSync/bookmarks_old.json.gz.enc';
  files.set(oldPath, await encryptText(await compressText(JSON.stringify({ data: tree })), 'old-password'));
  await browser.storage.local.set({ e2e_enabled: true, e2e_passphrase: 'old-password' });
  const next = { enabled, passphrase: enabled ? 'new-password' : '' };
  expect((await migrateEncryption(config, next)).success).toBe(true);
  expect(await getE2ESettings()).toEqual(next);
  expect(files.has(oldPath)).toBe(true);
  expect(mocks.client.deleteFile).not.toHaveBeenCalled();
  const [path, data] = mocks.client.putFile.mock.calls[0];
  expect(path.endsWith('.enc')).toBe(enabled);
  const plain = enabled ? await decryptText(data, next.passphrase) : data;
  expect(JSON.parse(await decompressText(plain)).data[0].children[0].children[0].url).toBe('https://example.com');
  expect(browser.bookmarks.getTree).toHaveBeenCalledTimes(1);
});
it('retains old settings on unknown write result, then resumes by reading the same candidate', async () => {
  mocks.client.putFile.mockImplementationOnce(async (path, content) => { files.set(path, content); throw new Error('connection lost after write'); });
  await expect(migrateEncryption(config, { enabled: true, passphrase: 'new-password' })).rejects.toThrow('connection lost');
  expect((await getE2ESettings()).enabled).toBe(false);
  expect((await browser.storage.local.get('encryption_migration')).encryption_migration).toBeDefined();
  expect((await migrateEncryption(config, { enabled: false, passphrase: '' })).success).toBe(true);
  expect(mocks.client.putFile).toHaveBeenCalledTimes(1);
  expect(await getE2ESettings()).toEqual({ enabled: true, passphrase: 'new-password' });
});
it('云端在迁移窗口内演进时，继续迁移中止且保留 pending', async () => {
  // 第一次：候选文件已上传但结果未知（pending 已落盘）
  mocks.client.putFile.mockImplementationOnce(async (path, content) => { files.set(path, content); throw new Error('connection lost after write'); });
  await expect(migrateEncryption(config, { enabled: true, passphrase: 'new-password' })).rejects.toThrow('connection lost');
  // 迁移窗口内另一台设备推送了更新的备份（插入顺序在后 → lastModified 更大）
  files.set('MarkSync/bookmarks_20260919_120000_chrome_10_v1.json.gz', await compressText(JSON.stringify({ data: tree })));
  // 重入：候选文件本身校验通过，但已不是云端最新 → 红线中止
  await expect(migrateEncryption(config, { enabled: true, passphrase: 'new-password' })).rejects.toThrow('迁移期间云端版本发生变化');
  // pending 仍在：assertNoRecovery 持续阻断一切同步（死锁现场）
  expect((await browser.storage.local.get('encryption_migration')).encryption_migration).toBeDefined();
});
it('cancel removes the migration record and the candidate file, restoring sync', async () => {
  // 第一次：候选文件已上传但结果未知（pending 已落盘）
  mocks.client.putFile.mockImplementationOnce(async (path, content) => { files.set(path, content); throw new Error('connection lost after write'); });
  await expect(migrateEncryption(config, { enabled: true, passphrase: 'new-password' })).rejects.toThrow('connection lost');
  const pending = (await browser.storage.local.get('encryption_migration')).encryption_migration;
  expect(pending?.path).toBeDefined();
  mocks.client.deleteFile.mockImplementation(async (path: string) => { files.delete(path); });
  expect((await cancelEncryptionMigration(config)).success).toBe(true);
  expect(mocks.client.deleteFile).toHaveBeenCalledWith(pending.path);
  expect((await browser.storage.local.get('encryption_migration')).encryption_migration).toBeUndefined();
  // 取消后同步闸门解除：可以重新发起一次全新迁移
  expect((await migrateEncryption(config, { enabled: true, passphrase: 'new-password' })).success).toBe(true);
});
it('cancel without a pending migration is idempotent', async () => {
  const result = await cancelEncryptionMigration(config);
  expect(result.success).toBe(true);
  expect(mocks.client.deleteFile).not.toHaveBeenCalled();
});
it('cancel keeps the migration record when the candidate file cannot be deleted', async () => {
  mocks.client.putFile.mockImplementationOnce(async (path, content) => { files.set(path, content); throw new Error('connection lost after write'); });
  await expect(migrateEncryption(config, { enabled: true, passphrase: 'new-password' })).rejects.toThrow('connection lost');
  mocks.client.deleteFile.mockRejectedValueOnce(new Error('403 Forbidden'));
  await expect(cancelEncryptionMigration(config)).rejects.toThrow('无法删除迁移候选文件');
  expect((await browser.storage.local.get('encryption_migration')).encryption_migration).toBeDefined();
});
it('does not publish when the safety snapshot cannot be saved', async () => {
  mocks.snapshot.mockRejectedValueOnce(new Error('quota exceeded'));
  await expect(migrateEncryption(config, { enabled: true, passphrase: 'new-password' })).rejects.toThrow('quota exceeded');
  expect(mocks.client.putFile).not.toHaveBeenCalled();
  expect((await getE2ESettings()).enabled).toBe(false);
});

it.each(['resume', 'cancel', 'legacy-cancel'])('keeps the committed backup after record cleanup fails: %s', async action => {
  const remove = vi.mocked(browser.storage.local.remove).getMockImplementation()!;
  let fail = true;
  vi.spyOn(browser.storage.local, 'remove').mockImplementation(async keys => {
    if (keys === 'encryption_migration' && fail) { fail = false; throw new Error('local cleanup failed'); }
    return remove(keys);
  });
  await expect(migrateEncryption(config, { enabled: true, passphrase: 'new-password' })).rejects.toThrow('cleanup failed');
  const pending = (await browser.storage.local.get('encryption_migration')).encryption_migration;
  expect(pending.committed).toBe(true);
  if (action === 'legacy-cancel') {
    delete pending.committed;
    await browser.storage.local.set({ encryption_migration: pending });
  }
  const result = action === 'resume' ? await migrateEncryption(config, { enabled: false, passphrase: '' }) : await cancelEncryptionMigration(config);
  expect(result.success).toBe(true);
  expect(files.has(pending.path)).toBe(true);
  expect(mocks.client.deleteFile).not.toHaveBeenCalled();
  expect(mocks.client.putFile).toHaveBeenCalledTimes(1);
  expect(await getE2ESettings()).toEqual({ enabled: true, passphrase: 'new-password' });
  expect((await browser.storage.local.get('encryption_migration')).encryption_migration).toBeUndefined();
});

it('retries cancellation after the file was deleted but clearing the local record failed', async () => {
  mocks.client.putFile.mockImplementationOnce(async (path, content) => { files.set(path, content); throw new Error('unknown upload'); });
  await expect(migrateEncryption(config, { enabled: true, passphrase: 'new-password' })).rejects.toThrow('unknown upload');
  vi.mocked(browser.storage.local.remove).mockRejectedValueOnce(new Error('local cleanup failed'));
  await expect(cancelEncryptionMigration(config)).rejects.toThrow('cleanup failed');
  expect(files.size).toBe(0);
  expect((await cancelEncryptionMigration(config)).success).toBe(true);
  expect(mocks.client.deleteFile).toHaveBeenCalledTimes(1);
});

it.each(['changed-content', 'wrong-target', 'delete-noop'])('retains pending migration when cancellation is unsafe: %s', async kind => {
  mocks.client.putFile.mockImplementationOnce(async (path, content) => { files.set(path, content); throw new Error('unknown upload'); });
  await expect(migrateEncryption(config, { enabled: true, passphrase: 'new-password' })).rejects.toThrow('unknown upload');
  const pending = (await browser.storage.local.get('encryption_migration')).encryption_migration;
  if (kind === 'changed-content') files.set(pending.path, 'changed');
  if (kind === 'delete-noop') mocks.client.deleteFile.mockResolvedValueOnce(undefined);
  await expect(cancelEncryptionMigration(kind === 'wrong-target' ? { ...config, username: 'other' } : config)).rejects.toThrow();
  expect((await browser.storage.local.get('encryption_migration')).encryption_migration).toBeDefined();
  expect(files.has(pending.path)).toBe(true);
  if (kind !== 'delete-noop') expect(mocks.client.deleteFile).not.toHaveBeenCalled();
});

it('reports cleanup failure without marking a verified upload as failed', async () => {
  vi.spyOn(fileManager, 'cleanOldBackups').mockRejectedValueOnce(new Error('403 Forbidden'));
  const result = await smartPush(config, 'manual');
  expect(result).toMatchObject({ success: true, action: 'uploaded' });
  expect(result.message).toContain('旧备份清理失败');
  expect((await browser.storage.local.get('syncState')).syncState.basis.filePath).toBe([...files.keys()][0]);
});

it.each([false, true])('uses indexed rollback only when the previous version is known: legacy=%s', async legacy => {
  mocks.client.putFile.mockImplementationOnce(async (path, content) => { files.set(path, content); throw new Error('unknown upload'); });
  await expect(migrateEncryption(config, { enabled: true, passphrase: 'new-password' })).rejects.toThrow('unknown upload');
  const pending = (await browser.storage.local.get('encryption_migration')).encryption_migration;
  const content = files.get(pending.path);
  if (legacy) {
    delete pending.previousPath;
    await browser.storage.local.set({ encryption_migration: pending });
  }
  const rollbackBackup = vi.fn(async (path: string) => { files.delete(path); });
  Object.assign(mocks.client, { rollbackBackup });
  try {
    if (legacy) {
      await expect(cancelEncryptionMigration(config)).rejects.toThrow('缺少上一版本');
      expect(rollbackBackup).not.toHaveBeenCalled();
      expect((await browser.storage.local.get('encryption_migration')).encryption_migration).toBeDefined();
    } else {
      expect((await cancelEncryptionMigration(config)).success).toBe(true);
      expect(rollbackBackup).toHaveBeenCalledExactlyOnceWith(pending.path, null, content);
    }
    expect(mocks.client.deleteFile).not.toHaveBeenCalled();
  } finally { Reflect.deleteProperty(mocks.client, 'rollbackBackup'); }
});
