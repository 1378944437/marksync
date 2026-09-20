import { beforeEach, expect, it, vi } from 'vitest';
import browser from 'webextension-polyfill';
import { __resetMockStore } from '@src/__mocks__/webextension-polyfill';
import { runMaintenance } from '@src/core/sync/maintenance';
const mocks = vi.hoisted(() => ({ clear: vi.fn(), reset: vi.fn() }));
vi.mock('@src/core/sync/danger-operations', () => ({
  clearLocalBookmarks: mocks.clear, clearCloudBackups: mocks.clear, resetFactorySettings: mocks.reset,
}));
beforeEach(() => { __resetMockStore(); vi.resetAllMocks(); });

it('rejects concurrent maintenance and keeps the original lock', async () => {
  await browser.storage.local.set({ sync_lock: { holder: 'sync', lockId: 'busy', timestamp: Date.now() } });
  await expect(runMaintenance('factory')).rejects.toThrow('同步正在进行中');
  expect(mocks.reset).not.toHaveBeenCalled();
  expect((await browser.storage.local.get('sync_lock')).sync_lock.lockId).toBe('busy');
});

it('releases its lock and keeps the restoring hold when an operation fails', async () => {
  mocks.clear.mockRejectedValueOnce(new Error('partial deletion'));
  await expect(runMaintenance('local')).rejects.toThrow('partial deletion');
  expect((await browser.storage.local.get('sync_lock')).sync_lock).toBeUndefined();
  expect((await browser.storage.session.get('isRestoring')).isRestoring.until).toBeGreaterThan(Date.now());
});

it.each(['bookmark_recovery', 'encryption_migration'])('blocks destructive operations during %s', async key => {
  await browser.storage.local.set({ [key]: { snapshotId: 1 } });
  await expect(runMaintenance('factory')).rejects.toThrow();
  expect(mocks.reset).not.toHaveBeenCalled();
  expect((await browser.storage.local.get(key))[key]).toBeDefined();
  expect((await browser.storage.local.get('sync_lock')).sync_lock).toBeUndefined();
});
