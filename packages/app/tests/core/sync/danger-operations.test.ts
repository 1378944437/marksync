/**
 * danger-operations.ts 单元测试
 * 测试清空本地书签（自动备份）、清空云端备份与恢复出厂设置
 */
import { __resetMockStore } from "@src/__mocks__/webextension-polyfill";
import {
  clearCloudBackups,
  clearLocalBookmarks,
  resetFactorySettings,
} from "@src/core/sync/danger-operations";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { cacheManager } from '@src/core/storage/cache-manager';

// Mock snapshotManager
const mockCreateSnapshot = vi.fn(async () => 42);
const mockDeleteAllSnapshots = vi.fn(async () => {});

vi.mock("@src/core/backup", () => ({
  snapshotManager: {
    createSnapshot: (...args: any[]) => mockCreateSnapshot(...args),
    deleteAllSnapshots: (...args: any[]) => mockDeleteAllSnapshots(...args),
  },
}));

// Mock WebDAV client
const mockDeleteFile = vi.fn(async () => {});
const mockExists = vi.fn(async () => true);
const mockListFiles = vi.fn(async () => [
  { name: "bookmarks_1.json.gz", path: "/BookmarkSyncer/bookmarks_1.json.gz" },
  { name: "bookmarks_2.json.gz.enc", path: "/BookmarkSyncer/bookmarks_2.json.gz.enc" },
  { name: "other.txt", path: "/BookmarkSyncer/other.txt" },
]);

vi.mock("@src/infrastructure/http/webdav-client", () => ({
  getWebDAVClient: vi.fn(() => ({
    exists: mockExists,
    listFiles: mockListFiles,
    deleteFile: mockDeleteFile,
  })),
}));

describe("DangerOperations - 危险操作领域服务", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    __resetMockStore();
    vi.clearAllMocks();
  });

  describe("clearLocalBookmarks", () => {
    it("清空本地书签前强制创建安全快照并递归删除书签项", async () => {
      // 模拟本地有一棵书签树：1 个系统文件夹，内含 1 个书签与 1 个子文件夹
      const fakeTree = [
        {
          id: "0",
          title: "root",
          children: [
            {
              id: "1",
              title: "书签栏",
              children: [
                { id: "b1", title: "Site A", url: "https://a.com" },
                { id: "f1", title: "Sub Folder", children: [] },
              ],
            },
          ],
        },
      ];

      vi.spyOn(browser.bookmarks, "getTree").mockResolvedValueOnce(fakeTree as any);

      const result = await clearLocalBookmarks();

      // 验证自动触发安全快照备份
      expect(mockCreateSnapshot).toHaveBeenCalledWith(
        fakeTree,
        1,
        "清空本地书签前自动备份"
      );
      expect(result.snapshotId).toBe(42);

      // 验证分别调用 remove 与 removeTree
      expect(browser.bookmarks.remove).toHaveBeenCalledWith("b1");
      expect(browser.bookmarks.removeTree).toHaveBeenCalledWith("f1");
      expect(result.deletedCount).toBe(2);
    });
  });

  describe("clearCloudBackups", () => {
    it('waits for cache invalidation before completing', async () => {
      let release!: () => void;
      vi.spyOn(cacheManager, 'clearBackupListCache').mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
      let completed = false;
      const operation = clearCloudBackups({ url: 'https://dav.example.com', username: 'u', password: 'p' }).then(() => { completed = true; });
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      expect(completed).toBe(false);
      release();
      await operation;
      expect(completed).toBe(true);
    });
    it("仅清理书签备份文件，不删除其他 JSON 文件", async () => {
      const config = {
        url: "https://dav.example.com",
        username: "user",
        password: "pwd",
      };

      const result = await clearCloudBackups(config);
      expect(result.deletedCount).toBe(2); // 只删 bookmarks_1.json.gz 与 bookmarks_2.json.gz.enc，忽略 other.txt
      expect(mockDeleteFile).toHaveBeenCalledWith("/BookmarkSyncer/bookmarks_1.json.gz");
      expect(mockDeleteFile).toHaveBeenCalledWith("/BookmarkSyncer/bookmarks_2.json.gz.enc");
    });
  });

  describe("resetFactorySettings", () => {
    it.each(['local', 'session'])('preserves snapshots when %s settings cleanup fails', async area => {
      vi.spyOn(browser.storage[area as 'local' | 'session'], 'remove').mockRejectedValueOnce(new Error('storage failure'));
      await expect(resetFactorySettings()).rejects.toThrow('storage failure');
      expect(mockDeleteAllSnapshots).not.toHaveBeenCalled();
      expect((await browser.storage.local.get('auto_sync_enabled')).auto_sync_enabled).toBe(false);
    });

    it('retains the maintenance lock and restoring guard until snapshots are deleted', async () => {
      await browser.storage.local.set({ sync_lock: { holder: 'maintenance' }, secret: 'test' });
      await browser.storage.session.set({ isRestoring: { value: true }, cache: 'test' });
      mockDeleteAllSnapshots.mockImplementationOnce(async () => {
        expect(await browser.storage.local.get(null)).toEqual({ sync_lock: { holder: 'maintenance' }, auto_sync_enabled: false, scheduled_sync_enabled: false });
        expect(await browser.storage.session.get(null)).toEqual({ isRestoring: { value: true } });
      });
      await resetFactorySettings();
    });

    it.each(['bookmark_recovery', 'encryption_migration'])('does not erase an unresolved %s record', async key => {
      await browser.storage.local.set({ [key]: { snapshotId: 42 } });
      await expect(resetFactorySettings()).rejects.toThrow();
      expect((await browser.storage.local.get(key))[key]).toBeDefined();
      expect(mockDeleteAllSnapshots).not.toHaveBeenCalled();
    });

    it('reports snapshot deletion failure and permits retry while keeping auto sync off', async () => {
      mockDeleteAllSnapshots.mockRejectedValueOnce(new Error('database failure'));
      await expect(resetFactorySettings()).rejects.toThrow('database failure');
      expect((await browser.storage.local.get('auto_sync_enabled')).auto_sync_enabled).toBe(false);
      await resetFactorySettings();
      expect(mockDeleteAllSnapshots).toHaveBeenCalledTimes(2);
    });
    it("清除所有本地快照、清空 storage.local 与 session 缓存", async () => {
      await browser.storage.local.set({ webdav_url: "https://dav.example.com" });
      expect((await browser.storage.local.get("webdav_url")).webdav_url).toBe("https://dav.example.com");

      await resetFactorySettings();

      expect(mockDeleteAllSnapshots).toHaveBeenCalled();
      expect((await browser.storage.local.get("webdav_url")).webdav_url).toBeUndefined();
    });
  });
});
