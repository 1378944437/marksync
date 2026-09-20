import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import browser, { __resetMockStore } from '../../../src/__mocks__/webextension-polyfill';
import { smartPush } from '../../../src/core/sync/strategies/push-strategy';
import { smartPull } from '../../../src/core/sync/strategies/pull-strategy';
import { smartSync } from '../../../src/core/sync/strategies/smart-sync-strategy';
import { restoreFromCloudBackup } from '../../../src/core/sync/cloud-operations';
import { bookmarkRepository } from '../../../src/core/bookmark/repository';
import { encodeEmptyBackup } from '../../../src/core/sync/utils/empty-tree';
import { fetchValidatedCloudBackup } from '../../../src/core/sync/utils/cloud-data-helper';
import { validateRestoreTree } from '../../../src/core/bookmark/validation';
import { createStorageProvider } from '../../../src/infrastructure/storage/provider-factory';
import { GistStorageProvider } from '../../../src/infrastructure/storage/gist-provider';
import { INDEX_FILE } from '../../../src/infrastructure/storage/gist-index';
import { compressText, decompressText } from '../../../src/infrastructure/utils/compression';
import type { BookmarkNode, CloudBackup } from '../../../src/types';

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), client: {
  type: 'webdav', getFile: vi.fn(), putFile: vi.fn(), listFiles: vi.fn(), deleteFile: vi.fn(),
} }));
vi.mock('@src/infrastructure/storage/provider-factory', () => ({ createStorageProvider: vi.fn(() => mocks.client) }));
vi.mock('@src/core/backup', () => ({ snapshotManager: { createSnapshot: mocks.snapshot } }));
const config = { url: 'https://dav.example.com', username: 'test', password: 'test' };
const scope = { 'bookmarks-bar': true, other: false, mobile: false };
const path = 'MarkSync/bookmarks_20260920_120000_chrome_1_v1.json.gz';
const tree = (count: number): BookmarkNode[] => [{ id: '0', title: '', children: [
  { id: '1', title: 'Bar', folderType: 'bookmarks-bar', children: Array.from({ length: count }, (_, i) =>
    ({ title: `Bookmark ${i}`, url: `https://example.com/${i}` })) },
] }];
const backup = (count: number): CloudBackup => ({ metadata: { timestamp: 1, clientVersion: 'test' }, data: tree(count) });
let files: Map<string, { content: string; time: number }>;
let local: BookmarkNode[];
let clock = 100;
const pending = async () => (await browser.storage.local.get('pending_safety_confirmation')).pending_safety_confirmation;
const setCloud = async (json: string, file = path) => files.set(file, { content: await compressText(json), time: ++clock });
const emptyCloud = async () => setCloud(encodeEmptyBackup(backup(0), scope));
const confirmPush = async (id?: string) => smartPush(config, 'manual', { confirmEmpty: true, confirmationId: id || (await pending()).id });

beforeEach(() => {
  __resetMockStore(); vi.clearAllMocks(); files = new Map(); local = tree(0);
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true, userAgent: 'Chrome/120' } });
  vi.mocked(browser.bookmarks.getTree).mockImplementation(async () => structuredClone(local) as any);
  mocks.snapshot.mockResolvedValue(7);
  mocks.client.getFile.mockImplementation(async key => { if (!files.has(key)) throw new Error('not found'); return files.get(key)!.content; });
  mocks.client.putFile.mockImplementation(async (key, content) => { files.set(key, { content, time: ++clock }); });
  mocks.client.deleteFile.mockImplementation(async key => { files.delete(key); });
  mocks.client.listFiles.mockImplementation(async () => [...files].map(([key, value]) => ({
    path: key, name: key.split('/').pop(), lastModified: value.time,
  })));
});
afterEach(() => vi.restoreAllMocks());

