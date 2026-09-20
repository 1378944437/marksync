import browser from 'webextension-polyfill';
import { generateHash } from '../../infrastructure/utils/crypto';
import { createStorageProvider } from '../../infrastructure/storage/provider-factory';
import { getStorageIdentifier, type StorageConfig } from '../storage/types';
import { fileManager } from '../storage/file-manager';
import { acquireSyncLock, releaseSyncLock } from './lock-manager';
import { getE2ESettings, type E2ESettings } from './sync-settings';
import { smartPush } from './strategies/push-strategy';
import { assertNoRecovery } from './recovery';
import { SYNC_STATE_KEY, type SyncResult, type SyncState } from './types';

export const MIGRATION_KEY = 'encryption_migration';
interface Migration { target: string; next: E2ESettings; path?: string; previousPath?: string | null; contentHash?: string; state?: SyncState; committed?: boolean }

async function isCommitted(migration: Migration): Promise<boolean> {
  if (migration.committed) return true;
  // 兼容旧记录：设置已提交但 remove 失败，不能再删除已生效的云端文件。
  const saved = await browser.storage.local.get([SYNC_STATE_KEY, 'e2e_enabled', 'e2e_passphrase']);
  const state = saved[SYNC_STATE_KEY] as SyncState | undefined;
  return !!migration.path && state?.url === migration.target && state.basis?.filePath === migration.path &&
    saved.e2e_enabled === migration.next.enabled &&
    saved.e2e_passphrase === (migration.next.enabled ? migration.next.passphrase : '');
}
/** 密码只存本机；候选文件路径在发起外部写入前落盘，重启后先核对再继续。 */
export async function migrateEncryption(config: StorageConfig, next: E2ESettings): Promise<SyncResult> {
  if (!await acquireSyncLock('encryption')) throw new Error('同步正在进行中');
  try {
    await assertNoRecovery(true);
    const target = getStorageIdentifier(config);
    const pending = (await browser.storage.local.get(MIGRATION_KEY))[MIGRATION_KEY] as Migration | undefined;
    if (pending && pending.target !== target) throw new Error('请切回发起加密迁移的存储目标');
    const migration: Migration = pending ?? { target, next };
    if (pending && await isCommitted(pending)) {
      await browser.storage.local.remove(MIGRATION_KEY);
      return { success: true, action: 'skipped', message: '加密设置已生效，已完成迁移收尾' };
    }
    if (typeof migration.next.enabled !== 'boolean' || typeof migration.next.passphrase !== 'string' ||
        (migration.next.enabled && migration.next.passphrase.length < 8)) throw new Error('加密密码至少 8 位');
    const client = createStorageProvider(config);
    let verified = false;
    if (migration.path) {
      const exists = await client.exists?.(migration.path);
      if (exists !== false) {
        const content = await client.getFile(migration.path);
        if (await generateHash('', content) !== migration.contentHash) throw new Error('迁移候选文件校验失败，原设置已保留');
        if ((await fileManager.getLatestBackupFile(client))?.path !== migration.path) throw new Error('迁移期间云端版本发生变化，请先核对云端备份');
        verified = true;
      }
    }
    if (!verified) {
      // 尚未准备外部写入时不持久化迁移锁，否则普通清空/熔断确认无法完成。
      // 兼容旧版在预检前留下的无候选路径记录；有路径的未知写入继续保留。
      if (pending && !migration.path) await browser.storage.local.remove(MIGRATION_KEY);
      const old = await getE2ESettings();
      const result = await smartPush(config, 'manual', { skipLock: true, preserveHistory: true,
        writeEncryption: migration.next,
        readEncryption: old.passphrase ? old : migration.next,
        onPrepared: async (path, content, state) => {
          migration.previousPath = (await fileManager.getLatestBackupFile(client))?.path ?? null;
          migration.path = path; migration.contentHash = await generateHash('', content);
          migration.state = state;
          await browser.storage.local.set({ [MIGRATION_KEY]: migration });
        } });
      if (!result.success) throw new Error(migration.path ? result.message :
        `${result.message}；加密设置未更改，请先处理上述问题，再重新设置加密`);
    }
    const latest = await fileManager.getLatestBackupFile(client);
    if (!migration.state || !latest || latest.path !== migration.path) throw new Error('迁移基线或当前版本无法确认，已暂停同步');
    // 新密码与候选文件对应的基线在同一次本地写入中提交。
    await browser.storage.local.set({ e2e_enabled: migration.next.enabled,
      e2e_passphrase: migration.next.enabled ? migration.next.passphrase : '',
      [MIGRATION_KEY]: { ...migration, committed: true },
      [SYNC_STATE_KEY]: { ...migration.state, basis: { filePath: latest.path, mtime: latest.lastModified } } });
    await browser.storage.local.remove(MIGRATION_KEY);
    return { success: true, action: 'uploaded', message: '加密设置已完成迁移，历史备份仍需原密码' };
  } finally { await releaseSyncLock('encryption'); }
}

/** 仅取消未提交的迁移；候选文件确认删除后才解除阻塞。 */
export async function cancelEncryptionMigration(config: StorageConfig): Promise<SyncResult> {
  if (!await acquireSyncLock('encryption')) throw new Error('同步正在进行中');
  try {
    const pending = (await browser.storage.local.get(MIGRATION_KEY))[MIGRATION_KEY] as Migration | undefined;
    if (!pending) return { success: true, action: 'skipped', message: '没有进行中的加密迁移' };
    if (pending.target !== getStorageIdentifier(config)) throw new Error('请切回发起加密迁移的存储目标');
    if (await isCommitted(pending)) {
      await browser.storage.local.remove(MIGRATION_KEY);
      return { success: true, action: 'skipped', message: '加密设置已生效，已完成迁移收尾，未删除备份' };
    }
    if (pending.path) {
      const client = createStorageProvider(config);
      try {
        if (await client.exists?.(pending.path) !== false) {
          const content = await client.getFile(pending.path);
          if (!pending.contentHash || await generateHash('', content) !== pending.contentHash) throw new Error('候选文件内容已变化');
          if (client.rollbackBackup) {
            if (pending.previousPath === undefined) throw new Error('旧迁移缺少上一版本信息，请继续迁移');
            await client.rollbackBackup(pending.path, pending.previousPath, content);
          } else {
            if (!client.deleteFile) throw new Error('此存储不支持删除候选文件');
            await client.deleteFile(pending.path);
          }
          const remains = client.exists ? await client.exists(pending.path) :
            (await client.listFiles(pending.path.slice(0, pending.path.lastIndexOf('/')))).some(file => file.path === pending.path);
          if (remains) throw new Error('候选文件仍存在');
        }
      } catch (error) {
        // 候选文件残留会让后续下载撞上解不开的备份；删除失败时保留迁移状态，用户可重试或用维护操作清理。
        throw new Error(`无法删除迁移候选文件，已保留迁移状态：${(error as Error).message || '删除失败'}`);
      }
    }
    await browser.storage.local.remove(MIGRATION_KEY);
    return { success: true, action: 'skipped', message: '已取消加密迁移，加密设置保持迁移前状态' };
  } finally { await releaseSyncLock('encryption'); }
}
