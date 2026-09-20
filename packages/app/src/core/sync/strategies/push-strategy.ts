import { getBackupFileInterval, getDeviceIdentity, getE2ESettings, getLastBackupFileInfo, getMaxCloudBackups, getSyncScope, saveLastBackupFileInfo, type E2ESettings } from '../sync-settings';
import { getBrowserInfo } from '../../../infrastructure/browser/info';
import { createStorageProvider } from '../../../infrastructure/storage/provider-factory';
import { compressText } from '../../../infrastructure/utils/compression';
import { encryptText } from '../../../infrastructure/utils/crypto';
import { snapshotManager } from '../../backup';
import { bookmarkRepository, computeTreeHash, countBookmarks, filterTreeByScope } from '../../bookmark';
import { checkCloudStateBeforeUpload } from '../utils/upload-precheck';
import { clearPendingSafetyConfirmation } from '../utils/safety-guard';
import { getStorageIdentifier, type StorageConfig } from '../../storage/types';
import { fileManager, STORAGE_CONSTANTS } from '../../storage';
import { cacheManager } from '../../storage/cache-manager';
import { acquireSyncLock, releaseSyncLock } from '../lock-manager';
import { setSyncState } from '../state-manager';
import { assertNoRecovery } from '../recovery';
import type { SyncResult, SyncState } from '../types';
import { emptySyncTree, encodeEmptyBackup } from '../utils/empty-tree';

export interface PushOptions {
  skipLock?: boolean;
  skipSafetyGuard?: boolean;
  confirmationId?: string;
  confirmEmpty?: boolean;
  /** 仅供持有同一把锁的加密迁移使用；预检仍使用当前密码。 */
  writeEncryption?: E2ESettings;
  readEncryption?: E2ESettings;
  onPrepared?: (path: string, content: string, state: SyncState) => Promise<void>;
  preserveHistory?: boolean;
}

/** 一次读取的树贯穿预检、快照、备份与基线；读回确认后才清理旧文件。 */
export async function smartPush(config: StorageConfig, lockHolder: string, options: PushOptions = {}): Promise<SyncResult> {
  if (!navigator.onLine) return { success: false, action: 'error', message: '网络断开' };
  if (!options.skipLock && !await acquireSyncLock(lockHolder)) return { success: false, action: 'error', message: '同步正在进行中' };
  try {
    await assertNoRecovery(!!options.writeEncryption);
    const client = createStorageProvider(config);
    const target = getStorageIdentifier(config);
    const e2e = await getE2ESettings();
    const writing = options.writeEncryption ?? e2e;
    if (writing.enabled && !writing.passphrase) throw new Error('端到端加密密码缺失');
    const syncScope = await getSyncScope();
    const localTree = await bookmarkRepository.getTree();
    const syncedRoots = emptySyncTree(localTree, syncScope);
    const localCount = countBookmarks(syncedRoots);
    const scopedLocalTree = localCount ? filterTreeByScope(localTree, syncScope) : syncedRoots;
    if (options.confirmEmpty && localCount) throw new Error('本地书签已变化，请重新同步并确认');
    const check = await checkCloudStateBeforeUpload({ client, configUrl: target, lockHolder,
      scopedLocalTree, e2e: options.readEncryption ?? e2e, syncScope, skipSafetyGuard: options.skipSafetyGuard,
      forceUpload: !!options.writeEncryption, confirmationId: options.confirmationId });
    if (check.kind !== 'proceed') return check.result;
    await snapshotManager.createSnapshot(localTree, countBookmarks(localTree), '上传前备份');
    const identity = await getDeviceIdentity();
    const browserInfo = getBrowserInfo();
    const backup = await bookmarkRepository.createCloudBackup({ deviceId: identity.deviceId,
      deviceName: identity.deviceName || browserInfo.name }, scopedLocalTree);
    const dir = STORAGE_CONSTANTS.BACKUP_DIR;
    if (client.exists && !await client.exists(dir)) await client.createDirectory?.(dir);
    const previous = await getLastBackupFileInfo(target);
    const now = Date.now();
    const withinWindow = previous && now - previous.createdAt < await getBackupFileInterval() * 60_000;
    const revision = withinWindow ? previous.revisionNumber + 1 : 1;
    // 随机段防止同一设备同秒重试覆盖未知结果；文件名解析保持兼容。
    const deviceTag = identity.deviceId.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase() + crypto.randomUUID().replace(/-/g, '');
    let name = fileManager.generateBackupFileName(browserInfo.name, localCount, revision, deviceTag, identity.deviceName) + '.gz';
    let content = await compressText(localCount ? JSON.stringify(backup) : encodeEmptyBackup(backup, syncScope));
    if (writing.enabled) { content = await encryptText(content, writing.passphrase); name += '.enc'; }
    const path = `${dir}/${name}`;
    const state: SyncState = { time: now, url: target, type: 'upload', scope: syncScope,
      localHash: await computeTreeHash(scopedLocalTree) };
    await check.beforeWrite?.();
    await options.onPrepared?.(path, content, state);
    await client.putFile(path, content);
    if (await client.getFile(path) !== content) throw new Error('新备份已上传，但读回校验未通过，基线未更新；下次同步将以云端为准');
    const files = await client.listFiles(dir);
    const uploaded = files.find(file => file.path === path || file.name === name);
    if (!uploaded || !Number.isFinite(uploaded.lastModified)) throw new Error('新备份已上传，但无法在云端列表中确认版本，基线未更新；下次同步将以云端为准');
    if (files.some(file => (file.order ?? file.lastModified) > (uploaded.order ?? uploaded.lastModified))) throw new Error('云端出现更新版本，已停止清理并保留此次备份');
    await saveLastBackupFileInfo({ target, fileName: name, filePath: path,
      createdAt: withinWindow ? previous.createdAt : now, revisionNumber: revision });
    if (!options.writeEncryption) await setSyncState({ ...state,
      basis: { mtime: uploaded.lastModified, filePath: uploaded.path } });
    await cacheManager.clearBackupListCache();
    await clearPendingSafetyConfirmation();
    // 清空发布保留全部历史，包括同一时间窗口内的最后一个非空版本。
    if (localCount && !options.preserveHistory) {
      try {
        if (withinWindow && previous.filePath !== path) await client.deleteFile?.(previous.filePath);
        await fileManager.cleanOldBackups(client, { maxToKeep: await getMaxCloudBackups(), minToKeep: 5 });
      } catch (error) {
        return { success: true, action: 'uploaded', message: `上传成功，但旧备份清理失败：${(error as Error).message || '未知错误'}` };
      }
    }
    return { success: true, action: 'uploaded', message: '上传成功' };
  } catch (error) {
    return { success: false, action: 'error', message: (error as Error).message || '上传失败' };
  } finally {
    if (!options.skipLock) await releaseSyncLock(lockHolder);
  }
}
