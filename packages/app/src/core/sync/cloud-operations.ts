/**
 * 云端操作
 * 获取云端信息、备份列表、恢复指定备份
 */
import { createStorageProvider } from "../../infrastructure/storage/provider-factory";
import type { BookmarkNode } from "../../types";
import { getE2ESettings, getMissingFolderFallback, getSyncScope, holdRestoringUntil, setIsRestoring, saveLastRemoteDevice } from "./sync-settings";
import { snapshotManager } from "../backup";
import {
  bookmarkRepository,
  computeTreeHash,
  countBookmarks,
  filterTreeByScope,
} from "../bookmark";
import { fetchValidatedCloudBackup } from "./utils/cloud-data-helper";
import { fileManager, STORAGE_CONSTANTS } from "../storage";
import { cacheManager } from "../storage/cache-manager";
import type { CloudBackupFile, CloudInfo, StorageConfig } from "../storage/types";
import { getStorageIdentifier } from "../storage/types";
import { acquireSyncLock, releaseSyncLock } from "./lock-manager";
import { setSyncState } from "./state-manager";
import type { SyncBasis } from "./types";
import type { SyncResult } from "./types";
import { assertNoRecovery, beginRecovery, finishRecovery } from './recovery';
import { assertEmptyLocalUnchanged, requireEmptyReceive } from './utils/empty-confirmation';
import { clearPendingSafetyConfirmation } from './utils/safety-guard';
import { emptySyncTree } from './utils/empty-tree';

const DIR = STORAGE_CONSTANTS.BACKUP_DIR;

/**
 * 获取云端备份信息
 * 使用 getCloudBackupList 来获取列表，支持强制刷新
 * @param config 存储配置（WebDAV 或 Gist）
 * @param forceRefresh 是否强制刷新（跳过缓存），默认 false
 */
export async function getCloudInfo(config: StorageConfig, forceRefresh = false): Promise<CloudInfo> {
  if (!navigator.onLine) {
    console.log("[CloudOperations] getCloudInfo: offline");
    return { exists: false };
  }

  // 使用 getCloudBackupList 获取列表
  // 这里不吞错误：否则 UI 会把“认证失败/解析失败”等情况误显示成“云端 0”。
  const backupList = await getCloudBackupList(config, forceRefresh);

  if (backupList.length === 0) {
    console.log("[CloudOperations] No cloud backup exists");
    return { exists: false };
  }

  // 获取最新的备份（列表已按时间排序）
  const latest = backupList[0];

  const info: CloudInfo = {
    filePath: latest.path,
    exists: true,
    timestamp: latest.timestamp,
    totalCount: latest.totalCount,
    browser: latest.browser,
    browserVersion: undefined,
    deviceTag: latest.deviceTag,
  };

  console.log(
    `[CloudOperations] Cloud info: ${info.totalCount} bookmarks from ${info.browser || "unknown"}`,
  );

  return info;
}

/**
 * 获取所有云端备份文件列表
 * 优先使用缓存（5分钟），避免频繁网络请求
 */
export async function getCloudBackupList(config: StorageConfig, forceRefresh = false): Promise<CloudBackupFile[]> {
  if (!navigator.onLine) {
    console.log("[CloudOperations] getCloudBackupList: offline");
    return [];
  }

  // 尝试从缓存读取（除非强制刷新）
  const client = createStorageProvider(config);
  await client.assertAccess?.();
  if (!forceRefresh) {
    const cached = await cacheManager.getCachedBackupList(getStorageIdentifier(config));
    if (cached) {
      return cached.backups;
    }
  }

  // 缓存未命中或已过期，获取远端列表
  console.log("[CloudOperations] Fetching backup list from cloud...");
  const files = await client.listFiles(DIR);

  // 过滤出备份文件（.json.gz 与端到端加密的 .json.gz.enc）
  const backupFiles = files.filter((file) => fileManager.isBackupFile(file.name));

  // 按最后修改时间排序（最新的在前）
  backupFiles.sort((a, b) => (b.order ?? b.lastModified) - (a.order ?? a.lastModified));

  // 从文件名解析元数据（不下载文件内容）
  // 注意：时间戳优先用服务器 lastModified（epoch，跨时区可比），
  // 文件名中的时间戳按本地时区解析，跨时区设备间不可比，仅作展示兑底
  const backupList: CloudBackupFile[] = backupFiles.map((file) => {
    const parsed = fileManager.parseBackupFileName(file.name);

    return {
      name: file.name,
      path: file.path,
      timestamp: file.lastModified || parsed?.timestamp || 0,
      totalCount: parsed?.count,
      browser: parsed?.browser,
      browserVersion: undefined, // 不再提供
      deviceTag: parsed?.deviceTag,
      deviceName: parsed?.deviceName,
    };
  });

  console.log(`[CloudOperations] Found ${backupList.length} cloud backups`);

  // 缓存结果（注意：认证失败等错误会在 listFiles 抛出，因此不会缓存“假空列表”）
  await client.assertAccess?.();
  await cacheManager.cacheBackupList({
    target: getStorageIdentifier(config),
    backups: backupList,
    cachedAt: Date.now(),
  });

  return backupList;
}

/**
 * 从指定的云端备份文件恢复
 */
