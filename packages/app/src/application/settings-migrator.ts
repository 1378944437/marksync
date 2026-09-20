/**
 * 配置导出与导入迁移服务
 * 支持将完整扩展设置打包导出为便携格式，并在其他设备一键解析还原
 */
import browser from "webextension-polyfill";
import { validateSettings } from "./settings-validation";
import { assertNoRecovery } from "../core/sync/recovery";
import { requireHostPermission } from '../infrastructure/browser/host-permissions';

export const MIGRATION_SCHEMA_VERSION = "1.0";
export const MIGRATION_PREFIX = "marksync://config/v1/";

export interface ExportableSettings {
  storage_type?: "webdav" | "gist";
  gist_token?: string;
  gist_id?: string;
  gist_endpoint?: string;
  webdav_url?: string;
  webdav_username?: string;
  webdav_password?: string;
  sync_scope?: Record<string, boolean>;
  max_local_snapshots?: number;
  max_cloud_backups?: number;
  backup_file_interval?: number;
  auto_sync_enabled?: boolean;
  scheduled_sync_enabled?: boolean;
  scheduled_sync_interval?: number;
  sync_safety_settings?: { enabled: boolean; threshold: number };
  e2e_enabled?: boolean;
  e2e_passphrase?: string;
  app_language?: string;
  device_name?: string;
}

export interface MigrationConfigPayload {
  app: "marksync";
  version: string;
  exportedAt: number;
  settings: ExportableSettings;
}

/**
 * 导出当前配置
 * @param options.includePasswords 是否包含 WebDAV 密码与端到端密钥（默认 false）
 * @returns Base64 编码的配置导入代码
 */
export async function exportSettings(options?: {
  includePasswords?: boolean;
}): Promise<string> {
  const includePasswords = options?.includePasswords ?? false;

  const keysToRead = [
    "storage_type", "gist_token", "gist_id", "gist_endpoint",
    "webdav_url",
    "webdav_username",
    "webdav_password",
    "sync_scope",
    "max_local_snapshots",
    "max_cloud_backups",
    "backup_file_interval",
    "auto_sync_enabled",
    "scheduled_sync_enabled",
    "scheduled_sync_interval",
    "sync_safety_settings",
    "e2e_enabled",
    "e2e_passphrase",
    "app_language",
    "device_name",
  ];

  const all = await browser.storage.local.get(keysToRead);
  const settings: ExportableSettings = {};

  for (const key of keysToRead) {
    if (all[key] !== undefined) {
      // 敏感密码过滤
      if (!includePasswords && (key === "webdav_password" || key === "e2e_passphrase" || key === "gist_token")) {
        continue;
      }
      // @ts-ignore
      settings[key] = all[key];
    }
  }

  const payload: MigrationConfigPayload = {
    app: "marksync",
    version: MIGRATION_SCHEMA_VERSION,
    exportedAt: Date.now(),
    settings,
  };

  const jsonStr = JSON.stringify(payload);
  const encoded = btoa(unescape(encodeURIComponent(jsonStr)));
  return `${MIGRATION_PREFIX}${encoded}`;
}

/**
 * 解析并校验配置代码
 * @param rawInput 字符串代码（支持带前缀或纯 JSON）
 */
export function parseAndValidateSettings(rawInput: string): {
  valid: boolean;
  error?: string;
  payload?: MigrationConfigPayload;
} {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { valid: false, error: "配置代码不能为空" };
  }

  try {
    let jsonStr = "";
    if (trimmed.startsWith(MIGRATION_PREFIX)) {
      const b64 = trimmed.slice(MIGRATION_PREFIX.length).trim();
      jsonStr = decodeURIComponent(escape(atob(b64)));
    } else if (trimmed.startsWith("{")) {
      jsonStr = trimmed;
    } else {
      // 尝试纯 Base64 解码
      jsonStr = decodeURIComponent(escape(atob(trimmed)));
    }

    const parsed = JSON.parse(jsonStr) as Partial<MigrationConfigPayload>;
    if (!parsed || parsed.app !== "marksync" || !parsed.settings) {
      return { valid: false, error: "无效的 MarkSync 配置文件格式" };
    }

    if (parsed.version !== MIGRATION_SCHEMA_VERSION) throw new Error("不支持的配置版本");
    validateSettings(parsed.settings);
    return { valid: true, payload: parsed as MigrationConfigPayload };
  } catch (error) {
    return { valid: false, error: `配置代码解析失败: ${(error as Error).message}` };
  }
}

