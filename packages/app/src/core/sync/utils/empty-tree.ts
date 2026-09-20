import type { BookmarkNode, CloudBackup } from '../../../types';
import { countBookmarks } from '../../bookmark/comparator';
import { validateRestoreTree } from '../../bookmark/validation';
import { filterTreeByScope, SYNC_SCOPE_KEYS, type SyncScope } from '../../bookmark/sync-scope';
import { CloudDataError } from '../types';

/** Firefox 专有菜单没有跨浏览器映射，既不能阻止清空，也不能进入清空载荷。 */
export function emptySyncTree(tree: BookmarkNode[], scope: SyncScope): BookmarkNode[] {
  return filterTreeByScope(tree, scope).map(root => ({ ...root, children: root.children?.filter(folder =>
    SYNC_SCOPE_KEYS.includes(folder.folderType as typeof SYNC_SCOPE_KEYS[number])) }));
}

export function validateEmptyTree(tree: unknown, scope: unknown): asserts tree is BookmarkNode[] {
  validateRestoreTree(tree);
  const selected = scope as SyncScope | undefined;
  const folders = tree[0].children!;
  if (!selected || SYNC_SCOPE_KEYS.some(key => typeof selected[key] !== 'boolean') ||
      !folders.length || countBookmarks(tree) !== 0 ||
      folders.some(folder => !SYNC_SCOPE_KEYS.includes(folder.folderType as typeof SYNC_SCOPE_KEYS[number]) ||
        !selected[folder.folderType as keyof SyncScope]) ||
      new Set(folders.map(folder => folder.folderType)).size !== folders.length) {
    throw new CloudDataError('清空备份的范围或书签树无效');
  }
}

/** 非数组正文使不支持此格式的旧读取器停止，而非将清空当成普通覆盖恢复。 */
export function encodeEmptyBackup(backup: CloudBackup, scope: SyncScope): string {
  validateEmptyTree(backup.data, scope);
  return JSON.stringify({ metadata: backup.metadata,
    data: { format: 'marksync-empty-v1', scope, tree: backup.data } });
}

export function decodeEmptyBackup(backup: CloudBackup): void {
  // 不信任线上伪造的内部标记。
  delete backup.emptySync;
  const body = backup.data as unknown as { format?: unknown; scope?: unknown; tree?: unknown };
  if (!body || Array.isArray(body) || typeof body !== 'object') return;
  if (body.format !== 'marksync-empty-v1') throw new CloudDataError('不支持的云端备份格式，请升级所有同步设备');
  validateEmptyTree(body.tree, body.scope);
  backup.data = body.tree;
  backup.emptySync = Object.fromEntries(SYNC_SCOPE_KEYS.map(key => [key, (body.scope as SyncScope)[key]])) as SyncScope;
}
