/**
 * WebDAV 存储驱动提供者 (WebDAVStorageProvider)
 * 实现 IStorageProvider 契约，将底层 WebDAVClient 适配到统一存储层
 */
import type { ConnectionTestResult, IStorageProvider, RemoteFileInfo } from '../../core/storage/provider-interface'
import type { WebDAVConfig } from '../../core/storage/types'
import { getWebDAVClient, type IWebDAVClient } from '../http/webdav-client'

export class WebDAVStorageProvider implements IStorageProvider {
  readonly type = 'webdav' as const
  async assertAccess(): Promise<void> { await this.client.assertAccess?.() }
  private client: IWebDAVClient

  constructor(configOrClient: WebDAVConfig | IWebDAVClient) {
    if (configOrClient && typeof (configOrClient as IWebDAVClient).getFile === 'function') {
      this.client = configOrClient as IWebDAVClient
    } else {
      this.client = getWebDAVClient(configOrClient as WebDAVConfig)
    }
  }

  /**
   * 测试 WebDAV 连通性
   */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const ok = await this.client.testConnection()
      return { ok }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  }

  /**
   * 下载文件内容
   */
  async getFile(path: string, signal?: AbortSignal): Promise<string> {
    return this.client.getFile(path, signal)
  }

  /**
   * 上传文件内容
   */
  async putFile(path: string, content: string): Promise<void> {
    return this.client.putFile(path, content)
  }

  /**
   * 创建远程目录
   */
  async createDirectory(path: string): Promise<void> {
    return this.client.createDirectory(path)
  }

  /**
   * 检查远程文件或目录是否存在
   */
  async exists(path: string): Promise<boolean> {
    return this.client.exists(path)
  }

  /**
   * 列出远程目录文件
   */
  async listFiles(dirPath: string): Promise<RemoteFileInfo[]> {
    return this.client.listFiles(dirPath)
  }

  /**
   * 删除远程文件
   */
  async deleteFile(path: string): Promise<void> {
    return this.client.deleteFile(path)
  }

  /**
   * 获取底层原始客户端
   */
  getClient(): IWebDAVClient {
    return this.client
  }
}
