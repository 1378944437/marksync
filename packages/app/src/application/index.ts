/**
 * Application 层统一导出
 * 自动同步服务的公共 API
 */
import browser from "webextension-polyfill";
import { registerBookmarkListeners, resumePendingUpload } from "./bookmark-monitor";
import { removeLegacyHostPermissions, watchHostPermissions } from '../infrastructure/browser/host-permissions';
import { cacheManager } from '../core/storage/cache-manager';
import { maybeRunScheduledSync, registerAlarmListener, registerConfigWatcher } from "./scheduler";
import { getWebDAVConfig } from "./state-manager";
import { executeAutoPull } from "./sync-executor";
import { initSafetyAlertBadgeListener } from "./sync-indicator";

/**
 * storage.session 中的"本次浏览器会话已执行启动检查"标志
 * storage.session 生命周期与浏览器会话一致：
 * - Service Worker 冷启动（被书签/闹钟事件唤醒）后标志仍在 → 不会重复拉取
 * - 浏览器关闭后自动清除 → 下次启动会正常检查
 */
const STARTUP_CHECK_SESSION_KEY = "startupCloudCheckDone";

// 无 storage.session 环境（旧版 Firefox）的降级标志
let isStartupCheckDoneFallback = false;

async function isStartupCheckDone(): Promise<boolean> {
  const session = browser.storage.session ?? null;
  if (session) {
    try {
      const result = await session.get(STARTUP_CHECK_SESSION_KEY);
      return result[STARTUP_CHECK_SESSION_KEY] === true;
    } catch {
      // 读取失败视为未检查，宁可多检查一次
      return false;
    }
  }
  return isStartupCheckDoneFallback;
}

async function markStartupCheckDone(): Promise<void> {
  const session = browser.storage.session ?? null;
  if (session) {
    try {
      await session.set({ [STARTUP_CHECK_SESSION_KEY]: true });
      return;
    } catch {
      // 写入失败时降级
    }
  }
  isStartupCheckDoneFallback = true;
}

async function clearStartupCheckFlag(): Promise<void> {
  const session = browser.storage.session ?? null;
  if (session) {
    try {
      await session.remove(STARTUP_CHECK_SESSION_KEY);
      return;
    } catch {
      // 忽略
    }
  }
  isStartupCheckDoneFallback = false;
}

/**
 * 启动自动同步服务
 * 在扩展安装/启动时调用
 */
export function startAutoSync(): void {
  console.log("[AutoSync] Auto sync service started");

  void (async () => {
    // 使用 storage.session 去重：同一浏览器会话内（包括 SW 多次冷启动）
    // 只执行一次启动检查，避免每次 SW 唤醒都触发拉取
    if (await isStartupCheckDone()) {
      console.log("[AutoSync] Startup check already done in this session, skipping");
      return;
    }
    await markStartupCheckDone();

    checkCloudOnStartup().catch((error) => {
      console.error("[AutoSync] Startup check failed:", error);
    });
  })();
}

/** 清除启动检查标志（安装/更新后允许重新检查） */
export { clearStartupCheckFlag };

/**
 * 停止自动同步服务
 * 注意：MV3 Service Worker 无法真正移除顶级监听器
 * 实际控制通过配置中的开关实现
 */
export function stopAutoSync(): void {
  console.log("[AutoSync] Auto sync service stopped (listeners remain active)");
  // 在 MV3 中，监听器会一直存在，通过配置开关控制是否执行
}

/**
 * 扩展启动时检查云端更新
 * 如果云端有新版本，自动同步到本地
 * 延迟 3 秒执行，避免与 UI 的 PROPFIND 冲突
 */
export async function checkCloudOnStartup(): Promise<void> {
  console.log("[AutoSync] Checking cloud on startup (delayed 3s)...");

  // 尊重自动同步开关：用户关闭自动同步时不做启动拉取
  const { autoSyncEnabled } = await getWebDAVConfig();
  if (!autoSyncEnabled) {
    console.log("[AutoSync] Auto sync disabled, skipping startup check");
    return;
  }

  // 延迟 3 秒，等待扩展完全初始化，避免与 UI 同时执行 PROPFIND
  await new Promise((resolve) => setTimeout(resolve, 3000));

  console.log("[AutoSync] Starting cloud check after delay...");
  await executeAutoPull();
}

/**
 * 初始化自动同步
 * 注册所有必要的监听器
 * 必须在 background script 的顶级作用域调用
 */
export function initializeAutoSync(): void {
  void removeLegacyHostPermissions().catch(error => console.error('[Permissions]', error));
  watchHostPermissions(() => {
    void cacheManager.clearAllCaches();
    void resumePendingUpload().catch(error => console.error('[Permissions] Resume failed:', error));
  });
  registerBookmarkListeners();
  registerAlarmListener();
  registerConfigWatcher();
  initSafetyAlertBadgeListener();
  // 每次 SW 唤醒都做一次到期对账：
  // - 闹钟丢失或周期与配置不符 → 重建
  // - 距上次定时检查已超过配置间隔 → 补跑一次定时同步
  // 这样定时同步不再单纯依赖 Chrome 闹钟的准时性
  void maybeRunScheduledSync();
  console.log("[AutoSync] Initialization complete");
}

// 导出定时同步相关函数
export { resetScheduledSync, startScheduledSync, stopScheduledSync, updateScheduledSync } from "./scheduler";

// 导出设备身份与安全指示器
export { clearLastBackupFileInfo, getDeviceIdentity } from "../core/sync/sync-settings";
export { getWebDAVConfig } from "./state-manager";
export { initSafetyAlertBadgeListener, setSafetyAlertBadge, clearSafetyAlertBadge } from "./sync-indicator";
