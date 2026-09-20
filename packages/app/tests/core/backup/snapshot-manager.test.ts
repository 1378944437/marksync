/**
 * snapshot-manager.ts 测试
 * 测试快照的 CRUD 操作
 */
import { SnapshotManager } from "@src/core/backup/snapshot-manager";
import type { BookmarkNode } from "@src/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { __resetMockStore } from '@src/__mocks__/webextension-polyfill';

// ─── Mock IndexedDB (idb) ───

const mockStore: Map<number, any> = new Map();
let autoId = 0;

const mockDb = {
  add: vi.fn(async (_storeName: string, value: any) => {
    autoId++;
    const id = autoId;
    mockStore.set(id, { ...value, id });
    return id;
  }),
  get: vi.fn(async (_storeName: string, key: number) => {
    return mockStore.get(key) || undefined;
  }),
  getAll: vi.fn(async (_storeName: string) => {
    return Array.from(mockStore.values());
  }),
  getAllKeys: vi.fn(async (_storeName: string) => {
    return Array.from(mockStore.keys()).sort((a, b) => a - b);
  }),
  delete: vi.fn(async (_storeName: string, key: number) => {
    mockStore.delete(key);
  }),
  clear: vi.fn(async (_storeName: string) => {
    mockStore.clear();
  }),
};

vi.mock("idb", () => ({
  openDB: vi.fn(async () => mockDb),
}));

