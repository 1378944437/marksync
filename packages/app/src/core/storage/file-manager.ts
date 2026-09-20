/**
 * 文件管理器
 * 负责备份文件的命名、解析、查询和清理
 */
import type { IStorageProvider, RemoteFileInfo } from "./provider-interface";
import type { BackupFileMetadata, CloudBackupFile, WebDAVFile } from "./types";
import { STORAGE_CONSTANTS } from "./types";

/**
 * 抽象文件客户端（兼容 IStorageProvider 及 IWebDAVClient）
 */
export type StorageClient = IStorageProvider | {
  listFiles: (dirPath: string) => Promise<RemoteFileInfo[] | WebDAVFile[]>;
  deleteFile?: (path: string) => Promise<void>;
};

/**
 * 安全地将设备名称转换为 URL 安全的 Base64 标识（支持中文字符）
 */
function encodeDeviceNameSlug(name?: string): string {
  if (!name || !name.trim()) return "";
  try {
    const bytes = new TextEncoder().encode(name.trim().slice(0, 15));
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  } catch {
    return "";
  }
}

/**
 * 将 URL 安全的 Base64 标识还原为设备名称
 */
function decodeDeviceNameSlug(slug?: string): string | undefined {
  if (!slug || !slug.trim()) return undefined;
  try {
    let base64 = slug.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) base64 += "=";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const decoded = new TextDecoder().decode(bytes).trim();
    return decoded || undefined;
  } catch {
    return undefined;
  }
}

/**
 * 文件管理器类
 * 提供文件操作的高级封装
 */
export class FileManager {
  private readonly backupDir: string;

  constructor(backupDir: string = STORAGE_CONSTANTS.BACKUP_DIR) {
    this.backupDir = backupDir;
  }

  /**
   * 生成带时间戳和修订号的备份文件名
   * 格式：bookmarks_YYYYMMDD_HHMMSS_browser_count_vN.json
   */

  /**
   * 生成备份文件名
   * 格式：bookmarks_YYYYMMDD_HHMMSS_browser_count[_d-deviceTag][_n-deviceName]_vX.json
   */
  generateBackupFileName(
    browser: string,
    count: number,
    revisionNumber: number = 1,
    deviceTag?: string,
    deviceName?: string
  ): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");

    // 浏览器名称转为小写并移除空格
    const browserSlug = browser.toLowerCase().replace(/\s+/g, "");
    const deviceSegment = deviceTag ? `_d-${deviceTag}` : "";
    const nameSlug = encodeDeviceNameSlug(deviceName);
    const nameSegment = nameSlug ? `_n-${nameSlug}` : "";

