/**
 * 后台操作处理器（background 侧）
 *
 * 在 Service Worker 中执行 popup 触发的长时 WebDAV 操作。
 * 必须在 background script 顶级作用域注册（与书签/闹钟监听器相同要求），
 * 确保 SW 被消息唤醒后监听器可用。
 *
 * 执行上下文说明：操作在 SW 中运行，即使发起操作的 popup 已关闭，
 * 操作仍会继续执行完毕（锁/恢复状态由策略内部的 finally 正确清理）。
 */
import browser from "webextension-polyfill";
import type { BackgroundOpMessage } from "../application/background-ops";
import { smartPull, smartPush, smartSync, restoreFromCloudBackup } from "../core/sync";
import { notifySyncCompleted } from "../application/sync-indicator";
import type { SyncResult } from "../core/sync/types";
import { createStorageProvider } from "../infrastructure/storage/provider-factory";
import { GistClient } from "../infrastructure/storage/gist-client";
import { restoreLocalSnapshot } from '../core/sync/local-restore';
import { runMaintenance } from '../core/sync/maintenance';
import { acquireSyncLock, releaseSyncLock } from '../core/sync/lock-manager';
import { fetchValidatedCloudBackup } from '../core/sync/utils/cloud-data-helper';
import { getE2ESettings } from '../core/sync/sync-settings';
import { migrateEncryption, cancelEncryptionMigration } from '../core/sync/encryption-migration';
import { getStorageIdentifier } from '../core/storage/types';

/** 防止重复注册（模块可能被多个入口引入） */
let registered = false;
let creatingGist = false;

async function dispatch(message: BackgroundOpMessage): Promise<unknown> {
  switch (message.type) {
    case 'sync:encryption': return migrateEncryption(message.config, message.next);
    case 'encryption:cancel': return cancelEncryptionMigration(message.config);
    case 'storage:maintenance': return runMaintenance(message.kind, message.config);
    case 'storage:adopt': {
      if (!await acquireSyncLock('adopt')) throw new Error('同步正在进行中');
      try {
        const client = createStorageProvider(message.config);
        if (!client.adoptBackup) throw new Error('此存储不需要接管历史版本');
        await fetchValidatedCloudBackup(client, message.path, { passphrase: (await getE2ESettings()).passphrase });
        await client.adoptBackup(message.path);
        return { success: true, action: 'skipped', message: '已选择当前版本' };
      } finally { await releaseSyncLock('adopt'); }
    }
    case 'sync:restoreLocalSnapshot':
      return restoreLocalSnapshot(message.id);
    case "storage:test":
    case "webdav:test": {
      // 连接测试的错误单独包装：popup 需要区分「认证失败」等具体原因
      try {
        const provider = createStorageProvider(message.config);
        const res = await provider.testConnection();
        if (!res.ok) {
          return { ok: false, error: res.message || "连接失败" };
        }
        return { ok: true };
      } catch (error) {
        return { ok: false, error: (error as Error).message || "连接失败" };
      }
    }

    case "gist:test": {
      // 与 storage:test 同模式：错误单独包装，popup 需要区分具体原因
      try {
        const res = await new GistClient(message.config).testConnection();
        return res.ok ? { ok: true, message: res.message } : { ok: false, error: res.message || "连接失败" };
      } catch (error) {
        return { ok: false, error: (error as Error).message || "连接失败" };
      }
    }
    case "gist:create": {
      if (creatingGist) return { ok: false, error: 'Gist 正在创建，请稍后查看创建结果' };
      creatingGist = true;
      try {
        const { id, url } = await new GistClient(message.config).createGist(message.description, message.isPublic);
        try {
          await browser.storage.local.set({ last_created_gist: { id, url,
            endpoint: message.config.endpoint?.trim().replace(/\/+$/, '') || 'https://api.github.com' } });
        } catch {
          return { ok: false, error: `Gist 已创建（ID: ${id}），但本地保存失败；请记录 ID，不要重复创建` };
        }
        return { ok: true, id, url };
      } catch (error) {
        return { ok: false, error: (error as Error).message || "创建失败" };
      } finally { creatingGist = false; }
    }

    case "sync:push":
      return message.options
        ? smartPush(message.config, "manual", { skipSafetyGuard: message.options.skipSafetyGuard === true,
            ...(message.options.confirmEmpty === true ? { confirmEmpty: true } : {}),
            confirmationId: typeof message.options.confirmationId === 'string' ? message.options.confirmationId : undefined })
        : smartPush(message.config, "manual");

    case "sync:pull":
      if (message.mode !== 'merge' && message.mode !== 'overwrite') throw new Error('无效的恢复模式');
      return typeof message.confirmationId === 'string'
        ? smartPull(message.config, "manual", message.mode, { confirmationId: message.confirmationId })
        : smartPull(message.config, "manual", message.mode);

    case "sync:smart":
      return smartSync(message.config, "manual");

    case "sync:restoreCloudBackup":
      if (typeof message.confirmationId === 'string') return restoreFromCloudBackup(message.config,
        message.path, 'manual', message.passphrase, message.confirmationId);
      return message.passphrase ? restoreFromCloudBackup(message.config, message.path, "manual", message.passphrase) : restoreFromCloudBackup(message.config, message.path, "manual");

    default:
      // 非本模块的消息，交给其他监听器
      return undefined;
  }
}

/** 处理的消息类型（用于过滤无关消息） */
const HANDLED_TYPES = new Set([
  'sync:encryption',
  'encryption:cancel',
  'storage:maintenance', 'storage:adopt',
  'sync:restoreLocalSnapshot',
  "storage:test",
  "webdav:test",
  "gist:test",
  "gist:create",
  "sync:push",
  "sync:pull",
  "sync:smart",
  "sync:restoreCloudBackup",
]);

/**
 * 注册后台操作消息监听器
 * 必须在顶级作用域调用
 */
export function registerBackgroundOpHandler(): void {
  if (registered) return;
  registered = true;

  browser.runtime.onMessage.addListener((message: unknown) => {
    const typed = message as BackgroundOpMessage;
    if (!typed?.type || !HANDLED_TYPES.has(typed.type)) {
      // 不是本处理器的消息：返回 undefined 表示不响应
      return undefined;
    }

    console.log(`[BackgroundOpHandler] Executing: ${typed.type}`);
    return dispatch(typed)
      .catch((error) => ({ success: false, action: 'error', message: (error as Error).message || '后台操作失败' }))
      .then(async (result) => {
        if (result && typeof result === 'object' && 'success' in result && 'config' in typed && typed.config) {
          await browser.storage.local.set({ last_background_result: {
            target: getStorageIdentifier(typed.config), time: Date.now(), result,
          } });
        }
        // 手动同步成功后同样给出完成提示
        const syncResult = result as SyncResult | { ok: boolean } | undefined;
        if (
          syncResult &&
          typeof syncResult === "object" &&
          "action" in syncResult &&
          syncResult.success
        ) {
          void notifySyncCompleted((syncResult as SyncResult).action, { trigger: 'manual', message: (syncResult as SyncResult).message });
        }
        return result;
      })
      .catch((error) => {
        console.error(`[BackgroundOpHandler] ${typed.type} failed:`, error);
        return {
          success: false,
          action: "error",
          message: (error as Error).message || "后台操作失败",
        };
      });
  });

  console.log("[BackgroundOpHandler] Message handler registered");
}
