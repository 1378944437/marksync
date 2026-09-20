/**
 * 基础合并：只添加不存在的节点（保守策略，无删除语义）
 * 自 merger.ts 拆出；供 mergeFromBackup 与缺失文件夹兜底使用
 */
import { BrowserBookmarksAPI } from "../../infrastructure/browser/api";
import type { BookmarkNode } from "../../types";
import { normalizeUrl } from "./normalizer";

/**
 * 递归创建子节点
 */
export async function createChildren(
  parentId: string,
  children: BookmarkNode[],
): Promise<void> {
  for(const child of children) {
    if(child.url) {
      // 创建书签
      await BrowserBookmarksAPI.create({
        parentId,
        title: child.title,
        url: child.url,
      });
    } else if(child.children) {
      // 创建文件夹并递归
      const newFolder=await BrowserBookmarksAPI.create({
        parentId,
        title: child.title,
      });
      if(newFolder.id&&child.children.length>0) {
        await createChildren(newFolder.id,child.children);
      }
    }
  }
}

/**
 * 执行智能同步（三阶段）
 * @param localParentId 本地系统文件夹 ID
 * @param cloudNodes 云端该文件夹下的节点
 * @param localIndex 本地全局索引
 * @param localParentPath 本地父路径
 */
/**
 * 跨多次 smartSync 调用共享的同步状态
 * 解决“先删后配”竞态：删除阶段必须等所有顶层文件夹处理完后统一执行，
 * 否则云端跨系统文件夹移动书签时（bar→other），先处理的文件夹会删掉本地节点，
 * 后续文件夹找不到节点而丢数据；共享 processed 集合也让跨文件夹的重复书签
 * 命中“已处理”时降级为创建副本，而非互抢同一物理节点。
 */
/**
 * 合并节点（只添加新的）
 * 用于保守的合并策略
 * @returns 本次合并「消费」的本地节点 ID（新建的，以及按 URL/标题命中的既有节点）。
 *          调用方若处于统一删除阶段之前（如缺失文件夹兜底），
 *          必须把这些 ID 登记进 shared.processedLocalIds，否则会被删除阶段清除。
 */
export async function mergeNodes(parentId: string,nodes: BookmarkNode[]): Promise<Set<string>> {
  const localChildren=[...((await BrowserBookmarksAPI.getChildren(parentId)) as BookmarkNode[])];
  const consumedIds=new Set<string>();
  let addedCount=0;

  for(const node of nodes) {
    if(node.url) {
      const normalizedNodeUrl=normalizeUrl(node.url);
      const existing=localChildren.find((local) => normalizeUrl(local.url)===normalizedNodeUrl);
      if(existing) {
        if(existing.id) consumedIds.add(existing.id);
      } else {
        const createdBookmark=await BrowserBookmarksAPI.create({
          parentId,
          title: node.title,
          url: node.url,
          index: node.index,
        });
        localChildren.push(createdBookmark as BookmarkNode);
        if(createdBookmark.id) consumedIds.add(createdBookmark.id);
        addedCount++;
      }
    } else {
      const existingFolder=localChildren.find(
        (local) => !local.url&&local.title===node.title,
      );

      if(existingFolder?.id) {
        consumedIds.add(existingFolder.id);
        if(node.children&&node.children.length>0) {
          const childIds=await mergeNodes(existingFolder.id,node.children);
          childIds.forEach((id) => consumedIds.add(id));
        }
      } else {
        const newFolder=await BrowserBookmarksAPI.create({
          parentId,
          title: node.title,
          index: node.index,
        });
        localChildren.push({ ...(newFolder as BookmarkNode),children: [] });
        if(newFolder.id) consumedIds.add(newFolder.id);
        addedCount++;

        if(node.children&&node.children.length>0) {
          const childIds=await mergeNodes(newFolder.id,node.children);
          childIds.forEach((id) => consumedIds.add(id));
        }
      }
    }
  }

  if(addedCount>0) {
    console.log(`[Merger] Merged ${addedCount} new items`);
  }
  return consumedIds;
}
