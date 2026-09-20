export interface BookmarkMetadata {
  timestamp: number; // 精确时间戳（毫秒）
  clientVersion: string; // 扩展版本号
  deviceId?: string; // 产生该备份的设备标识（设备标识功能）
  deviceName?: string; // 设备名称（用户可设置备注，如「客厅电脑」）
}

export interface BookmarkNode {
  id?: string; // 浏览器原生 ID（仅本地/系统文件夹使用，云端数据可能没有）
  hash?: string; // 内容哈希（用于跨浏览器同步）= sha256(url + "|" + title)
  parentId?: string;
  index?: number;
  url?: string;
  title: string;
  dateAdded?: number;
  dateGroupModified?: number;
  children?: BookmarkNode[];
  folderType?: string;
}

export interface CloudBackup {
  metadata: BookmarkMetadata;
  data: BookmarkNode[];
  /** 仅由云端解码器校验后赋值；线上格式使用非数组 data，旧版必须停止读取。 */
  emptySync?: import('./core/bookmark/sync-scope').SyncScope;
}

export interface SyncHistoryItem {
  timestamp: number;
  type: "push" | "pull";
  status: "success" | "failed";
  message?: string;
  count?: number;
  browser?: string;
}
