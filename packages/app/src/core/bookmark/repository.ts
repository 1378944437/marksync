/**
 * 书签仓储层
 * 提供书签的 CRUD 操作和高层 API
 */
import { BrowserBookmarksAPI } from "../../infrastructure/browser/api";
import type { BookmarkMetadata, BookmarkNode, CloudBackup } from "../../types";
import { countBookmarks } from "./comparator";
import { assignHashes } from "./hash-calculator";
import { validateRestoreTree } from "./validation";
import { buildGlobalIndex } from "./indexer";
import { createChildren, mergeNodes } from "./merger-basic";
import { deleteUnprocessedNodes, smartSync, type SharedSyncState } from "./smart-sync-engine";
import { findMatchingSystemFolder, hasCrossBrowserMapping, annotateSystemFolders } from "./normalizer";

/**
 * 恢复选项
 */
export interface RestoreOptions {
  /** 本机完整快照还原包含 Firefox 专有书签菜单；云端同步不启用。 */
  includeLocalOnlyRoots?: boolean;
  /**
   * 缺失文件夹兜底：云端存在本设备没有的系统文件夹（如该设备没有「移动设备书签」）时，
   * 把其中书签合并到本地「其他书签」（只增不删）。
   * 注意：这些书签随后会被推送回云端（位于「其他书签」），
   * 在拥有该文件夹的设备上会出现两份（原位置 + 其他书签）
   */
  missingFolderFallback?: boolean;
}

/**
 * 书签仓储类
 * 封装所有书签相关的业务逻辑
 */
export class BookmarkRepository {
  /**
   * 获取完整书签树
   */
  async getTree(): Promise<BookmarkNode[]> {
    const tree = (await BrowserBookmarksAPI.getTree()) as BookmarkNode[];
    // 为 Chromium 系统根标注 folderType（真实 Chrome API 不提供该字段）
    return annotateSystemFolders(tree);
  }

  /**
   * 创建云端备份
   * 包含元数据和完整的书签树（带 hash）；identity 为设备标识（可选）
   */
  async createCloudBackup(identity?: {
    deviceId?: string;
    deviceName?: string;
  }, sourceTree?: BookmarkNode[]): Promise<CloudBackup> {
    const tree = sourceTree ?? await this.getTree();
    validateRestoreTree(tree);

    // 为所有节点分配 Hash（动态计算）
    const treeWithHash = await assignHashes(tree);

    const metadata: BookmarkMetadata = {
      timestamp: Date.now(),
      clientVersion: "2.0.0-hash", // Hash 版本
      ...(identity?.deviceId ? { deviceId: identity.deviceId } : {}),
      ...(identity?.deviceName ? { deviceName: identity.deviceName } : {}),
    };

    return { metadata, data: treeWithHash };
  }

  /**
   * 从备份恢复（使用全局索引 + 三阶段同步）
   */
  async restoreFromBackup(
    backup: CloudBackup | BookmarkNode[],
    options?: RestoreOptions,
  ): Promise<void> {
    const startTime = Date.now();
    console.log("[BookmarkRepository] Starting restore from backup...");

    // 验证备份数据
    let tree: BookmarkNode[];

    if (Array.isArray(backup)) {
      tree = backup;
    } else if (backup && backup.data) {
      tree = backup.data;
    } else {
      throw new Error("备份数据格式无效");
    }

    validateRestoreTree(tree);
    const root = tree[0];
    // 兼容具有已知标题的历史系统文件夹。
    annotateSystemFolders(tree);

    const backupCount = countBookmarks(tree);
    console.log(`[BookmarkRepository] Backup contains ${backupCount} bookmarks`);

    // 获取本地书签树并构建全局索引
    console.log("[BookmarkRepository] Building global index...");
    const localTree = await this.getTree();
    const matchRoot = (remote: BookmarkNode, locals: BookmarkNode[]) =>
      options?.includeLocalOnlyRoots && remote.id === 'menu________'
        ? locals.find(local => local.id === remote.id)
        : hasCrossBrowserMapping(remote) ? findMatchingSystemFolder(remote, locals) : undefined;
    const participating = localTree[0]?.children?.filter(local => root.children!.some(remote =>
      matchRoot(remote, [local])?.id === local.id)) ?? [];
    const localIndex = await buildGlobalIndex([{ ...localTree[0], children: participating }]);
    console.log(
      `[BookmarkRepository] Index: ${localIndex.urlToBookmarks.size} URLs, ${localIndex.pathToFolder.size} folders`,
    );

    const localRoot = localTree[0];
    if (!localRoot || !localRoot.children) {
      throw new Error("无法获取本地书签根结构");
    }

    const localChildren = localRoot.children;

    // 对每个系统文件夹执行智能同步
    console.log(
      `[BookmarkRepository] Syncing ${root.children!.length} system folders...`,
    );

    // 跨顶层文件夹共享的同步状态：
    // - processedLocalIds 共享 → 跨文件夹移动/重复书签不会互抢同一物理节点
    // - 删除阶段延后到所有文件夹处理完后统一执行（防止“先删后配”丢数据）
    const shared: SharedSyncState = {
      processedLocalIds: new Set<string>(),
      visitedFolderIds: new Set<string>(),
      folderBookmarkKeys: new Map<string, Set<string>>(),
      folderUsedUrls: new Map<string, Set<string>>(),
    };

    for (const backupChild of root.children!) {
      // 检查是否有跨浏览器映射
      if (!hasCrossBrowserMapping(backupChild) && !(options?.includeLocalOnlyRoots && backupChild.id === 'menu________')) {
        // 静默跳过没有映射的系统文件夹（如 Firefox 的 menu________）
        continue;
      }

      const targetFolder = matchRoot(backupChild, localChildren);

      if (targetFolder && targetFolder.id && backupChild.children) {
        // folderType 优先：与 buildGlobalIndex 的路径前缀一致，
        // 避免 bar/Work 与 other/Work 同路径冲突
        const folderName =
          targetFolder.folderType || targetFolder.title || "system";
        console.log(`[BookmarkRepository] Syncing folder: ${folderName}`);
        await smartSync(
          targetFolder.id,
          backupChild.children,
          localIndex,
          folderName,
          shared,
        );
      } else {
        // 有映射但找不到匹配的本地文件夹
        if (options?.missingFolderFallback && backupChild.children?.length) {
          // 兜底：合并进本地「其他书签」（只增不删，不会动其他书签已有内容）
          const otherFolder = localChildren.find((l) => l.folderType === "other");
          if (otherFolder?.id) {
            console.warn(
              `[BookmarkRepository] No local folder for "${backupChild.folderType ?? backupChild.title}", merging ${backupChild.children.length} items into "other" (fallback)`,
            );
            const consumedIds = await mergeNodes(otherFolder.id, backupChild.children);
            // 兜底合并消费的本地节点（新建或命中）登记进共享已处理集，
            // 否则统一删除阶段会把它们当作未被云端覆盖的节点清除。
            for (const id of consumedIds) shared.processedLocalIds.add(id);
          } else {
            console.warn(
              `[BookmarkRepository] No matching system folder for ${backupChild.title} and no "other" folder to fall back to`,
            );
          }
        } else {
          console.warn(
            `[BookmarkRepository] No matching system folder found for ${backupChild.title}`,
          );
        }
      }
    }

    // 统一删除阶段：清理所有参与同步文件夹中未被云端覆盖的本地节点
    await deleteUnprocessedNodes(shared);

    const elapsed = Date.now() - startTime;
    console.log(`[BookmarkRepository] Restore completed in ${elapsed}ms`);
  }