it('rejects an unreadable upload without deleting the previous valid backup or advancing baseline', async () => {
  local = tree(1);
  expect((await smartPush(config, 'manual')).success).toBe(true);
  const original = [...files.keys()][0];
  const baseline = (await browser.storage.local.get('syncState')).syncState;
  local[0].children![0].children!.push({ title: 'Bookmarklet', url: 'javascript:void(0)' });
  expect((await smartPush(config, 'manual')).success).toBe(false);
  expect(mocks.client.putFile).toHaveBeenCalledOnce();
  expect(mocks.client.deleteFile).not.toHaveBeenCalled();
  expect(files.has(original)).toBe(true);
  expect((await browser.storage.local.get('syncState')).syncState).toEqual(baseline);
});

it.each(['sender', 'receiver'])('uploads new edits after %s acknowledged an empty version, but still confirms explicit overwrite', async side => {
  if (side === 'sender') {
    await smartPush(config, 'manual');
    expect((await confirmPush()).success).toBe(true);
  } else {
    await emptyCloud(); local = tree(1);
    await smartPull(config, 'manual');
    vi.spyOn(bookmarkRepository, 'restoreFromBackup').mockImplementationOnce(async () => { local = tree(0); });
    expect((await smartPull(config, 'manual', 'overwrite', { confirmationId: (await pending()).id })).success).toBe(true);
  }
  local = tree(1);
  expect((await smartPull(config, 'manual')).success).toBe(false);
  expect((await pending()).emptyAction).toBe('pull');
  const result = await smartSync(config, 'manual');
  expect(result).toMatchObject({ success: true, action: 'uploaded' });
  const latest = [...files.values()].at(-1)!;
  expect(JSON.parse(await decompressText(latest.content)).data[0].children[0].children).toHaveLength(1);
});

it.each([1, 40])('requires confirmation for %i cloud bookmarks even with the ordinary breaker disabled', async count => {
  await setCloud(JSON.stringify(backup(count)));
  await browser.storage.local.set({ sync_safety_settings: { enabled: false } });
  expect((await smartPush(config, 'auto-sync', { skipSafetyGuard: true })).success).toBe(false);
  const id = (await pending()).id;
  expect((await pending()).deletedCount).toBe(count);
  expect((await smartPush(config, 'auto-sync', { confirmationId: id })).success).toBe(false);
  expect(mocks.client.putFile).not.toHaveBeenCalled();
  expect((await confirmPush(id)).success).toBe(true);
  expect(files.has(path)).toBe(true);
  expect(mocks.client.deleteFile).not.toHaveBeenCalled();
  const wire = JSON.parse(await decompressText([...files.values()].at(-1)!.content));
  expect(wire.data.format).toBe('marksync-empty-v1');
  expect(() => validateRestoreTree(wire.data)).toThrow(); // The previous array-only reader stops.
  expect(mocks.snapshot.mock.invocationCallOrder[0]).toBeLessThan(mocks.client.putFile.mock.invocationCallOrder[0]);
});

it('also requires confirmation when cloud storage is new', async () => {
  expect((await smartPush(config, 'manual')).success).toBe(false);
  expect((await pending()).deletedCount).toBe(0);
  expect((await confirmPush()).success).toBe(true);
});

it.each(['target', 'scope', 'local', 'folders', 'cloud', 'content', 'expired'])('rejects stale sender confirmation after %s changes', async change => {
  await setCloud(JSON.stringify(backup(1)));
  await smartPush(config, 'manual');
  const id = (await pending()).id;
  if (change === 'scope') await browser.storage.local.set({ sync_scope: { ...scope, other: true } });
  if (change === 'local') local = tree(1);
  if (change === 'folders') local[0].children![0].children!.push({ title: 'New empty folder', children: [] });
  if (change === 'cloud') files.get(path)!.time++;
  if (change === 'content') { const oldTime = files.get(path)!.time; await setCloud(JSON.stringify(backup(2))); files.get(path)!.time = oldTime; }
  if (change === 'expired') await browser.storage.local.set({ pending_safety_confirmation: { ...await pending(), timestamp: 1 } });
  const result = await smartPush(change === 'target' ? { ...config, username: 'another' } : config,
    'manual', { confirmEmpty: true, confirmationId: id });
  expect(result.success).toBe(false);
  expect(mocks.client.putFile).not.toHaveBeenCalled();
});

