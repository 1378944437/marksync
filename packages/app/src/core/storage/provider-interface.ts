/**
 * 云端存储提供者抽象契约 (IStorageProvider)
 * 隔离底层传输协议（WebDAV / GitHub Gist / GitHub Repo），提供纯净的领域契约
 */

export type StorageProviderType = 'webdav' | 'gist';

/**
 * 远程文件元信息
 */
export interface RemoteFileInfo {
  name: string;
  path: string;
  lastModified: number;
  size?: number;
  /** 明确的版本顺序；0 表示尚未确定的历史文件。 */
  order?: number;
}

/**
 * 连通性测试结果
 */
export interface ConnectionTestResult {
  ok: boolean;
  message?: string;
}

/**
 * 统一存储提供者契约接口
 * 负责与远程云端存储（WebDAV/Gist/Repo）进行原子读写操作
 */
export interface IStorageProvider {
  /** 提供者驱动类型标识 */
  readonly type: StorageProviderType;

  /** 有外部访问限制的驱动在返回缓存前也须检查；不执行网络请求。 */
  assertAccess?(): Promise<void>;

  /** 测试连接与鉴权是否有效 */
  testConnection(): Promise<ConnectionTestResult>;

  /** 下载并获取文本文件内容 */
  getFile(path: string, signal?: AbortSignal): Promise<string>;

  /** 上传/覆盖文本文件内容 */
  putFile(path: string, content: string): Promise<void>;

  /** 创建远程目录（如支持） */
  createDirectory?(path: string): Promise<void>;

  /** 检查远程文件或目录是否存在 */
  exists?(path: string): Promise<boolean>;

  /** 列出指定目录下的所有文件 */
  listFiles(dirPath: string): Promise<RemoteFileInfo[]>;

  /** 删除指定的远程文件 */
  deleteFile?(path: string): Promise<void>;
  /** 显式取消未提交迁移：必要时恢复原当前版本，并删除内容已核对的候选文件。 */
  rollbackBackup?(path: string, previousPath: string | null, expectedContent: string): Promise<void>;
  /** 经用户选择后接管旧备份；仅具有版本索引的存储提供。 */
  adoptBackup?(path: string): Promise<void>;
  /** 用户明确清空云端时使用；不会删除非备份文件。 */
  clearBackups?(): Promise<number>;
}
