/**
 * 定时调度器
 * 管理定时同步任务
 */
import browser from "webextension-polyfill";
import { handleDebounceAlarm } from "./bookmark-monitor";
import { ALARM_NAME, DEBOUNCE_ALARM, SCHEDULED_CHECK_GRACE_MS } from "./constants";
import {
  getLastScheduledCheck,
  getWebDAVConfig,
  setLastScheduledCheck,
} from "./state-manager";
import { executeAutoPull } from "./sync-executor";

/** 是否已有一次到期检查在执行中（同一 SW 实例内去重，跨实例由同步锁保护） */
let scheduledCheckInFlight = false;

/**
 * 确保定时闹钟与配置一致（存在且周期正确则不动，否则重建）
 * clear/create 之间后台可能终止；每次后台唤醒对账时修复，不能依赖创建必定完成。
 */
async function ensureScheduledAlarm(intervalMinutes: number): Promise<void> {
  const existingAlarm = await browser.alarms.get(ALARM_NAME);
  if (existingAlarm && existingAlarm.periodInMinutes === intervalMinutes) {
    return;
  }
  await browser.alarms.clear(ALARM_NAME);
  await browser.alarms.create(ALARM_NAME, {
    periodInMinutes: intervalMinutes,
    when: Date.now() + intervalMinutes * 60 * 1000,
  });
}

/**
 * 到期则执行一次定时同步检查（闹钟触发和 Service Worker 任意唤醒都走这里）
 *
 * 不直接信任闹钟的准时性：Chrome 可能推迟闹钟，且闹钟可能在设置竞态中丢失。
 * 以「上次检查时间 + 间隔」判断是否到期，闹钟只作为兜底唤醒手段——
 * 书签变化、防抖闹钟等任何唤醒都会顺带补上错过的定时同步
 */
export async function maybeRunScheduledSync(): Promise<void> {
  if (scheduledCheckInFlight) return;
  scheduledCheckInFlight = true;
  try {
    const { scheduledSyncEnabled, scheduledSyncInterval } =
      await getWebDAVConfig();

    if (!scheduledSyncEnabled) {
      await browser.alarms.clear(ALARM_NAME);
      return;
    }

    const intervalMinutes = Math.max(1, scheduledSyncInterval);
    const intervalMs = intervalMinutes * 60 * 1000;
    const last = await getLastScheduledCheck();
    const now = Date.now();

    if (last && now - last < intervalMs - SCHEDULED_CHECK_GRACE_MS) {
      // 未到期：只对账闹钟，不执行同步
      await ensureScheduledAlarm(intervalMinutes);
      return;
    }

    // 到期：先记录检查时间再执行，避免失败时高频重试
    await setLastScheduledCheck(now);
    await ensureScheduledAlarm(intervalMinutes);
    console.log(
      `[Scheduler] Scheduled sync due (last: ${last ? new Date(last).toISOString() : "never"}, interval: ${intervalMinutes}min)`,
    );
    await executeAutoPull();
  } catch (error) {
    console.error("[Scheduler] Scheduled sync check failed:", error);
  } finally {
    scheduledCheckInFlight = false;
  }
}

/**
 * 启动定时同步（安装/浏览器启动时调用）
 * 实际对账逻辑统一在 maybeRunScheduledSync 中
 */
export async function startScheduledSync(): Promise<void> {
  await maybeRunScheduledSync();
}

/**
 * 停止定时同步
 */
export async function stopScheduledSync(): Promise<void> {
  try {
    const cleared = await browser.alarms.clear(ALARM_NAME);
    if (cleared) {
      console.log("[Scheduler] Scheduled sync stopped");
    } else {
      console.log("[Scheduler] No scheduled sync alarm to stop");
    }
  } catch (error) {
    console.error("[Scheduler] Failed to stop scheduled sync:", error);
  }
}

/**
 * 处理定时闹钟触发（兜底唤醒通道）
 */
async function handleScheduledAlarm(alarm: browser.Alarms.Alarm): Promise<void> {
  if (alarm.name !== ALARM_NAME) return;

  console.log("[Scheduler] Scheduled sync alarm triggered");

  // 到期判断与执行统一走 maybeRunScheduledSync
  await maybeRunScheduledSync();
}

/**
 * 更新定时同步配置
 * 用于设置页面保存配置时调用；后台的 storage.onChanged 监听也会调用
 * 仅限 background（SW）上下文调用：到期时会执行完整同步，
 * 页面（popup/设置页）上下文可能在执行中销毁，页面侧只能依赖后台 watcher 对账。
 */
export async function updateScheduledSync(): Promise<void> {
  await maybeRunScheduledSync();
}

/**
 * 重置定时同步计时器
 * 在手动同步成功后调用：把下次自动检查推迟一个完整周期，避免紧跟着重复检查
 */
export async function resetScheduledSync(): Promise<void> {
  try {
    const { scheduledSyncEnabled, scheduledSyncInterval } =
      await getWebDAVConfig();

    // 如果定时同步未启用，不需要重置
    if (!scheduledSyncEnabled) {
      return;
    }

    const intervalMinutes = Math.max(1, scheduledSyncInterval);
    // 记录本次手动同步时间，防止唤醒式检查立即重复执行
    await setLastScheduledCheck(Date.now());
    // 清除当前的定时器并创建新的，重新开始计时
    await browser.alarms.clear(ALARM_NAME);
    await browser.alarms.create(ALARM_NAME, {
      periodInMinutes: intervalMinutes,
      when: Date.now() + intervalMinutes * 60 * 1000,
    });

    console.log(
      `[Scheduler] Scheduled sync timer reset (next trigger in ${intervalMinutes}min)`,
    );
  } catch (error) {
    console.error("[Scheduler] Failed to reset scheduled sync:", error);
  }
}

/**
 * 监听定时同步配置变化（后台侧）
 * 设置页只保存配置；后台对账闹钟，到期检查也只在后台执行。
 */
export function registerConfigWatcher(): void {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.scheduled_sync_enabled || changes.scheduled_sync_interval) {
      console.log("[Scheduler] Scheduled sync config changed, reconciling alarm");
      void maybeRunScheduledSync();
    }
  });
}

/**
 * 注册闹钟监听器
 * 必须在顶级作用域调用，确保 Service Worker 能被事件唤醒
 */
export function registerAlarmListener(): void {
  browser.alarms.onAlarm.addListener(async (alarm) => {
    try {
      console.log(`[Scheduler] Alarm triggered: ${alarm.name}`);

      switch (alarm.name) {
        case DEBOUNCE_ALARM:
          // 防抖上传
          await handleDebounceAlarm(alarm);
          break;

        case ALARM_NAME:
          // 定时同步
          await handleScheduledAlarm(alarm);
          break;

        default:
          console.warn(`[Scheduler] Unknown alarm: ${alarm.name}`);
      }
    } catch (error) {
      console.error(`[Scheduler] Alarm handler error (${alarm.name}):`, error);
    }
  });

  console.log("[Scheduler] Alarm listener registered");
}
