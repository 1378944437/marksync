/**
 * 存储提供者工厂 (StorageProviderFactory)
 * 统一实例化与管理存储提供者，支持 WebDAV 与 GitHub Gist 动态调度
 */
import type { IStorageProvider } from '../../core/storage/provider-interface'
import type { GistConfig, StorageConfig, WebDAVConfig } from '../../core/storage/types'
import { WebDAVStorageProvider } from './webdav-provider'
import { GistStorageProvider } from './gist-provider'

export interface StorageOptions {
  type?: 'webdav' | 'gist'
  webdavConfig?: WebDAVConfig
  gistConfig?: GistConfig
}

/**
 * 创建存储驱动提供者
 */
export function createStorageProvider(
  config: StorageConfig | StorageOptions
): IStorageProvider {
  if ('type' in config && config.type && config.type !== 'webdav' && config.type !== 'gist') {
    throw new Error('[StorageProviderFactory] 不支持的存储驱动类型')
  }
  // 1. 具备 token 的 Gist 配置
  if ('token' in config && config.token) {
    return new GistStorageProvider(config as GistConfig)
  }

  // 2. 具备 url 与 username 的 WebDAV 配置
  if ('url' in config && 'username' in config) {
    return new WebDAVStorageProvider(config as WebDAVConfig)
  }

  const options = config as StorageOptions
  if (options.type === 'gist' && options.gistConfig) {
    return new GistStorageProvider(options.gistConfig)
  }
  if (options.gistConfig?.token) {
    return new GistStorageProvider(options.gistConfig)
  }
  if (options.webdavConfig) {
    return new WebDAVStorageProvider(options.webdavConfig)
  }

  throw new Error('[StorageProviderFactory] 未提供有效的存储驱动配置')
}
