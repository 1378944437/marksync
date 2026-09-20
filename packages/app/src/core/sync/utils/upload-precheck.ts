/**
 * 上传前云端状态预检
 * 下载云端最新备份，判断是否允许本次上传：
 * - 云端更新 + 本地有未同步修改 + 自动同步 → 中止（防数据丢失）
 * - 内容一致 + 非同浏览器手动 → 跳过上传
 * 端到端加密的提示/解密错误原样抛出（调用方不得用明文覆盖加密现场）
 */
import type { IWebDAVClient } from "../../../infrastructure/http/webdav-client";
import type { IStorageProvider } from "../../storage/provider-interface";
import { getBrowserInfo, isSameBrowser } from "../../../infrastructure/browser/info";
import { E2EDecryptError, E2EPasswordRequiredError } from "../../../infrastructure/utils/crypto";
import { countBookmarks, compareWithCloud, computeTreeHash, filterTreeByScope, calculateBookmarkDiff, type SyncScope } from "../../bookmark";
import type { BookmarkNode } from "../../../types";
import { fileManager } from "../../storage";
import { getSyncState, setSyncState } from "../state-manager";
import { isCloudNewerThanBasis } from "./sync-basis";
import { fetchValidatedCloudBackup } from "./cloud-data-helper";
import { CloudDataError } from "../types";
import { saveLastRemoteDevice } from "../sync-settings";
import type { E2ESettings } from "../sync-settings";
import type { SyncResult } from "../types";
import { evaluateSafetyBreaker } from "./safety-guard";
import { assertEmptyLocalUnchanged, emptyTreeSignature, requireEmptyConfirmation, requireEmptyReceive, scopeValues } from './empty-confirmation';
import { validateEmptyTree } from './empty-tree';

export type CloudStateCheck =
  | { kind: "proceed"; beforeWrite?: () => Promise<void> }
  | { kind: "abort"; result: SyncResult }
  | { kind: "skip"; result: SyncResult };

export interface CloudStateCheckParams {
  client: IStorageProvider | IWebDAVClient;
  configUrl: string;
  lockHolder: string;
  /** 已按同步范围过滤的本地树 */
  scopedLocalTree: BookmarkNode[];
  e2e: E2ESettings;
  syncScope: SyncScope;
  skipSafetyGuard?: boolean;
  forceUpload?: boolean;
  confirmationId?: string;
}

/**
 * 上传前检查云端状态
 * 返回 proceed 表示通过全部检查可继续上传；abort/skip 携带面向用户的同步结果
 */
