/**
 * 书签树比对工具
 * 用于检测本地和云端的差异
 */
import { generateHash } from "../../infrastructure/utils/crypto";
import type { BookmarkNode, CloudBackup } from "../../types";
import { assignHashes } from "./hash-calculator";
import { isSystemRootFolder } from "./normalizer";
import { signatureRoots, treeSignature } from "./tree-signature";

/**
 * 提取签名（使用 hash，用于精确比对）
 * 格式：B|hash（书签）或 F|title|childCount（文件夹）
 */
export function extractSignaturesWithHash(nodes: BookmarkNode[]): string[] {
  const signatures: string[] = [];

  for (const node of nodes) {
    if (!isSystemRootFolder(node)) {
      if (node.url && node.hash) {
        // 书签：使用 hash 作为唯一标识
        signatures.push(`B|${node.hash}`);
      } else if (!node.url) {
        // 文件夹：使用标题和子节点数量
        signatures.push(`F|${node.title.trim()}|${node.children?.length ?? 0}`);
      }
    }

    if (node.children?.length) {
      signatures.push(...extractSignaturesWithHash(node.children));
    }
  }

  return signatures;
}

/**
 * 比对本地和云端是否一致
 *
 * 判定口径：书签身份、父文件夹路径和同级位置均参与比较。
 * 节点 ID 不参与比较，以兼容跨浏览器同步。
 */
export async function compareWithCloud(
  localTree: BookmarkNode[],
  cloudData: CloudBackup | BookmarkNode[],
): Promise<boolean> {
  const cloudTree = Array.isArray(cloudData) ? cloudData : cloudData.data;

  // 为了准确比对，先将本地树也转换为云端格式（精简字段 + 添加 hash）
  const normalizedLocalTree = await assignHashes(signatureRoots(localTree));

  const normalizedCloudTree = await assignHashes(signatureRoots(cloudTree));
  return treeSignature(normalizedLocalTree) === treeSignature(normalizedCloudTree);
}

/**
 * 计算书签树的整体签名哈希（用于检测本地是否有未同步的修改）
 * 口径与 compareWithCloud 一致：书签身份、目录路径和位置都参与哈希。
 */
export async function computeTreeHash(nodes: BookmarkNode[]): Promise<string> {
  const withHash = await assignHashes(signatureRoots(nodes));
  return `tree-v2:${await generateHash(treeSignature(withHash), "tree-signature")}`;
}

/**
 * 统计书签数量
 */
export function countBookmarks(nodes: BookmarkNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.url) count++;
    if (node.children && node.children.length > 0) {
      count += countBookmarks(node.children);
    }
  }
  return count;
}
