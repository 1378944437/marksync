/**
 * 同步完成小提示
 * 扩展图标闪现绿色 ✓ 角标，详情保留在面板日志；不访问网页。
 */
import browser from "webextension-polyfill";
import type { SyncResult } from "../core/sync";
import { addSyncLog, type SyncLogDiff } from "../core/analytics/sync-analytics";

const BADGE_DURATION_MS = 2000;

let badgeTimer: ReturnType<typeof setTimeout> | null = null;

function flashBadge(): void {
  try {
    void browser.action.setBadgeBackgroundColor({ color: "#16a34a" });
    void browser.action.setBadgeTextColor({ color: "#ffffff" });
    void browser.action.setBadgeText({ text: "✓" });

    if (badgeTimer) clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => {
      badgeTimer = null;
      void browser.action.setBadgeText({ text: "" });
    }, BADGE_DURATION_MS);
  } catch (error) {
    console.warn("[SyncIndicator] Failed to flash badge:", error);
  }
}

/**
 * 设置安全警报红叹号角标（常驻显示直至用户在界面确认或清除）
 */
export function setSafetyAlertBadge(): void {
  try {
    if (badgeTimer) {
      clearTimeout(badgeTimer);
      badgeTimer = null;
    }
    void browser.action.setBadgeBackgroundColor({ color: "#dc2626" });
    void browser.action.setBadgeTextColor({ color: "#ffffff" });
    void browser.action.setBadgeText({ text: "!" });
  } catch (error) {
    console.warn("[SyncIndicator] Failed to set safety alert badge:", error);
  }
}

/**
 * 清除安全警报角标
 */
export function clearSafetyAlertBadge(): void {
  try {
    if (badgeTimer) {
      clearTimeout(badgeTimer);
      badgeTimer = null;
    }
    void browser.action.setBadgeText({ text: "" });
  } catch (error) {
    console.warn("[SyncIndicator] Failed to clear safety alert badge:", error);
  }
}

/**
 * 同步完成后的统一提示与日志记录入口
 * @param action 同步动作结果
 * @param details 可选附加日志详情（提示文本、差分变动、触发方式）
 */
export async function notifySyncCompleted(
  action: SyncResult["action"],
  details?: {
    message?: string;
    diff?: SyncLogDiff;
    trigger?: "manual" | "auto" | "schedule";
  }
): Promise<void> {
  // 异步写入同步活动日志（异常/跳过亦可记录）
  void addSyncLog({
    timestamp: Date.now(),
    trigger: details?.trigger ?? "auto",
    action,
    message: details?.message ?? (action === "uploaded" ? "上传成功" : "下载成功"),
    diff: details?.diff,
  });

  // 非上传/下载类结果（跳过、错误）不闪现角标
  if (action !== "uploaded" && action !== "downloaded") return;

  flashBadge();

}

/**
 * 监听 pending_safety_confirmation 存储变化，自动同步红叹号角标
 */
export function initSafetyAlertBadgeListener(): void {
  try {
    // 启动/唤醒时初始化角标状态
    if (browser.storage?.local) {
      void browser.storage.local.get("pending_safety_confirmation").then((res) => {
        if (res && res.pending_safety_confirmation) {
          setSafetyAlertBadge();
        }
      });
    }

    if (browser.storage?.onChanged) {
      browser.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "local" && "pending_safety_confirmation" in changes) {
          if (changes.pending_safety_confirmation?.newValue) {
            setSafetyAlertBadge();
          } else {
            clearSafetyAlertBadge();
          }
        }
      });
    }
  } catch (err) {
    console.warn("[SyncIndicator] Failed to init safety alert badge listener:", err);
  }
}
