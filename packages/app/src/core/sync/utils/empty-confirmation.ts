import type { BookmarkNode, CloudBackup } from '../../../types';
import { computeTreeHash, countBookmarks } from '../../bookmark/comparator';
import { filterTreeByScope, SYNC_SCOPE_KEYS, type SyncScope } from '../../bookmark/sync-scope';
import { getSyncState } from '../state-manager';
import { getSyncScope } from '../sync-settings';
import { bookmarkRepository } from '../../bookmark/repository';
import { generateHash } from '../../../infrastructure/utils/crypto';
import { emptySyncTree } from './empty-tree';
import { getPendingSafetyConfirmation, setPendingSafetyConfirmation, type PendingSafetyConfirmation } from './safety-guard';

const EXPIRY_MS = 15 * 60_000;
export const scopeValues = (scope: SyncScope) => SYNC_SCOPE_KEYS.map(key => scope[key]);
// 常规基线忽略目录和顺序；清空确认必须覆盖目录变化（包括空文件夹）。
export function emptyTreeSignature(tree: BookmarkNode[]): Promise<string> {
  const content = (nodes: BookmarkNode[]): unknown[] => nodes.map(node => [
    node.title, node.url ?? null, node.folderType ?? null, node.children ? content(node.children) : null,
  ]);
  return generateHash(JSON.stringify(content(tree)), 'empty-confirmation');
}

export async function assertEmptyLocalUnchanged(tree: BookmarkNode[], scope: SyncScope): Promise<void> {
  if (JSON.stringify(scopeValues(await getSyncScope())) !== JSON.stringify(scopeValues(scope)) ||
      await emptyTreeSignature(emptySyncTree(await bookmarkRepository.getTree(), scope)) !==
      await emptyTreeSignature(emptySyncTree(tree, scope))) {
    throw new Error('确认后的本地内容或同步范围已变化，请重新同步并确认');
  }
}

/** 每次后台操作重新计算上下文；普通熔断开关和 skipSafetyGuard 不参与授权。 */
export async function requireEmptyConfirmation(input: {
  action: NonNullable<PendingSafetyConfirmation['emptyAction']>;
  target: string; scope: SyncScope; localTree: BookmarkNode[];
  cloud: CloudBackup | null; path?: string; mtime?: number; count: number;
  confirmationId?: string;
}): Promise<void> {
  const context = JSON.stringify([input.action, input.target, scopeValues(input.scope),
    await emptyTreeSignature(input.localTree), input.path ?? null, input.mtime ?? null,
    input.cloud ? await emptyTreeSignature(input.cloud.data) : null,
    input.cloud?.emptySync ? scopeValues(input.cloud.emptySync) : null]);
  const pending = await getPendingSafetyConfirmation();
  const current = pending?.context === context && pending.emptyAction === input.action &&
    Date.now() - pending.timestamp >= 0 && Date.now() - pending.timestamp < EXPIRY_MS;
  if (current && input.confirmationId && pending.id === input.confirmationId) return;
  const affectedRoots = (input.action === 'push' ? input.localTree : input.cloud?.data)?.[0]?.children ?? [];
  if (!current) await setPendingSafetyConfirmation({
    id: crypto.randomUUID(), timestamp: Date.now(), context, target: input.target,
    emptyAction: input.action, scope: input.scope, backupPath: input.path,
    affectedScope: Object.fromEntries(SYNC_SCOPE_KEYS.map(key =>
      [key, input.scope[key] && affectedRoots.some(folder => folder.folderType === key)])) as SyncScope,
    deletedCount: input.count, totalBefore: input.count, deletePercentage: 100, threshold: 100,
  });
  throw new Error(input.action === 'push'
    ? '同步范围内书签为空，请在同步面板确认发布清空；旧设备需升级后才能继续同步'
    : '云端请求清空书签，请在同步面板确认接收，或选择上传以保留本地内容');
}

/** 拉取、智能同步和指定历史恢复共用，自动合并不能绕过它而复活旧数据。 */
export async function requireEmptyReceive(input: {
  backup: CloudBackup; localTree: BookmarkNode[]; scope: SyncScope; target: string;
  path: string; mtime?: number; confirmationId?: string; restore?: boolean;
  /** 智能方向判断允许已确认版本之后的本地编辑；显式覆盖仍须重新确认。 */
  allowLocalChanges?: boolean;
}): Promise<boolean> {
  const local = input.backup.emptySync ? emptySyncTree(input.localTree, input.scope) : filterTreeByScope(input.localTree, input.scope);
  const remote = filterTreeByScope(input.backup.data, input.scope);
  if (!input.backup.emptySync) {
    if (input.confirmationId) throw new Error('云端备份已变化，请重新同步并确认');
    if (countBookmarks(remote) === 0 && remote[0]?.children?.length) {
      throw new Error('空备份缺少明确的清空意图，已停止恢复');
    }
    return false;
  }
  const baseline = await getSyncState(input.target);
  if (!input.restore && baseline?.basis?.filePath === input.path &&
      baseline.basis.mtime === input.mtime && baseline.localHash &&
      (input.allowLocalChanges || baseline.localHash === await computeTreeHash(local))) return true;
  const types = new Set(remote[0]?.children?.map(folder => folder.folderType));
  const affected = local[0]?.children?.filter(folder => types.has(folder.folderType)) ?? [];
  await requireEmptyConfirmation({ action: input.restore ? 'restore' : 'pull', target: input.target,
    scope: input.scope, localTree: local, cloud: input.backup, path: input.path, mtime: input.mtime,
    count: countBookmarks(affected), confirmationId: input.confirmationId });
  return false;
}