/**
 * 应用导入的配置至本地
 */
export async function applyMigratedSettings(payload: MigrationConfigPayload): Promise<void> {
  if (!payload?.settings || typeof payload.settings !== "object") {
    throw new Error("无效的设置数据");
  }

  await assertNoRecovery();
  if (payload.version !== MIGRATION_SCHEMA_VERSION) throw new Error("不支持的配置版本");
  validateSettings(payload.settings);
  const toSave: Record<string, unknown> = {};
  const s = payload.settings;
  for (const key of ["storage_type", "gist_token", "gist_id", "gist_endpoint"] as const) if (s[key] !== undefined) toSave[key] = s[key];

  // 严格按白名单应用，防止非法污染
  if (typeof s.webdav_url === "string") toSave.webdav_url = s.webdav_url.trim();
  if (typeof s.webdav_username === "string") toSave.webdav_username = s.webdav_username.trim();
  if (typeof s.webdav_password === "string") toSave.webdav_password = s.webdav_password;
  if (s.sync_scope && typeof s.sync_scope === "object") toSave.sync_scope = s.sync_scope;
  if (typeof s.max_local_snapshots === "number") toSave.max_local_snapshots = Math.max(5, s.max_local_snapshots);
  if (typeof s.max_cloud_backups === "number") toSave.max_cloud_backups = Math.max(5, s.max_cloud_backups);
  if (typeof s.backup_file_interval === "number") toSave.backup_file_interval = s.backup_file_interval;
  if (typeof s.auto_sync_enabled === "boolean") toSave.auto_sync_enabled = s.auto_sync_enabled;
  if (typeof s.scheduled_sync_enabled === "boolean") toSave.scheduled_sync_enabled = s.scheduled_sync_enabled;
  if (typeof s.scheduled_sync_interval === "number") toSave.scheduled_sync_interval = s.scheduled_sync_interval;
  if (s.sync_safety_settings && typeof s.sync_safety_settings === "object") toSave.sync_safety_settings = s.sync_safety_settings;
  if (typeof s.e2e_enabled === "boolean") toSave.e2e_enabled = s.e2e_enabled;
  if (typeof s.e2e_passphrase === "string") toSave.e2e_passphrase = s.e2e_passphrase;
  if (typeof s.app_language === "string") toSave.app_language = s.app_language;
  if (typeof s.device_name === "string") toSave.device_name = s.device_name;

  // 无密码导入不可沿用另一目标的旧凭据，也不可立即启动后台同步。
  if (s.gist_id !== undefined) toSave.gist_token = s.gist_token ?? '';
  if (s.webdav_url !== undefined) toSave.webdav_password = s.webdav_password ?? '';
  if (s.e2e_enabled !== undefined) toSave.e2e_passphrase = s.e2e_passphrase ?? '';
  const incomplete = (s.storage_type === 'gist' && (!s.gist_token || !s.gist_id)) ||
    ((s.storage_type === 'webdav' || s.webdav_url !== undefined) && (!s.webdav_url || !s.webdav_username || !s.webdav_password)) ||
    (s.e2e_enabled && !s.e2e_passphrase);
  if (incomplete) { toSave.auto_sync_enabled = false; toSave.scheduled_sync_enabled = false; }

  // 部分导入按合并后的目标检查；缺权时整次导入不提交。
  const merged = { ...await browser.storage.local.get(['storage_type', 'webdav_url', 'gist_endpoint']), ...toSave };
  const endpoint = merged.storage_type === 'gist' ? String(merged.gist_endpoint || 'https://api.github.com') : String(merged.webdav_url || '');
  if (endpoint) await requireHostPermission(endpoint);
  await browser.storage.local.set(toSave);
  console.log("[SettingsMigrator] Settings applied successfully:", Object.keys(toSave));
}
