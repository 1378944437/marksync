/**
 * 防误删安全防御守卫
 * 监控书签批量删除幅度，触发安全阈值熔断阻断异常静默同步
 */
import browser from "webextension-polyfill";

export const SAFETY_SETTINGS_KEY = "sync_safety_settings";
export const PENDING_SAFETY_CONFIRMATION_KEY = "pending_safety_confirmation";

/**
 * 安全防御配置
 */
export interface SafetySettings {
  /** 是否开启防误删安全防御（默认开启） */
  enabled: boolean;
  /** 批量删除百分比熔断阈值（默认 20%，范围 10% ~ 50%） */
  threshold: number;
}

/**
 * 默认安全防御配置
 */
export const DEFAULT_SAFETY_SETTINGS: SafetySettings = {
  enabled: true,
  threshold: 20,
};

/**
 * 待用户确认的安全熔断拦截快照信息
 */
export interface PendingSafetyConfirmation {
  emptyAction?: 'push' | 'pull' | 'restore';
  scope?: import('../../bookmark/sync-scope').SyncScope;
  affectedScope?: import('../../bookmark/sync-scope').SyncScope;
  backupPath?: string;
  context?: string;
  target?: string;
  id: string;
  timestamp: number;
  deletedCount: number;
  totalBefore: number;
  deletePercentage: number;
  threshold: number;
}

/**
 * 获取防误删安全配置
 */
export async function getSafetySettings(): Promise<SafetySettings> {
  try {
    const result = await browser.storage.local.get(SAFETY_SETTINGS_KEY);
    const saved = result[SAFETY_SETTINGS_KEY] as Partial<SafetySettings> | undefined;
    if (!saved) return { ...DEFAULT_SAFETY_SETTINGS };

    const enabled = typeof saved.enabled === "boolean" ? saved.enabled : DEFAULT_SAFETY_SETTINGS.enabled;
    const rawThreshold = typeof saved.threshold === "number" ? saved.threshold : DEFAULT_SAFETY_SETTINGS.threshold;
    // 边界值保护：限制阈值范围在 10% ~ 50%
    const threshold = Math.max(10, Math.min(50, Math.round(rawThreshold)));

    return { enabled, threshold };
  } catch (error) {
    console.error("[SafetyGuard] Failed to get safety settings:", error);
    return { ...DEFAULT_SAFETY_SETTINGS };
  }
}

/**
 * 保存防误删安全配置
 */
export async function saveSafetySettings(settings: Partial<SafetySettings>): Promise<void> {
  try {
    const current = await getSafetySettings();
    const updated: SafetySettings = {
      enabled: typeof settings.enabled === "boolean" ? settings.enabled : current.enabled,
      threshold:
        typeof settings.threshold === "number"
          ? Math.max(10, Math.min(50, Math.round(settings.threshold)))
          : current.threshold,
    };
    await browser.storage.local.set({ [SAFETY_SETTINGS_KEY]: updated });
    console.log("[SafetyGuard] Safety settings updated:", updated);
  } catch (error) {
    console.error("[SafetyGuard] Failed to save safety settings:", error);
  }
}

/**
 * 获取当前待确认的安全熔断拦截状态
 */
export async function getPendingSafetyConfirmation(): Promise<PendingSafetyConfirmation | null> {
  try {
    const result = await browser.storage.local.get(PENDING_SAFETY_CONFIRMATION_KEY);
    return (result[PENDING_SAFETY_CONFIRMATION_KEY] as PendingSafetyConfirmation | undefined) || null;
  } catch (error) {
    console.error("[SafetyGuard] Failed to get pending safety confirmation:", error);
    return null;
  }
}

/**
 * 设置待确认的安全熔断拦截状态
 */
export async function setPendingSafetyConfirmation(
  confirmation: PendingSafetyConfirmation
): Promise<void> {
  try {
    await browser.storage.local.set({
      [PENDING_SAFETY_CONFIRMATION_KEY]: confirmation,
    });
    console.warn("[SafetyGuard] Safety confirmation recorded:", confirmation);
  } catch (error) {
    console.error("[SafetyGuard] Failed to set pending safety confirmation:", error);
  }
}

/**
 * 清除待确认的安全熔断拦截状态
 */
export async function clearPendingSafetyConfirmation(): Promise<void> {
  try {
    await browser.storage.local.remove(PENDING_SAFETY_CONFIRMATION_KEY);
    console.log("[SafetyGuard] Safety confirmation cleared");
  } catch (error) {
    console.error("[SafetyGuard] Failed to clear pending safety confirmation:", error);
  }
}

export interface SafetyCheckParams {
  context?: string;
  target?: string;
  confirmationId?: string;
  /** 本次检测删除的书签总数 */
  deletedCount: number;
  /** 变动前的基准书签总数 */
  totalBefore: number;
  /** 是否跳过安全检查（用户已在界面二次确认） */
  skipSafetyGuard?: boolean;
}

export interface SafetyCheckResult {
  allowed: boolean;
  reason?: string;
  confirmation?: PendingSafetyConfirmation;
}

/**
 * 评估是否触发防误删熔断保护
 *
 * 判定标准：
 * 1. enabled 为 false 时直接放行
 * 2. skipSafetyGuard 仅在 caller 同时提供 context 与 confirmationId，
 *    且与 pending 记录完全匹配时放行（fail-closed：缺任一条件都重新评估）
 * 3. 基准总数有效且 deletedCount > 10，同时删除比例达到设定的阈值（默认 20%）
 * 4. 触发熔断时自动记录 pending_safety_confirmation
 */
export async function evaluateSafetyBreaker(params: SafetyCheckParams): Promise<SafetyCheckResult> {
  const pending = params.skipSafetyGuard ? await getPendingSafetyConfirmation() : null;
  if (params.skipSafetyGuard && params.context !== undefined && params.confirmationId !== undefined &&
      !pending?.emptyAction && pending?.context === params.context && pending?.id === params.confirmationId) {
    return { allowed: true };
  }

  const settings = await getSafetySettings();
  if (!settings.enabled) {
    return { allowed: true };
  }

  const { deletedCount, totalBefore } = params;
  if (totalBefore <= 0 || deletedCount <= 0) {
    return { allowed: true };
  }

  // 计算删除比例（保留一位小数）
  const deletePercentage = Math.round((deletedCount / totalBefore) * 1000) / 10;

  // 触发条件：单次删除超过 10 条且占比达到或超过安全阈值
  if (deletedCount > 10 && deletePercentage >= settings.threshold) {
    const confirmation: PendingSafetyConfirmation = {
      id: crypto.randomUUID(),
      context: params.context,
      target: params.target,
      timestamp: Date.now(),
      deletedCount,
      totalBefore,
      deletePercentage,
      threshold: settings.threshold,
    };

    await setPendingSafetyConfirmation(confirmation);

    return {
      allowed: false,
      reason: `触发防误删保护：检测到删除了 ${deletedCount} 个书签（占比 ${deletePercentage}%），已达到或超过设定的 ${settings.threshold}% 阈值`,
      confirmation,
    };
  }

  return { allowed: true };
}