export async function checkCloudStateBeforeUpload(
  params: CloudStateCheckParams,
): Promise<CloudStateCheck> {
  const { client, configUrl, lockHolder, scopedLocalTree, e2e, syncScope } = params;

  try {
    const latest = await fileManager.getLatestBackupFile(client);
    if (!latest && countBookmarks(scopedLocalTree) > 0) {
      console.log("[PushStrategy] No cloud backup found, first upload");
      return { kind: "proceed" };
    }

    const cloudData = latest ? await fetchValidatedCloudBackup(client, latest.path, {
      passphrase: e2e.enabled ? e2e.passphrase : undefined,
    }) : null;
    if (countBookmarks(scopedLocalTree) === 0) {
      validateEmptyTree(scopedLocalTree, syncScope);
      const cloudHash = cloudData ? await emptyTreeSignature(cloudData.data) : null;
      const sameEmpty = cloudData?.emptySync &&
        JSON.stringify(scopeValues(cloudData.emptySync)) === JSON.stringify(scopeValues(syncScope)) &&
        await compareWithCloud(scopedLocalTree, cloudData);
      if (sameEmpty && latest) {
        await requireEmptyReceive({ backup: cloudData, localTree: scopedLocalTree, scope: syncScope,
          target: configUrl, path: latest.path, mtime: latest.lastModified });
        if (!params.forceUpload) return { kind: 'skip', result: { success: true, action: 'skipped', message: '清空已同步，无需重复发布' } };
      } else {
        await requireEmptyConfirmation({ action: 'push', target: configUrl, scope: syncScope,
          localTree: scopedLocalTree, cloud: cloudData, path: latest?.path, mtime: latest?.lastModified,
          count: cloudData ? countBookmarks(filterTreeByScope(cloudData.data, syncScope)) : 0,
          confirmationId: lockHolder === 'manual' ? params.confirmationId : undefined });
      }
      // 确认后到真正上传前仍可能经过压缩/加密/快照等异步工作，最后再核对一次。
      return { kind: 'proceed', beforeWrite: async () => {
        const current = await fileManager.getLatestBackupFile(client);
        await assertEmptyLocalUnchanged(scopedLocalTree, syncScope);
        const changed = current?.path !== latest?.path || current?.lastModified !== latest?.lastModified;
        if (changed) throw new Error('确认后的本地内容、范围或云端版本已变化，请重新同步并确认');
        if (current) {
          const fresh = await fetchValidatedCloudBackup(client, current.path, { passphrase: e2e.enabled ? e2e.passphrase : undefined });
          if (!fresh || await emptyTreeSignature(fresh.data) !== cloudHash) throw new Error('云端内容已变化，请重新确认');
        }
      } };
    }
    if (!cloudData || !latest) {
      return { kind: "proceed" };
    }

    const cloudCount = countBookmarks(cloudData.data);

    // 记录云端备份所属设备（面板显示「来自 XX」，无需额外下载）
    if (cloudData.metadata?.deviceId || cloudData.metadata?.deviceName) {
      try {
        await saveLastRemoteDevice({
          target: configUrl,
          deviceId: cloudData.metadata.deviceId,
          deviceName: cloudData.metadata.deviceName,
          time: Date.now(),
        });
      } catch {
        // 记录失败不影响同步
      }
    }

    console.log(
      `[PushStrategy] Cloud: ${cloudCount} bookmarks (${new Date(latest.lastModified).toISOString()})`,
    );

    // 检查云端是否有未拉取的更新（以服务器文件时间为基准，不受设备时钟偏差影响）
    const syncState = await getSyncState(configUrl);
    const lastSyncTime = syncState?.time ?? 0;

    if (isCloudNewerThanBasis(latest, syncState, configUrl)) {
      // 云端有更新且本地未同步：自动同步阻止上传防数据丢失；手动同步允许用户选择
      const isManualSync = lockHolder === "manual";

      if (!isManualSync) {
        console.warn(
          `[PushStrategy] Cloud is newer, blocking auto-sync (cloud: ${new Date(latest.lastModified).toISOString()}, last: ${new Date(lastSyncTime).toISOString()})`,
        );
        return { kind: "abort", result: { success: false, action: "error", message: "云端有更新，请先拉取" } };
      }
      console.warn(
        `[PushStrategy] Cloud is newer but manual sync, allowing user choice (cloud: ${new Date(latest.lastModified).toISOString()}, last: ${new Date(lastSyncTime).toISOString()})`,
      );
    }

    // 比对内容（双方均按同步范围过滤后再比较）
    console.log("[PushStrategy] Comparing content...");
    const isIdentical = await compareWithCloud(
      scopedLocalTree,
      { ...cloudData, data: filterTreeByScope(cloudData.data, syncScope) },
    );

    if (!isIdentical) {
      console.log("[PushStrategy] Content differs, checking safety guard...");
      const scopedCloudTree = filterTreeByScope(cloudData.data, syncScope);
      const diff = calculateBookmarkDiff(scopedCloudTree, scopedLocalTree);

      const safetyCheck = await evaluateSafetyBreaker({
        context: JSON.stringify([configUrl, syncScope, latest.path, latest.lastModified, await computeTreeHash(scopedLocalTree)]),
        target: configUrl,
        confirmationId: params.confirmationId,
        deletedCount: diff.deleted,
        totalBefore: countBookmarks(scopedCloudTree),
        skipSafetyGuard: params.skipSafetyGuard,
      });

      if (!safetyCheck.allowed) {
        console.warn(`[PushStrategy] Safety breaker triggered: ${safetyCheck.reason}`);
        return {
          kind: "abort",
          result: {
            success: false,
            action: "error",
            message: safetyCheck.reason || "触发防误删安全保护，已暂停同步",
          },
        };
      }

      console.log("[PushStrategy] Safety check passed, will upload");
      return { kind: "proceed" };
    }

    // 内容相同：手动同步且浏览器一致时重建备份，否则跳过
    const localBrowserName = getBrowserInfo().name;
    const fileName = latest.path.split("/").pop() || "";
    const cloudBrowser = fileManager.parseBackupFileName(fileName)?.browser || "";
    const isManualSync = lockHolder === "manual";

    if (params.forceUpload || (isManualSync && isSameBrowser(localBrowserName, cloudBrowser))) {
      console.log("[PushStrategy] Content identical but manual sync from same browser, creating new backup");
      return { kind: "proceed" };
    }

    console.log("[PushStrategy] Content identical, skipping upload");
    await setSyncState({
      time: Date.now(),
      url: configUrl,
      type: "skip_identical",
      scope: syncScope,
      basis: { mtime: latest.lastModified, filePath: latest.path },
      localHash: await computeTreeHash(scopedLocalTree),
    });
    return {
      kind: "skip",
      result: { success: true, action: "skipped", message: "书签已同步，无需更新" },
    };
  } catch (error) {
    // 契约类错误必须中止，不得用本地数据覆盖云端现场：
    // - 端到端加密：未输入密码 / 密码不一致
    // - 云端备份数据损坏或结构无效
    if (
      error instanceof E2EPasswordRequiredError ||
      error instanceof E2EDecryptError ||
      error instanceof CloudDataError
    ) {
      throw error;
    }
    console.warn("[PushStrategy] Failed to check cloud state:", error);
    // 状态未知时停止上传，保留云端现场。
    throw error;
  }
}
