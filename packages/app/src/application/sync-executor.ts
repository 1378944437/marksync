/**
 * 同步执行器
 * 执行上传和拉取同步操作
 */
import { getCloudBackupList, getSyncState, smartPull, smartPush, smartSync } from "../core/sync";
import { isCloudNewerThanBasis, isLocalDirty } from "../core/sync/utils/sync-basis";
import { bookmarkRepository, computeTreeHash, filterTreeByScope } from "../core/bookmark";
import { notifySyncCompleted } from "./sync-indicator";
import {
    LOCK_HOLDER_AUTO,
    POST_PULL_UPLOAD_SUPPRESSION_MS,
} from "./constants";
import { getIsRestoring, getSyncScope } from "../core/sync/sync-settings";
import { getActiveStorageConfig, getWebDAVConfig } from "./state-manager";
import { getStorageIdentifier } from "../core/storage";
import { requireHostPermission, storageEndpoint } from '../infrastructure/browser/host-permissions';

/**
 * 执行上传同步 (Push)
 * 自动上传本地书签变化到云端
 * 如果检测到云端有未同步的更新，先增量拉取再上传
 */
export async function executeUpload(): Promise<boolean> {
  try {
    // 检查是否正在恢复（避免循环触发）
    if (await getIsRestoring()) {
      console.log("[SyncExecutor] Skipped upload: restoring in progress");
      return false;
    }

    // 检查网络状态
    if (!navigator.onLine) {
      console.log("[SyncExecutor] Skipped upload: offline");
      return false;
    }

    // 获取配置（优先多驱动配置，兼容仅 mock getWebDAVConfig 的单测环境）
    const fetchConfig = typeof getActiveStorageConfig === "function" ? getActiveStorageConfig : getWebDAVConfig;
    const active = await fetchConfig();
    const config = active?.config;
    if (!config) {
      console.log("[SyncExecutor] Skipped upload: no config");
      return false;
    }

    if (active?.autoSyncEnabled === false) {
      console.log("[SyncExecutor] Skipped upload: auto sync disabled");
      return false;
    }

    await requireHostPermission(storageEndpoint(config), config);
    const storageId = getStorageIdentifier(config);

    // 检查云端是否有未同步的更新
    const syncState = await getSyncState(storageId);

    if (
      syncState &&
      (syncState.type === "download" || syncState.type === "restore") &&
      Date.now() - syncState.time < POST_PULL_UPLOAD_SUPPRESSION_MS
    ) {
      console.log(
        "[SyncExecutor] Skipped upload: recently pulled/restored, waiting for native bookmark sync to settle",
      );
      return false;
    }

    // 强制刷新：与 smartPush 的实时云端检查保持一致，
    // 避免缓存窗口内自动上传被“云端有更新”阻断
    const backupList = await getCloudBackupList(config, true);
    const latest = backupList[0] ?? null;
    if (latest && !syncState?.localHash) {
      const result = await smartSync(config, LOCK_HOLDER_AUTO);
      return result.success;
    }

    // 如果云端有更新，先增量拉取（时间基准：服务器文件时间，与设备本地时钟无关）
    if (
      latest &&
      isCloudNewerThanBasis(
        { path: latest.path, lastModified: latest.timestamp },
        syncState,
        storageId,
      )
    ) {
      console.log(
        `[SyncExecutor] Cloud has updates, pulling first (cloud: ${new Date(latest.timestamp).toISOString()})`,
      );
      // 使用 merge 模式：保留本地新增的书签
      const pullResult = await smartPull(config, LOCK_HOLDER_AUTO, "merge");

      if (!pullResult.success) {
        console.warn(`[SyncExecutor] Pull before upload failed: ${pullResult.message}`);
        return false;
      }

      console.log("[SyncExecutor] Pull completed, now uploading merged result...");
    }

    console.log("[SyncExecutor] Starting upload...");
    const result = await smartPush(config, LOCK_HOLDER_AUTO);

    if (result.success) {
      console.log(`[SyncExecutor] Upload ${result.action}: ${result.message}`);
      void notifySyncCompleted(result.action);
    } else {
      console.warn(`[SyncExecutor] Upload failed: ${result.message}`);
    }
    return result.success;
  } catch (error) {
    console.error("[SyncExecutor] Upload error:", error);
    return false;
  }
}

