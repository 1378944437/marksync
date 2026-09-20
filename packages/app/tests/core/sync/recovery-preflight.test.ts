import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import browser, { __resetMockStore } from '../../../src/__mocks__/webextension-polyfill';
import { snapshotManager } from '../../../src/core/backup';
import { bookmarkRepository } from '../../../src/core/bookmark/repository';
import { clearLocalBookmarks } from '../../../src/core/sync/danger-operations';
import { restoreLocalSnapshot } from '../../../src/core/sync/local-restore';
import { restoreFromCloudBackup } from '../../../src/core/sync/cloud-operations';
import { smartPull } from '../../../src/core/sync/strategies/pull-strategy';
import { compressText } from '../../../src/infrastructure/utils/compression';
import type { BookmarkNode } from '../../../src/types';

const remote = vi.hoisted(() => ({ getFile: vi.fn(), listFiles: vi.fn() }));
vi.mock('@src/infrastructure/storage/provider-factory', () => ({ createStorageProvider: () => remote }));
const config = { url: 'https://dav.example.com', username: 'synthetic', password: 'synthetic' };
const path = 'MarkSync/bookmarks_20260920_120000_chrome_1_v1.json.gz';
const tree = (): BookmarkNode[] => [{ id: '0', title: '', children: [
  { id: '1', title: 'Bar', folderType: 'bookmarks-bar', children: [{ id: 'b', title: 'Valid', url: 'https://example.com' }] },
  { id: '2', title: 'Other', folderType: 'other', children: [] },
] }];
beforeEach(async () => {
  __resetMockStore(); vi.clearAllMocks();
  remote.getFile.mockResolvedValue(await compressText(JSON.stringify({ data: tree() })));
  remote.listFiles.mockResolvedValue([{ path, name: path.split('/').pop(), lastModified: 1 }]);
});
afterEach(() => vi.restoreAllMocks());

it.each(['clear', 'pull', 'cloud-restore', 'local-restore'].flatMap(operation =>
  [0, 1].map(folder => ({ operation, folder }))))('blocks $operation before destructive writes with unsupported URL in root $folder', async ({ operation, folder }) => {
  const local = tree();
  local[0].children![folder].children!.push({ id: 'unsupported', title: 'Bookmarklet', url: 'javascript:void(0)' });
  vi.mocked(browser.bookmarks.getTree).mockResolvedValue(local as any);
  const restore = vi.spyOn(bookmarkRepository, 'restoreFromBackup').mockResolvedValue();
  // Use the real createSnapshot: validation must stop before opening IndexedDB.
  if (operation === 'clear') await expect(clearLocalBookmarks()).rejects.toThrow('协议不受支持');
  if (operation === 'pull') expect(await smartPull(config, 'manual')).toMatchObject({ success: false, message: expect.stringContaining('协议不受支持') });
  if (operation === 'cloud-restore') expect(await restoreFromCloudBackup(config, path, 'manual')).toMatchObject({ success: false, message: expect.stringContaining('协议不受支持') });
  if (operation === 'local-restore') {
    vi.spyOn(snapshotManager, 'getSnapshotById').mockResolvedValue({ id: 1, tree: tree(), count: 1, timestamp: 1, reason: 'test' });
    await expect(restoreLocalSnapshot(1)).rejects.toThrow('协议不受支持');
  }
  expect(restore).not.toHaveBeenCalled();
  expect(browser.bookmarks.remove).not.toHaveBeenCalled();
  expect(browser.bookmarks.removeTree).not.toHaveBeenCalled();
  expect((await browser.storage.local.get('bookmark_recovery')).bookmark_recovery).toBeUndefined();
});
