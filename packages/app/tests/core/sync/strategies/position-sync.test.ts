import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookmarkNode } from '@src/types';
import { computeTreeHash, compareWithCloud } from '@src/core/bookmark/comparator';
import { DEFAULT_SYNC_SCOPE } from '@src/core/bookmark/sync-scope';
import { getStorageIdentifier } from '@src/core/storage/types';

const mocks = vi.hoisted(() => ({
  getTree: vi.fn(), fetch: vi.fn(), getState: vi.fn(), setState: vi.fn(),
  latest: vi.fn(), push: vi.fn(), pull: vi.fn(),
}));
vi.mock('@src/core/bookmark', async importOriginal => ({
  ...await importOriginal<typeof import('@src/core/bookmark')>(),
  bookmarkRepository: { getTree: mocks.getTree },
}));
vi.mock('@src/core/sync/lock-manager', () => ({
  acquireSyncLock: vi.fn(async () => true), releaseSyncLock: vi.fn(),
}));
vi.mock('@src/core/sync/recovery', () => ({ assertNoRecovery: vi.fn() }));
vi.mock('@src/core/sync/state-manager', () => ({
  getLastSyncTime: vi.fn(async () => 100), getSyncState: mocks.getState, setSyncState: mocks.setState,
}));
vi.mock('@src/core/sync/sync-settings', () => ({
  getSyncScope: vi.fn(async () => DEFAULT_SYNC_SCOPE),
  getE2ESettings: vi.fn(async () => ({ enabled: false })),
}));
vi.mock('@src/infrastructure/storage/provider-factory', () => ({ createStorageProvider: vi.fn(() => ({})) }));
vi.mock('@src/core/storage', () => ({ fileManager: {
  getLatestBackupFile: mocks.latest, parseBackupFileName: vi.fn(() => null),
} }));
vi.mock('@src/core/sync/utils/cloud-data-helper', () => ({ fetchValidatedCloudBackup: mocks.fetch }));
vi.mock('@src/core/sync/strategies/push-strategy', () => ({ smartPush: mocks.push }));
vi.mock('@src/core/sync/strategies/pull-strategy', () => ({ smartPull: mocks.pull }));

import { smartSync } from '@src/core/sync/strategies/smart-sync-strategy';

const config = { url: 'https://dav.example.com', username: 'user', password: 'test' };
const a: BookmarkNode = { title: 'A', url: 'https://a.example.com' };
const b: BookmarkNode = { title: 'B', url: 'https://b.example.com' };
const tree = (children: BookmarkNode[], firefox = false): BookmarkNode[] => [{
  id: firefox ? 'root________' : '0', title: '', children: [{
    id: firefox ? 'toolbar_____' : '1', title: firefox ? 'Bookmarks Toolbar' : '书签栏', children,
  }],
}];
const baseline = tree([a, b]);
const reordered = tree([b, a]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('navigator', { onLine: true });
  mocks.push.mockResolvedValue({ success: true, action: 'uploaded' });
  mocks.pull.mockResolvedValue({ success: true, action: 'downloaded' });
});

async function run(local: BookmarkNode[], cloud: BookmarkNode[], newer: boolean, legacy = false) {
  mocks.getTree.mockResolvedValue(local);
  mocks.fetch.mockResolvedValue({ data: cloud });
  mocks.latest.mockResolvedValue({ path: 'backup.json.gz', lastModified: newer ? 200 : 100 });
  mocks.getState.mockResolvedValue({ url: getStorageIdentifier(config), time: 100,
    basis: { filePath: 'backup.json.gz', mtime: 100 },
    localHash: legacy ? 'legacy-multiset-hash' : await computeTreeHash(baseline),
  });
  return smartSync(config, 'manual');
}

describe('position-only changes with real comparison and hashing', () => {
  it('uploads a local reorder without additions or deletions', async () => {
    expect((await run(reordered, baseline, false)).action).toBe('uploaded');
    expect(mocks.pull).not.toHaveBeenCalled();
  });
  it('downloads a cloud reorder when local matches the baseline', async () => {
    expect((await run(baseline, reordered, true)).action).toBe('downloaded');
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it('asks for direction when both clients moved bookmarks', async () => {
    const moved = tree([{ title: 'Folder', children: [a, b] }]);
    expect((await run(reordered, moved, true)).needsConflictResolution).toBe(true);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.pull).not.toHaveBeenCalled();
  });
  it('asks for direction for a legacy baseline with different positions', async () => {
    expect((await run(baseline, reordered, true, true)).needsConflictResolution).toBe(true);
    expect(mocks.pull).not.toHaveBeenCalled();
  });
  it('upgrades a legacy baseline when structures already match', async () => {
    expect((await run(baseline, baseline, false, true)).action).toBe('skipped');
    expect(mocks.setState).toHaveBeenCalledWith(expect.objectContaining({ localHash: await computeTreeHash(baseline) }));
  });
  it('matches Chrome/Firefox system roots despite titles and IDs', async () => {
    const firefox = tree([a, b], true);
    expect(await compareWithCloud(baseline, firefox)).toBe(true);
    expect(await computeTreeHash(baseline)).toBe(await computeTreeHash(firefox));
    expect((await run(firefox, baseline, true)).action).toBe('skipped');
  });
  it('ignores local-only Firefox menu and unused empty system roots', async () => {
    const firefox = tree([a, b], true);
    firefox[0].children!.push({ id: 'menu________', title: 'Menu', children: [b] },
      { id: 'mobile______', title: 'Mobile', children: [] });
    expect(await compareWithCloud(baseline, firefox)).toBe(true);
  });
  it('distinguishes duplicate folder names and paths containing separators', async () => {
    const folder = (title: string, children: BookmarkNode[]) => ({ title, children });
    expect(await compareWithCloud(tree([folder('F', [a]), folder('F', [b])]),
      tree([folder('F', [b]), folder('F', [a])]))).toBe(false);
    expect(await compareWithCloud(tree([folder('F/G', [a])]),
      tree([folder('F', [folder('G', [a])])]))).toBe(false);
  });
  it('detects system-root moves and folder-only edits', async () => {
    const moved = tree([]);
    moved[0].children!.push({ id: '2', title: 'Other', children: [a, b] });
    expect(await compareWithCloud(baseline, moved)).toBe(false);
    expect(await compareWithCloud(tree([{ title: 'F', children: [] }]),
      tree([{ title: 'G', children: [] }]))).toBe(false);
  });
  it('does not re-upload unchanged restored content that was normalized during restore', async () => {
    const normalized = tree([{ title: 'F', children: [a, b] }]);
    const remote = tree([{ title: 'F', children: [a] }, { title: 'F', children: [b] }]);
    mocks.getTree.mockResolvedValue(normalized);
    mocks.fetch.mockResolvedValue({ data: remote });
    mocks.latest.mockResolvedValue({ path: 'backup.json.gz', lastModified: 100 });
    mocks.getState.mockResolvedValue({ url: getStorageIdentifier(config), time: 100, type: 'download',
      basis: { filePath: 'backup.json.gz', mtime: 100 }, localHash: await computeTreeHash(normalized) });
    expect((await smartSync(config, 'manual')).action).toBe('skipped');
    expect(mocks.push).not.toHaveBeenCalled();
    mocks.getTree.mockResolvedValue(tree([{ title: 'F', children: [b, a] }]));
    expect((await smartSync(config, 'manual')).action).toBe('uploaded');
  });
});
