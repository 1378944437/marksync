import browser from 'webextension-polyfill';

export const RECOVERY_KEY = 'bookmark_recovery';
export interface RecoveryRecord { id: string; snapshotId: number; kind: string; startedAt: number }
export async function getRecoveryRecord(): Promise<RecoveryRecord | null> {
  return (await browser.storage.local.get(RECOVERY_KEY))[RECOVERY_KEY] as RecoveryRecord || null;
}
export async function assertNoRecovery(allowEncryptionMigration = false): Promise<void> {
  if (await getRecoveryRecord()) throw new Error('上次书签操作未完成，自动同步已暂停。请在快照页恢复操作前快照。');
  if (!allowEncryptionMigration && (await browser.storage.local.get('encryption_migration')).encryption_migration) throw new Error('加密迁移尚未完成，请在加密设置中继续或取消迁移');
}
export async function beginRecovery(snapshotId: number, kind: string): Promise<void> {
  await assertNoRecovery();
  await browser.storage.local.set({ [RECOVERY_KEY]: { id: crypto.randomUUID(), snapshotId, kind, startedAt: Date.now() } satisfies RecoveryRecord });
}
export async function finishRecovery(): Promise<void> {
  await browser.storage.local.remove(RECOVERY_KEY);
}
