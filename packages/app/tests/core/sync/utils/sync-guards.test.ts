import { beforeEach, expect, it, vi } from 'vitest';
import { checkOnlineStatus, withSyncLock } from '@src/core/sync/utils/sync-guards';
const mocks = vi.hoisted(() => ({ acquire: vi.fn(), release: vi.fn() }));
vi.mock('@src/core/sync/lock-manager', () => ({ acquireSyncLock: mocks.acquire, releaseSyncLock: mocks.release }));
beforeEach(() => { vi.resetAllMocks(); mocks.acquire.mockResolvedValue(true); });

it('never runs the operation or releases someone else’s lock when busy', async () => {
  mocks.acquire.mockResolvedValueOnce(false);
  const operation = vi.fn();
  expect(await withSyncLock('test', operation)).toMatchObject({ success: false });
  expect(operation).not.toHaveBeenCalled();
  expect(mocks.release).not.toHaveBeenCalled();
});

it('releases the acquired lock when the operation throws', async () => {
  await expect(withSyncLock('test', async () => { throw new Error('failure'); })).rejects.toThrow('failure');
  expect(mocks.release).toHaveBeenCalledExactlyOnceWith('test');
});

it('distinguishes offline from online', () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  expect(checkOnlineStatus()).toMatchObject({ success: false });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  expect(checkOnlineStatus()).toBeNull();
});