  /**
   * 清空文件夹
   */
  async emptyFolder(id: string): Promise<void> {
    const children = await BrowserBookmarksAPI.getChildren(id);
    for (const child of children) {
      try {
        await BrowserBookmarksAPI.removeTree(child.id);
      } catch (error) {
        const errorMsg = (error as Error).message || '';
        // 如果书签已被删除，静默跳过
        if (errorMsg.includes("Can't find bookmark")) {
          console.log(`[Repository] Child ${child.id} already removed, skipping`);
        } else {
          console.warn(`[Repository] Failed to remove child ${child.id}:`, error);
          throw error;
        }
      }
    }
  }

  /**
   * 递归创建子节点
   */
  async createChildren(parentId: string, children: BookmarkNode[]): Promise<void> {
    await createChildren(parentId, children);
  }

  /**
   * 获取本地书签数量
   */
  async getLocalCount(): Promise<number> {
    const tree = await this.getTree();
    return countBookmarks(tree);
  }

  /**
   * 合并备份（只添加不存在的）
   */
  async mergeFromBackup(
    backup: CloudBackup | BookmarkNode[],
    options?: RestoreOptions,
  ): Promise<void> {
    let tree: BookmarkNode[];

    if (Array.isArray(backup)) {
      tree = backup;
    } else {
      tree = backup.data;
    }

    validateRestoreTree(tree);
    const root = tree[0];
    if (!root || !root.children) {
      throw new Error("Invalid bookmark backup format");
    }

    // 兼容旧版云端数据：顶层系统文件夹可能无 folderType/id，按已知标题识别
    annotateSystemFolders(tree);

    // 获取本地书签树
    const localTree = await this.getTree();
    const localRoot = localTree[0];
    if (!localRoot || !localRoot.children) {
      throw new Error("无法获取本地书签根结构");
    }

    console.log(`[BookmarkRepository] Merging ${root.children.length} system folders...`);

    // 遍历云端的系统文件夹
    for (const child of root.children) {
      // 检查是否有跨浏览器映射
      if (!hasCrossBrowserMapping(child)) {
        // 静默跳过没有映射的系统文件夹（如 Firefox 的 menu________）
        continue;
      }

      // 使用 findMatchingSystemFolder 匹配本地文件夹
      const targetFolder = findMatchingSystemFolder(child, localRoot.children);

      if (targetFolder && targetFolder.id && child.children) {
        const folderName = targetFolder.title || child.title;
        console.log(`[BookmarkRepository] Merging folder: ${folderName} (${child.children.length} items)`);
        await mergeNodes(targetFolder.id, child.children);
      } else if (options?.missingFolderFallback && child.children?.length) {
        // 兜底：合并进本地「其他书签」
        const otherFolder = localRoot.children.find((l) => l.folderType === "other");
        if (otherFolder?.id) {
          console.warn(
            `[BookmarkRepository] Merging ${child.children.length} items from missing folder into "other" (fallback)`,
          );
          await mergeNodes(otherFolder.id, child.children);
        } else {
          console.warn(
            `[BookmarkRepository] No matching system folder for ${child.title} and no "other" folder to fall back to`,
          );
        }
      } else {
        // 有映射但找不到匹配的本地文件夹
        console.warn(
          `[BookmarkRepository] No matching system folder found for ${child.title}`,
        );
      }
    }

    console.log(`[BookmarkRepository] Merge completed`);
  }
}

/**
 * 导出单例实例
 */
export const bookmarkRepository = new BookmarkRepository();