export async function restoreFromCloudBackup(
  config: StorageConfig,
  backupPath: string,
  lockHolder: string,
  passphrase?: string,
  confirmationId?: string,
): Promise<SyncResult> {
  const startTime = Date.now();
  console.log(`[CloudOperations] Restoring from backup: ${backupPath}`);

  // 检查网络
  if (!navigator.onLine) {
    console.warn("[CloudOperations] Restore aborted: offline");
    return { success: false, action: "error", message: "网络断开" };
  }

  // 获取锁
  const lockAcquired = await acquireSyncLock(lockHolder);
  if (!lockAcquired) {
    console.warn("[CloudOperations] Restore aborted: lock not acquired");
    return { success: false, action: "error", message: "同步正在进行中" };
  }

  try {
    await assertNoRecovery();
    await setIsRestoring(true);
    const client = createStorageProvider(config);

    // 路径问题已修复，理论上不再需要智能等待
    // 保留简化版本作为保险（如果还有 409，说明有其他问题）
    console.log(`[CloudOperations] Starting restore operation...`);

    // 直接下载备份文件（带去重保护；.enc 备份需本机密码解密，未开启时队列层抛出开启提示）
    console.log("[CloudOperations] Downloading backup...");
    const e2e = await getE2ESettings();
    const fetched = await fetchValidatedCloudBackup(client, backupPath, {
      passphrase: passphrase || e2e.passphrase || undefined,
    });
    if (!fetched) {
      console.error("[CloudOperations] Restore aborted: failed to read backup file");
      return { success: false, action: "error", message: "无法读取备份文件" };
    }
    const cloudData = fetched;

    const fileName = backupPath.split("/").pop() || "";
    const cloudTime = cloudData.metadata?.timestamp || 0;

    // 应用同步范围：范围外系统文件夹不参与恢复
    const syncScope = await getSyncScope();
    const currentTree: BookmarkNode[] = await bookmarkRepository.getTree();
    await requireEmptyReceive({ backup: cloudData, localTree: currentTree, scope: syncScope,
      target: getStorageIdentifier(config), path: backupPath, restore: true,
      confirmationId: lockHolder === 'manual' ? confirmationId : undefined });
    cloudData.data = filterTreeByScope(cloudData.data, syncScope);
    const scopedCloudCount = countBookmarks(cloudData.data);

    // 记录云端备份所属设备（面板显示「来自 XX」）
    if (cloudData.metadata?.deviceId || cloudData.metadata?.deviceName) {
      try {
        await saveLastRemoteDevice({
          target: getStorageIdentifier(config),
          deviceId: cloudData.metadata.deviceId,
          deviceName: cloudData.metadata.deviceName,
          time: Date.now(),
        });
      } catch {
        // 记录失败不影响恢复
      }
    }

    // 从文件名解析浏览器信息
    const parsed = fileManager.parseBackupFileName(fileName);
    const cloudBrowser = parsed?.browser || "unknown";

    console.log(
      `[CloudOperations] Restoring ${scopedCloudCount} bookmarks (scoped) from ${cloudBrowser} (${new Date(cloudTime).toISOString()})`,
    );

    // 2. 恢复书签
    console.log("[CloudOperations] Restoring bookmarks...");
    const missingFolderFallback = (await getMissingFolderFallback()) && syncScope.other;
    const snapshotId = await snapshotManager.createSnapshot(currentTree, countBookmarks(currentTree),
      `云端恢复前 (${lockHolder === 'manual' ? '手动' : '自动'} 恢复)`);
    if (cloudData.emptySync) await assertEmptyLocalUnchanged(currentTree, syncScope);
    await beginRecovery(snapshotId, 'cloud-restore');
    await bookmarkRepository.restoreFromBackup(cloudData, { missingFolderFallback });

    // 3. 记录本地树签名 + 服务器时间基线
    // 时间基线取当前云端最新文件（即使恢复的是更早的备份），
    // 避免下一次自动拉取立即用较新的备份覆盖用户刚恢复的状态
    let localHash: string | undefined;
    try {
      localHash = await computeTreeHash((cloudData.emptySync ? emptySyncTree : filterTreeByScope)(await bookmarkRepository.getTree(), syncScope));
    } catch (error) {
      console.warn("[CloudOperations] Failed to compute local baseline:", error);
      throw error;
    }

    let basis: SyncBasis | undefined;
    try {
      const latest = await fileManager.getLatestBackupFile(client);
      if (latest) basis = { mtime: latest.lastModified, filePath: latest.path };
    } catch (error) {
      console.warn("[CloudOperations] Failed to resolve latest backup time:", error);
    }

    // 4. 更新同步时间
    await setSyncState({
      time: Date.now(),
      url: getStorageIdentifier(config),
      type: "restore",
      scope: syncScope,
      basis,
      localHash,
    });
    await finishRecovery();
    if (cloudData.emptySync) await clearPendingSafetyConfirmation();

    const elapsed = Date.now() - startTime;
    console.log(`[CloudOperations] Restore completed in ${elapsed}ms`);
    return { success: true, action: "downloaded", message: "恢复成功" };
  } catch (error) {
    const elapsed = Date.now() - startTime;
    const errorMessage = (error as Error).message || "恢复失败";
    console.error(`[CloudOperations] Restore failed after ${elapsed}ms:`, error);
    return {
      success: false,
      action: "error",
      message: errorMessage,
    };
  } finally {
    await holdRestoringUntil();

    await releaseSyncLock(lockHolder);
  }
}