it('rechecks local changes occurring while the upload snapshot is saved', async () => {
  await setCloud(JSON.stringify(backup(1))); await smartPush(config, 'manual');
  mocks.snapshot.mockImplementationOnce(async () => { local = tree(1); return 7; });
  expect((await confirmPush()).success).toBe(false);
  expect(mocks.client.putFile).not.toHaveBeenCalled();
});

it('ignores the Firefox-only menu when publishing empty shared roots', async () => {
  local[0].children!.push({ id: 'menu________', title: 'Menu', children: [{ title: 'Private', url: 'https://example.com/private' }] });
  await smartPush(config, 'manual');
  expect((await confirmPush()).success).toBe(true);
  const wire = JSON.parse(await decompressText([...files.values()][0].content));
  expect(wire.data.tree[0].children).toHaveLength(1);
  expect(mocks.snapshot.mock.calls[0][1]).toBe(1); // Full local snapshot still includes the menu.
});

it('requires receiver confirmation for auto merge, smart sync, pull, and history restore', async () => {
  await emptyCloud(); local = tree(40);
  const restore = vi.spyOn(bookmarkRepository, 'restoreFromBackup').mockResolvedValue();
  const merge = vi.spyOn(bookmarkRepository, 'mergeFromBackup').mockResolvedValue();
  expect((await smartPull(config, 'auto-sync', 'merge')).success).toBe(false);
  expect((await smartSync(config, 'manual')).success).toBe(false);
  expect((await smartPull(config, 'manual')).success).toBe(false);
  const id = (await pending()).id;
  expect((await smartPull(config, 'auto-sync', 'overwrite', { confirmationId: id })).success).toBe(false);
  expect(mocks.snapshot).not.toHaveBeenCalled(); expect(merge).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled();
  expect((await smartPull(config, 'manual', 'overwrite', { confirmationId: id })).success).toBe(true);
  expect(restore).toHaveBeenCalledOnce();
  expect(mocks.snapshot.mock.invocationCallOrder[0]).toBeLessThan(restore.mock.invocationCallOrder[0]);
  expect((await restoreFromCloudBackup(config, path, 'manual')).success).toBe(false);
  expect((await pending()).emptyAction).toBe('restore');
  expect((await restoreFromCloudBackup(config, path, 'manual', undefined, (await pending()).id)).success).toBe(true);
});

it.each(['local', 'scope', 'cloud', 'normal-backup'])('rejects stale receiver confirmation after %s changes', async change => {
  await emptyCloud(); local = tree(1);
  const restore = vi.spyOn(bookmarkRepository, 'restoreFromBackup').mockResolvedValue();
  await smartPull(config, 'manual'); const id = (await pending()).id;
  if (change === 'local') local = tree(2);
  if (change === 'scope') await browser.storage.local.set({ sync_scope: { ...scope, other: true } });
  if (change === 'cloud') files.get(path)!.time++;
  if (change === 'normal-backup') await setCloud(JSON.stringify(backup(2)));
  expect((await smartPull(config, 'manual', 'overwrite', { confirmationId: id })).success).toBe(false);
  expect(restore).not.toHaveBeenCalled();
});

it('stops before deletion if the safety snapshot fails', async () => {
  await emptyCloud(); local = tree(1); await smartPull(config, 'manual');
  const restore = vi.spyOn(bookmarkRepository, 'restoreFromBackup').mockResolvedValue();
  mocks.snapshot.mockRejectedValueOnce(new Error('disk full'));
  expect((await smartPull(config, 'manual', 'overwrite', { confirmationId: (await pending()).id })).success).toBe(false);
  expect(restore).not.toHaveBeenCalled();
});

