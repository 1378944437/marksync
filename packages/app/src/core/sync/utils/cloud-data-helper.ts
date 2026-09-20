/**
 * 云端数据辅助函数
 * 统一「下载 → （端到端解密）→ 解压 → 解析 → 结构校验」的通用流程，
 * 三大同步策略与云端恢复共用。空内容同样视为损坏并中止；
 * 格式损坏/结构无效抛出 CloudDataError（调用方一律中止，不得覆盖云端）
 */
import type { IWebDAVClient } from "../../../infrastructure/http/webdav-client";
import type { IStorageProvider } from "../../storage/provider-interface";
import type { CloudBackup } from "../../../types";
import { CloudDataError } from "../types";
import { queueManager } from "../../storage/queue-manager";
import { validateRestoreTree } from '../../bookmark/validation';
import { assignHashes } from '../../bookmark/hash-calculator';
import { decodeEmptyBackup } from './empty-tree';
import { countBookmarks } from '../../bookmark/comparator';

/**
 * 下载并校验云端备份
 *
 * @param client 存储客户端（IStorageProvider 或 IWebDAVClient）
 * @param path 备份文件路径（.json.gz 或加密的 .json.gz.enc）
 * @param opts.passphrase 端到端加密密码（.enc 备份必需，缺失时队列层抛出开启提示）
 * @returns 解析后的合法备份数据
 */
export async function fetchValidatedCloudBackup(
  client: IStorageProvider | IWebDAVClient,
  path: string,
  opts: { passphrase?: string } = {},
): Promise<CloudBackup | null> {
  const json = await queueManager.getFileWithDedup(client, path, {
    passphrase: opts.passphrase,
  });
  if (!json) {
    throw new CloudDataError('云端备份为空，已停止同步');
  }

  let data: CloudBackup;
  try {
    data = JSON.parse(json) as CloudBackup;
  } catch {
    throw new CloudDataError("云端备份数据格式损坏，无法解析");
  }
  try { if (data && typeof data === 'object') decodeEmptyBackup(data); validateRestoreTree(data?.data); }
  catch { throw new CloudDataError("云端备份数据结构无效"); }
  if (!data.emptySync && countBookmarks(data.data) === 0) throw new CloudDataError('空备份缺少明确的清空意图，已停止同步');
  validateCloudBackupMetadata(data);
  // 不信任备份携带的旧 hash，统一按实际内容计算。
  data.data = await assignHashes(data.data);
  return data;
}

/**
 * metadata 会进入本地存储并在 UI 展示（「来自 XX」），与备份正文一样按不可信输入校验：
 * 已知字段必须为声明的标量类型，字符串长度受限；未知字段不读取、不落盘。
 */
function validateCloudBackupMetadata(data: CloudBackup): void {
  const md = data.metadata as unknown;
  if (md === undefined) return;
  if (!md || typeof md !== 'object' || Array.isArray(md)) {
    throw new CloudDataError('云端备份元数据无效');
  }
  const m = md as Record<string, unknown>;
  if (m.timestamp !== undefined && typeof m.timestamp !== 'number') {
    throw new CloudDataError('云端备份元数据无效');
  }
  for (const key of ['clientVersion', 'deviceId', 'deviceName'] as const) {
    const value = m[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.length > 128) {
      throw new CloudDataError('云端备份元数据无效');
    }
  }
}
