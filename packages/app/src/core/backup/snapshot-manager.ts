/**
 * 快照管理器
 * 使用 IndexedDB 存储本地备份快照
 */
import { IDBPDatabase, openDB } from "idb";
import type { BookmarkNode } from "../../types";
import { calculateBookmarkDiff } from "../bookmark/diff-calculator";
import { validateRestoreTree } from '../bookmark/validation';
import { getMaxLocalSnapshots } from "../sync/sync-settings";
import { getRecoveryRecord } from '../sync/recovery';
import type {
    CreateSnapshotParams,
    Snapshot,
    SnapshotConfig,
    SnapshotDiffStats
} from "./types";
import { DEFAULT_SNAPSHOT_CONFIG } from "./types";

/**
 * 快照管理器类
 * 负责本地快照的 CRUD 操作
 */
export class SnapshotManager {
  private config: SnapshotConfig;
  private hasExplicitMaxSnapshots: boolean;
  private dbPromise: Promise<IDBPDatabase> | null = null;

  constructor(config: Partial<SnapshotConfig> = {}) {
    this.hasExplicitMaxSnapshots = typeof config.maxSnapshots === "number";
    this.config = { ...DEFAULT_SNAPSHOT_CONFIG, ...config };
  }

  /**
   * 获取数据库连接
   * 延迟初始化，首次调用时创建数据库；
   * 打开失败（配额超限/临时 IO 错误）时清空缓存的 Promise，
   * 下一次操作自动重试，避免一次失败导致快照功能永久失效
   */
  private async getDb(): Promise<IDBPDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDB(this.config.dbName, 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(DEFAULT_SNAPSHOT_CONFIG.storeName)) {
            db.createObjectStore(DEFAULT_SNAPSHOT_CONFIG.storeName, {
              keyPath: "id",
              autoIncrement: true,
            });
          }
        },
      }).catch((error) => {
        this.dbPromise = null;
        throw error;
      });
    }
    return this.dbPromise;
  }

  /**
   * 创建快照
   * 自动清理超出限制的旧快照
   *
   * @param tree 书签树
   * @param count 书签数量
   * @param reason 创建原因
   * @returns 快照 ID
   */
  async createSnapshot(
    tree: BookmarkNode[],
    count: number,
    reason: string = "auto-backup",
    diff?: SnapshotDiffStats
  ): Promise<number> {
    // 所有破坏性操作共用此入口；无法原样恢复的树不能充当安全快照。
    validateRestoreTree(tree);
    const db = await this.getDb();

    // 自动比对上一快照差分变动（若上层未显式传入）
    let calculatedDiff = diff;
    if (!calculatedDiff) {
      try {
        const latest = await this.getLatestSnapshot();
        if (latest && Array.isArray(latest.tree)) {
          calculatedDiff = calculateBookmarkDiff(latest.tree, tree);
        } else {
          calculatedDiff = { added: count, updated: 0, deleted: 0 };
        }
      } catch (err) {
        console.warn("[SnapshotManager] Failed to auto calculate diff:", err);
      }
    }

    const snapshot: CreateSnapshotParams = {
      timestamp: Date.now(),
      tree,
      reason,
      count,
      ...(calculatedDiff ? { diff: calculatedDiff } : {}),
    };

    const id = await db.add(this.config.storeName, snapshot);

    // 保留最近 N 个快照，删除旧的。
    // 清理属于事后收尾：快照已落库，清理失败不应让调用方误判「创建失败」而中止同步。
    try {
      await this.cleanOldSnapshots();
    } catch (error) {
      console.warn("[SnapshotManager] Snapshot created but cleanup failed:", error);
    }

    console.log(`[SnapshotManager] Created snapshot ${id} (reason: ${reason}, count: ${count})`);
    return id as number;
  }

  /**
   * 清理超出限制的旧快照（优先尊重显式参数，否则读取用户动态配置，保底最低 5 份）
   */
  private async cleanOldSnapshots(): Promise<void> {
    const db = await this.getDb();
    const keys = await db.getAllKeys(this.config.storeName);

    // 优先尊重构造函数显式配置（测试或特定实例），否则读取用户自定义配置
    const maxSnapshots = this.hasExplicitMaxSnapshots
      ? this.config.maxSnapshots
      : await getMaxLocalSnapshots();

    if (keys.length > maxSnapshots) {
      const protectedId = (await getRecoveryRecord())?.snapshotId;
      const toDelete = keys.filter(key => key !== protectedId).slice(0, keys.length - maxSnapshots);
      console.log(`[SnapshotManager] Cleaning ${toDelete.length} old snapshots (retaining ${maxSnapshots})`);

      for (const key of toDelete) {
        await db.delete(this.config.storeName, key);
      }
    }
  }

  /**
   * 获取最新的快照
   * @returns 最新快照，如果不存在则返回 undefined
   */
  async getLatestSnapshot(): Promise<Snapshot | undefined> {
    const db = await this.getDb();
    const keys = await db.getAllKeys(this.config.storeName);

    if (keys.length === 0) {
      return undefined;
    }

    const lastKey = keys[keys.length - 1];
    return db.get(this.config.storeName, lastKey);
  }

  /**
   * 获取所有快照
   * @returns 快照列表，按时间倒序排列（最新的在前）
   */
  async getAllSnapshots(): Promise<Snapshot[]> {
    const db = await this.getDb();
    const snapshots = await db.getAll(this.config.storeName);

    // 按时间倒序返回
    return snapshots.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * 根据 ID 获取快照
   * @param id 快照 ID
   * @returns 快照数据，如果不存在则返回 undefined
   */
  async getSnapshotById(id: number): Promise<Snapshot | undefined> {
    const db = await this.getDb();
    return db.get(this.config.storeName, id);
  }

  /**
   * 删除指定快照
   * @param id 快照 ID
   */
  async deleteSnapshot(id: number): Promise<void> {
    if ((await getRecoveryRecord())?.snapshotId === id) throw new Error('此快照用于恢复未完成的操作，暂不能删除');
    const db = await this.getDb();
    await db.delete(this.config.storeName, id);
    console.log(`[SnapshotManager] Deleted snapshot ${id}`);
  }

  /**
   * 删除所有快照
   */
  async deleteAllSnapshots(): Promise<void> {
    if (await getRecoveryRecord()) throw new Error('请先恢复未完成的书签操作');
    const db = await this.getDb();
    await db.clear(this.config.storeName);
    console.log("[SnapshotManager] Deleted all snapshots");
  }

  /**
   * 获取快照数量
   * @returns 快照总数
   */
  async getSnapshotCount(): Promise<number> {
    const db = await this.getDb();
    const keys = await db.getAllKeys(this.config.storeName);
    return keys.length;
  }
}

/**
 * 默认导出单例实例
 */
export const snapshotManager = new SnapshotManager();