it('retains the recovery record and blocks sync after an interrupted clear', async () => {
  await emptyCloud(); local = tree(40); await smartPull(config, 'manual');
  vi.spyOn(bookmarkRepository, 'restoreFromBackup').mockRejectedValueOnce(new Error('interrupted deletion'));
  expect((await smartPull(config, 'manual', 'overwrite', { confirmationId: (await pending()).id })).success).toBe(false);
  expect((await browser.storage.local.get('bookmark_recovery')).bookmark_recovery.snapshotId).toBe(7);
  expect((await smartPush(config, 'manual')).success).toBe(false);
});

it('reads an unknown successful upload before retry and never publishes a duplicate', async () => {
  await setCloud(JSON.stringify(backup(1))); await smartPush(config, 'manual');
  mocks.client.putFile.mockImplementationOnce(async (key, content) => {
    files.set(key, { content, time: ++clock }); throw new Error('response lost');
  });
  expect((await confirmPush()).success).toBe(false);
  expect((await smartPush(config, 'manual')).success).toBe(false);
  expect((await pending()).emptyAction).toBe('pull');
  expect(mocks.client.putFile).toHaveBeenCalledOnce(); expect(files.has(path)).toBe(true);
});

it.each(['no-intent', 'wrong-format', 'nonempty', 'outside-scope', 'spoofed-marker'])('rejects malformed empty backup: %s', async kind => {
  const wire = JSON.parse(encodeEmptyBackup(backup(0), scope));
  if (kind === 'no-intent') wire.data = tree(0);
  if (kind === 'wrong-format') wire.data.format = 'marksync-empty-v2';
  if (kind === 'nonempty') wire.data.tree = tree(1);
  if (kind === 'outside-scope') wire.data.scope = { ...scope, 'bookmarks-bar': false };
  if (kind === 'spoofed-marker') { wire.data = tree(0); wire.emptySync = scope; }
  await setCloud(JSON.stringify(wire)); local = tree(1);
  const restore = vi.spyOn(bookmarkRepository, 'restoreFromBackup').mockResolvedValue();
  expect((await smartPull(config, 'manual')).success).toBe(false);
  expect(restore).not.toHaveBeenCalled();
});

it('uses the same envelope inside E2E and decodes it after decrypting', async () => {
  await browser.storage.local.set({ e2e_enabled: true, e2e_passphrase: 'test-only-password' });
  await smartPush(config, 'manual'); expect((await confirmPush()).success).toBe(true);
  const key = [...files.keys()][0]; expect(key.endsWith('.enc')).toBe(true);
  const decoded = await fetchValidatedCloudBackup(mocks.client as any, key, { passphrase: 'test-only-password' });
  expect(decoded?.emptySync).toEqual(scope);
});

it('publishes an empty Gist revision while retaining the previous indexed backup', async () => {
  const gistConfig = { type: 'gist' as const, gistId: 'synthetic', token: 'test-only' };
  const provider = new GistStorageProvider(gistConfig);
  const gist: any = { updated_at: '2026-09-20T00:00:00Z', files: {} };
  vi.spyOn(provider.getClient(), 'getGist').mockImplementation(async () => structuredClone(gist));
  vi.spyOn(provider.getClient(), 'updateGist').mockImplementation(async changed => {
    for (const [name, file] of Object.entries(changed)) {
      if (file === null) delete gist.files[name];
      else gist.files[name] = { filename: name, size: file.content.length, ...file };
    }
    return structuredClone(gist);
  });
  vi.mocked(createStorageProvider).mockReturnValueOnce(provider).mockReturnValueOnce(provider).mockReturnValueOnce(provider);
  local = tree(1); expect((await smartPush(gistConfig, 'manual')).success).toBe(true);
  const original = JSON.parse(gist.files[INDEX_FILE].content).current;
  local = tree(0); expect((await smartPush(gistConfig, 'manual')).success).toBe(false);
  expect((await smartPush(gistConfig, 'manual', { confirmEmpty: true, confirmationId: (await pending()).id })).success).toBe(true);
  const index = JSON.parse(gist.files[INDEX_FILE].content);
  expect(index.current).not.toBe(original); expect(gist.files[original]).toBeDefined();
  expect((await fetchValidatedCloudBackup(provider, 'MarkSync/' + index.current))?.emptySync).toEqual(scope);
});