describe("SnapshotManager", () => {
  let manager: SnapshotManager;

  const sampleTree: BookmarkNode[] = [
    {
      title: "Root",
      children: [{ title: 'Bar', children: [
        { title: "Google", url: "https://google.com" },
        { title: "GitHub", url: "https://github.com" },
      ] }],
    },
  ];

  beforeEach(() => {
    __resetMockStore();
    vi.clearAllMocks();
    mockStore.clear();
    autoId = 0;
    manager = new SnapshotManager({ maxSnapshots: 3, dbName: "test-db", storeName: "snapshots" });
  });

  // ─── createSnapshot ───
  it('protects recovery snapshots from retention, individual deletion and clearing', async () => {
    const protectedId = await manager.createSnapshot(sampleTree, 2, 'recovery');
    await browser.storage.local.set({ bookmark_recovery: { snapshotId: protectedId } });
    for (let i = 0; i < 4; i++) await manager.createSnapshot(sampleTree, 2, 'later');
    expect(mockStore.has(protectedId)).toBe(true);
    expect(mockStore.size).toBe(3);
    await expect(manager.deleteSnapshot(protectedId)).rejects.toThrow('暂不能删除');
    await expect(manager.deleteAllSnapshots()).rejects.toThrow('请先恢复');
    expect(mockStore.has(protectedId)).toBe(true);
    await browser.storage.local.remove('bookmark_recovery');
    await manager.deleteAllSnapshots();
    expect(mockStore.size).toBe(0);
  });

  it('returns the saved snapshot even when retention cleanup fails', async () => {
    for (let i = 0; i < 3; i++) await manager.createSnapshot(sampleTree, 2);
    mockDb.delete.mockRejectedValueOnce(new Error('disk failure'));
    const id = await manager.createSnapshot(sampleTree, 2);
    expect(mockStore.has(id)).toBe(true);
  });

  describe("createSnapshot", () => {
    it("创建快照并返回 ID", async () => {
      const id = await manager.createSnapshot(sampleTree, 2, "test-reason");
      expect(id).toBe(1);
      expect(mockStore.size).toBe(1);
    });

    it("快照包含正确的数据", async () => {
      const id = await manager.createSnapshot(sampleTree, 2, "test");
      const stored = mockStore.get(id);
      expect(stored.tree).toEqual(sampleTree);
      expect(stored.count).toBe(2);
      expect(stored.reason).toBe("test");
      expect(stored.timestamp).toBeGreaterThan(0);
    });

    it("超出限制时自动清理旧快照", async () => {
      await manager.createSnapshot(sampleTree, 1, "r1");
      await manager.createSnapshot(sampleTree, 2, "r2");
      await manager.createSnapshot(sampleTree, 3, "r3");
      expect(mockStore.size).toBe(3);

      // 第 4 个快照应触发清理，保留最新的 3 个
      await manager.createSnapshot(sampleTree, 4, "r4");
      expect(mockStore.size).toBe(3);
      // 最老的（id=1）应该被删除
      expect(mockStore.has(1)).toBe(false);
    });

    it("未显式指定 maxSnapshots 时动态读取 max_local_snapshots 存储配置", async () => {
      await browser.storage.local.set({ max_local_snapshots: 6 });
      const dynamicManager = new SnapshotManager({ dbName: "test-db", storeName: "snapshots" });
      for (let i = 1; i <= 7; i++) {
        await dynamicManager.createSnapshot(sampleTree, i, `snap-${i}`);
      }
      expect(mockStore.size).toBe(6);
      expect(mockStore.has(1)).toBe(false);
      expect(mockStore.has(7)).toBe(true);
    });

    it("默认原因为 auto-backup", async () => {
      const id = await manager.createSnapshot(sampleTree, 2);
      const stored = mockStore.get(id);
      expect(stored.reason).toBe("auto-backup");
    });
  });

  // ─── getLatestSnapshot ───

  describe("getLatestSnapshot", () => {
    it("返回最新的快照", async () => {
      await manager.createSnapshot(sampleTree, 1, "first");
      await manager.createSnapshot(sampleTree, 2, "second");

      const latest = await manager.getLatestSnapshot();
      expect(latest).toBeDefined();
      expect(latest!.reason).toBe("second");
    });

    it("无快照时返回 undefined", async () => {
      const latest = await manager.getLatestSnapshot();
      expect(latest).toBeUndefined();
    });
  });

  // ─── getAllSnapshots ───

  describe("getAllSnapshots", () => {
    it("返回所有快照（按时间倒序）", async () => {
      await manager.createSnapshot(sampleTree, 1, "first");
      // 稍微错开时间以确保排序正确
      await manager.createSnapshot(sampleTree, 2, "second");

      const all = await manager.getAllSnapshots();
      expect(all).toHaveLength(2);
      // 最新的在前
      expect(all[0].timestamp).toBeGreaterThanOrEqual(all[1].timestamp);
    });

    it("无快照时返回空数组", async () => {
      const all = await manager.getAllSnapshots();
      expect(all).toEqual([]);
    });
  });

  // ─── getSnapshotById ───

  describe("getSnapshotById", () => {
    it("按 ID 返回快照", async () => {
      const id = await manager.createSnapshot(sampleTree, 2, "test");
      const snapshot = await manager.getSnapshotById(id);
      expect(snapshot).toBeDefined();
      expect(snapshot!.id).toBe(id);
    });

    it("不存在的 ID 返回 undefined", async () => {
      const snapshot = await manager.getSnapshotById(999);
      expect(snapshot).toBeUndefined();
    });
  });

  // ─── deleteSnapshot ───

  describe("deleteSnapshot", () => {
    it("删除指定快照", async () => {
      const id = await manager.createSnapshot(sampleTree, 2, "test");
      expect(mockStore.size).toBe(1);

      await manager.deleteSnapshot(id);
      expect(mockStore.size).toBe(0);
    });
  });

  // ─── deleteAllSnapshots ───

  describe("deleteAllSnapshots", () => {
    it("删除所有快照", async () => {
      await manager.createSnapshot(sampleTree, 1, "r1");
      await manager.createSnapshot(sampleTree, 2, "r2");
      expect(mockStore.size).toBe(2);

      await manager.deleteAllSnapshots();
      expect(mockStore.size).toBe(0);
    });
  });

  // ─── getSnapshotCount ───

  describe("getSnapshotCount", () => {
    it("返回正确的快照数量", async () => {
      expect(await manager.getSnapshotCount()).toBe(0);
      await manager.createSnapshot(sampleTree, 1, "r1");
      expect(await manager.getSnapshotCount()).toBe(1);
      await manager.createSnapshot(sampleTree, 2, "r2");
      expect(await manager.getSnapshotCount()).toBe(2);
    });
  });

  // ─── diff 自动计算 ───

  describe("diff 自动计算", () => {
    it("自动计算连续快照之间的差分变动", async () => {
      const tree1: BookmarkNode[] = [
        { id: "1", title: "A", url: "https://a.com" },
      ];
      const tree2: BookmarkNode[] = [
        { id: "1", title: "A", url: "https://a.com" },
        { id: "2", title: "B", url: "https://b.com" },
      ];

      const wrap = (children: BookmarkNode[]): BookmarkNode[] => [{ title: '', children: [{ title: 'Bar', children }] }];
      const id1 = await manager.createSnapshot(wrap(tree1), 1, "first");
      const snap1 = await manager.getSnapshotById(id1);
      expect(snap1?.diff).toEqual({ added: 1, updated: 0, deleted: 0 });

      const id2 = await manager.createSnapshot(wrap(tree2), 2, "second");
      const snap2 = await manager.getSnapshotById(id2);
      expect(snap2?.diff).toEqual({ added: 1, updated: 0, deleted: 0 });
    });
  });
});