    return `bookmarks_${year}${month}${day}_${hours}${minutes}${seconds}_${browserSlug}_${count}${deviceSegment}${nameSegment}_v${revisionNumber}.json`;
  }

  /**
   * 解析备份文件名，提取元数据
   * 格式：bookmarks_20260127_143052_edge_157_d-xxx_n-yyy_v3.json.gz
   *
   * @param fileName 文件名
   * @returns 解析结果，如果无法解析则返回 null
   */
  parseBackupFileName(fileName: string): BackupFileMetadata | null {
    // 移除加密与压缩扩展名（.json.gz.enc → .json.gz）
    const cleanFileName = fileName.replace(/\.enc$/, "").replace(/\.gz$/, "");

    // 解析格式: bookmarks_20260127_143052_edge_157_v3.json（_d-xxx 设备段、_n-xxx 名称段可选）
    const match = cleanFileName.match(
      /^bookmarks_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_([a-z]+)_(\d+)(?:_d-([a-z0-9]+))?(?:_n-([a-zA-Z0-9_-]+))?_v(\d+)\.json$/
    );

    if (!match) {
      return null;
    }

    const [, year, month, day, hours, minutes, seconds, browser, count, device, nameSlug, revision] = match;
    const timestamp = new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hours),
      parseInt(minutes),
      parseInt(seconds)
    ).getTime();

    return {
      timestamp,
      browser,
      count: parseInt(count),
      revisionNumber: parseInt(revision),
      deviceTag: device || undefined,
      deviceName: decodeDeviceNameSlug(nameSlug),
    };
  }

  /**
   * 判断是否为备份文件
   * @param fileName 文件名
   * @returns 是否为备份文件
   */
  isBackupFile(fileName: string): boolean {
    return (
      fileName.startsWith("bookmarks_") &&
      (fileName.endsWith(".json.gz") || fileName.endsWith(".json.gz.enc"))
    );
  }

  /**
   * 获取完整的文件路径
   * @param fileName 文件名
   * @returns 完整路径
   */
  getFullPath(fileName: string): string {
    return `${this.backupDir}/${fileName}`;
  }

  /**
   * 列出所有备份文件
   * @param client 存储客户端（IStorageProvider 或 IWebDAVClient）
   * @returns 备份文件列表
   */
  async listBackupFiles(client: StorageClient): Promise<(RemoteFileInfo | WebDAVFile)[]> {
    const files = await client.listFiles(this.backupDir);
    return files.filter((file) => this.isBackupFile(file.name));
  }

  /**
   * 获取最新的备份文件
   * @param client 存储客户端
   * @returns 最新备份文件的路径与服务器修改时间，如果没有则返回 null
   */
  async getLatestBackupFile(
    client: StorageClient
  ): Promise<{ path: string; lastModified: number } | null> {
    try {
      const backupFiles = await this.listBackupFiles(client);

      if (backupFiles.length === 0) {
        console.log("[FileManager] No backup files found");
        return null;
      }
      if (backupFiles.length > 1 && backupFiles.every(file => file.order === 0)) throw new Error('Gist 历史备份顺序未确定，请在存储设置中选择当前版本');

      // 按最后修改时间排序，获取最新的
      backupFiles.sort((a, b) => (b.order ?? b.lastModified) - (a.order ?? a.lastModified));
      const latest = backupFiles[0];

      console.log(
        `[FileManager] Found latest backup: ${latest.name} (${new Date(latest.lastModified).toISOString()})`
      );

      return { path: latest.path, lastModified: latest.lastModified };
    } catch (error) {
      console.error("[FileManager] Failed to get latest backup file:", error);
      throw error;
    }
  }

  /**
   * 将远程存储文件转换为云端备份文件信息
   * @param file 远程文件信息
   * @returns 云端备份文件信息
   */
  toCloudBackupFile(file: RemoteFileInfo | WebDAVFile): CloudBackupFile {
    const metadata = this.parseBackupFileName(file.name);

    return {
      name: file.name,
      path: file.path,
      // 优先用服务器 lastModified（epoch，跨时区可比），文件名时间戳仅作兑底
      timestamp: file.lastModified || metadata?.timestamp || 0,
      totalCount: metadata?.count,
      browser: metadata?.browser,
      browserVersion: undefined, // 文件名中不包含版本信息
      deviceTag: metadata?.deviceTag,
      deviceName: metadata?.deviceName,
    };
  }

  /**
   * 清理多余的旧备份文件（双轨防空法则：至少保留 minToKeep 份，最多保留 maxToKeep 份）
   * @param client 存储客户端
   * @param optionsOrDays 配置选项或保留天数（兼容数字参数）
   * @returns 删除的文件数量
   */
  async cleanOldBackups(
    client: StorageClient,
    optionsOrDays?: number | { minToKeep?: number; maxToKeep?: number; daysToKeep?: number }
  ): Promise<number> {
    try {
      const backupFiles = await this.listBackupFiles(client);
      if (backupFiles.some(file => file.order === 0)) return 0; // 未接管的历史文件禁止自动删除。
      if (backupFiles.length === 0) {
        return 0;
      }

      const opts =
        typeof optionsOrDays === "number"
          ? { daysToKeep: optionsOrDays }
          : optionsOrDays || {};

      const minToKeep = opts.minToKeep ?? STORAGE_CONSTANTS.DEFAULT_MIN_BACKUPS_TO_KEEP;
      const maxToKeep = opts.maxToKeep ?? STORAGE_CONSTANTS.DEFAULT_MAX_BACKUPS_TO_KEEP;
      const daysToKeep = opts.daysToKeep ?? 30;

      // 备份总数未达保底份数，严禁清理
      if (backupFiles.length <= minToKeep) {
        return 0;
      }

      // 按服务器修改时间倒序排列（最新的排在最前）
      backupFiles.sort((a, b) => (b.order ?? b.lastModified) - (a.order ?? a.lastModified));

      const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
      const filesToDelete: WebDAVFile[] = [];

      // 前 minToKeep 份受到绝对保护，永不删除；只对超出保底的旧文件进行清理判断
      for (let i = minToKeep; i < backupFiles.length; i++) {
        const file = backupFiles[i];
        if (i >= maxToKeep || file.lastModified < cutoffTime) {
          filesToDelete.push(file);
        }
      }

      if (filesToDelete.length === 0) {
        return 0;
      }

      console.log(
        `[FileManager] Cleaning ${filesToDelete.length} old backups (keeping min ${minToKeep}, max ${maxToKeep})`
      );

      let deletedCount = 0;
      if (!client.deleteFile) throw new Error('此存储不支持清理备份');
      for (const file of filesToDelete) {
        await client.deleteFile(file.path);
        deletedCount++;
      }

      return deletedCount;
    } catch (error) {
      console.error("[FileManager] Failed to clean old backups:", error);
      throw error;
    }
  }
}

/**
 * 默认导出单例实例
 */
export const fileManager = new FileManager();