/**
 * 执行拉取同步 (Pull)
 * 检查云端更新并自动同步到本地
 */
export async function executeAutoPull(): Promise<void> {
  try {
    console.log("[SyncExecutor] Checking for cloud updates...");

    // 检查是否正在恢复
    if (await getIsRestoring()) {
      console.log("[SyncExecutor] Skipped pull: restoring in progress");
      return;
    }

    // 检查网络状态
    if (!navigator.onLine) {
      console.log("[SyncExecutor] Skipped pull: offline");
      return;
    }

    // 获取配置（优先多驱动配置，兼容仅 mock getWebDAVConfig 的单测环境）
    const fetchConfig = typeof getActiveStorageConfig === "function" ? getActiveStorageConfig : getWebDAVConfig;
    const active = await fetchConfig();
    const config = active?.config;
    if (!config) {
      console.log("[SyncExecutor] Skipped pull: no config");
      return;
    }

    await requireHostPermission(storageEndpoint(config), config);
    const storageId = getStorageIdentifier(config);
    console.log(`[SyncExecutor] Using storage config (${storageId})`);

    // 获取本地同步记录
    const syncState = await getSyncState(storageId);

    // 获取云端信息（强制刷新，避免旧缓存漏检远端更新）
    const backupList = await getCloudBackupList(config, true);

    if (backupList.length === 0) {
      console.log("[SyncExecutor] No cloud backup found");
      return;
    }

    const latest = backupList[0];
    if (!syncState?.localHash) { await smartSync(config, LOCK_HOLDER_AUTO); return; }

    // 比对时间戳（基准：服务器文件时间，与设备本地时钟无关）
    if (
      !isCloudNewerThanBasis(
        { path: latest.path, lastModified: latest.timestamp },
        syncState,
        storageId,
      )
    ) {
      console.log(
        `[SyncExecutor] No updates (cloud: ${new Date(latest.timestamp).toISOString()})`,
      );
      return;
    }

    console.log(
      `[SyncExecutor] Cloud update detected (${latest.totalCount} bookmarks from ${latest.browser || "unknown"})`,
    );

    // 本地有未同步的修改时不能覆盖拉取（会删掉本地未上传的变化）：
    // 改用合并拉取保住本地改动，再把合并结果推上云端；
    // 本地干净时才覆盖拉取（让其他设备删除的书签能正常传播）
    const currentTree = await bookmarkRepository.getTree();
    const currentTreeHash = await computeTreeHash(filterTreeByScope(currentTree, await getSyncScope()));
    if (isLocalDirty(syncState, currentTreeHash)) {
      console.log(
        "[SyncExecutor] Local has unsynced changes, merging instead of overwriting",
      );
      const mergeResult = await smartPull(config, LOCK_HOLDER_AUTO, "merge");

      if (!mergeResult.success) {
        console.warn(`[SyncExecutor] Merge pull failed: ${mergeResult.message}`);
        return;
      }

      const pushResult = await smartPush(config, LOCK_HOLDER_AUTO);
      console.log(
        `[SyncExecutor] Post-merge upload: ${pushResult.action}: ${pushResult.message}`,
      );
      return;
    }

    const pullResult = await smartPull(config, LOCK_HOLDER_AUTO, "overwrite");

    if (pullResult.success) {
      console.log(`[SyncExecutor] Pull ${pullResult.action}: ${pullResult.message}`);
      void notifySyncCompleted(pullResult.action);
    } else {
      console.warn(`[SyncExecutor] Pull failed: ${pullResult.message}`);
    }
  } catch (error) {
    console.error("[SyncExecutor] Pull error:", error);
  }
}
