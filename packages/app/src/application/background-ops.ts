/**
 * 后台操作代理（popup 侧）
 *
 * popup 通过 runtime.sendMessage 触发在 background(Service Worker)中执行的
 * 长时 WebDAV 操作（测试连接/智能同步/上传/下载/恢复），解决两个问题：
 * 1. popup 关闭时 JS 上下文销毁，操作随之中断，isRestoring/锁残留、书签树半恢复
 * 2. popup 与 background 的重复防抖/竞争
 *
 * 本文件只包含消息类型与 popup 侧辅助函数：
 * 真正的执行逻辑在 background/op-handler.ts（按需加载，不进 popup bundle）。
 */
import browser from "webextension-polyfill";
import type { StorageConfig, WebDAVConfig, GistConfig } from "../core/storage/types";
import type { SmartSyncResult, SyncResult } from "../core/sync/types";

// ─── 消息定义 ───

export type BackgroundOpMessage =
  | { type: 'sync:encryption'; config: StorageConfig; next: import('../core/sync/sync-settings').E2ESettings }
  | { type: 'encryption:cancel'; config: StorageConfig }
  | { type: 'storage:maintenance'; kind: 'local' | 'cloud' | 'factory'; config?: StorageConfig }
  | { type: 'storage:adopt'; config: StorageConfig; path: string }
  | { type: 'sync:restoreLocalSnapshot'; id: number }
  | { type: "storage:test"; config: StorageConfig }
  | { type: "webdav:test"; config: WebDAVConfig }
  | { type: "gist:test"; config: GistConfig }
  | { type: "gist:create"; config: GistConfig; description?: string; isPublic?: boolean }
  | { type: "sync:push"; config: StorageConfig; options?: { skipSafetyGuard?: boolean; confirmationId?: string; confirmEmpty?: boolean } }
  | { type: "sync:pull"; config: StorageConfig; mode: "overwrite" | "merge"; confirmationId?: string }
  | { type: "sync:smart"; config: StorageConfig }
  | { type: "sync:restoreCloudBackup"; config: StorageConfig; path: string; passphrase?: string; confirmationId?: string };

/** WebDAV 连接测试（登录）结果 */
export type WebDAVTestResult =
  | { ok: true }
  | { ok: false; error: string };

/** Gist 连接测试结果 */
export type GistTestResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

/** Gist 创建结果 */
export type GistCreateResult =
  | { ok: true; id: string; url: string }
  | { ok: false; error: string };

export interface CreatedGist { id: string; url: string; endpoint: string }

// ─── popup 侧调用辅助 ───

/**
 * 发送后台操作消息，失败时返回统一的错误结果
 */
async function sendBackgroundOp<T>(message: BackgroundOpMessage, fallback: T): Promise<T> {
  try {
    return (await browser.runtime.sendMessage(message)) as T ?? fallback;
  } catch (error) {
    console.error("[BackgroundOps] Failed to send message:", error);
    return fallback;
  }
}

export const restoreLocalSnapshotInBackground = (id: number): Promise<SyncResult> => sendBackgroundOp(
  { type: 'sync:restoreLocalSnapshot', id },
  { success: false, action: 'error', message: '无法连接扩展后台服务' },
);

export async function maintenanceInBackground(kind: 'local' | 'cloud' | 'factory', config?: StorageConfig) {
  const result = await sendBackgroundOp<{ deletedCount?: number; snapshotId?: number; success?: boolean; message?: string }>(
    { type: 'storage:maintenance', kind, config }, { success: false, message: '无法连接扩展后台服务' });
  if (result.success === false) throw new Error(result.message);
  return result;
}

export const adoptBackupInBackground = (config: StorageConfig, path: string): Promise<SyncResult> => sendBackgroundOp(
  { type: 'storage:adopt', config, path }, { success: false, action: 'error', message: '无法连接扩展后台服务' });

export const migrateEncryptionInBackground = (config: StorageConfig, next: import('../core/sync/sync-settings').E2ESettings): Promise<SyncResult> => sendBackgroundOp(
  { type: 'sync:encryption', config, next }, { success: false, action: 'error', message: '无法连接扩展后台服务' });

export const cancelEncryptionMigrationInBackground = (config: StorageConfig): Promise<SyncResult> => sendBackgroundOp(
  { type: 'encryption:cancel', config }, { success: false, action: 'error', message: '无法连接扩展后台服务' });

/** 在后台测试存储连接（登录/鉴权验证） */
export async function storageTestInBackground(config: StorageConfig): Promise<WebDAVTestResult> {
  return sendBackgroundOp<WebDAVTestResult>(
    { type: "storage:test", config },
    { ok: false, error: "无法连接扩展后台服务" },
  );
}

/** 在后台测试 WebDAV 连接（登录验证，向后兼容） */
export async function webdavTestInBackground(config: WebDAVConfig): Promise<WebDAVTestResult> {
  return storageTestInBackground(config);
}

/** Gist 连通性测试：在后台 SW 中执行，popup 中途关闭不影响请求 */
export const gistTestInBackground = (config: GistConfig): Promise<GistTestResult> => sendBackgroundOp(
  { type: 'gist:test', config }, { ok: false, error: '无法连接扩展后台服务' });

/** 后台创建 Gist 并保留最近一次成功结果，页面重开后可恢复草稿。 */
export const gistCreateInBackground = (
  config: GistConfig,
  description?: string,
  isPublic = false,
): Promise<GistCreateResult> => sendBackgroundOp(
  { type: 'gist:create', config, description, isPublic }, { ok: false, error: '无法连接扩展后台服务' });

/** 在后台执行智能同步 */
export async function smartSyncInBackground(config: StorageConfig): Promise<SmartSyncResult> {
  return sendBackgroundOp<SmartSyncResult>(
    { type: "sync:smart", config },
    { success: false, action: "error", message: "无法连接扩展后台服务" },
  );
}

/** 在后台执行上传（Push） */
export async function smartPushInBackground(
  config: StorageConfig,
  options?: { skipSafetyGuard?: boolean; confirmationId?: string; confirmEmpty?: boolean }
): Promise<SyncResult> {
  return sendBackgroundOp<SyncResult>(
    { type: "sync:push", config, options },
    { success: false, action: "error", message: "无法连接扩展后台服务" },
  );
}

/** 在后台执行下载（Pull） */
export async function smartPullInBackground(
  config: StorageConfig,
  mode: "overwrite" | "merge",
  confirmationId?: string,
): Promise<SyncResult> {
  return sendBackgroundOp<SyncResult>(
    { type: "sync:pull", config, mode, confirmationId },
    { success: false, action: "error", message: "无法连接扩展后台服务" },
  );
}

/** 在后台从指定云端备份恢复 */
export async function restoreCloudBackupInBackground(
  config: StorageConfig,
  path: string,
  passphrase?: string,
  confirmationId?: string,
): Promise<SyncResult> {
  return sendBackgroundOp<SyncResult>(
    { type: "sync:restoreCloudBackup", config, path, passphrase, confirmationId },
    { success: false, action: "error", message: "无法连接扩展后台服务" },
  );
}
