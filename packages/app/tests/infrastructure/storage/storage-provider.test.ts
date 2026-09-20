import { describe, expect, it, vi } from 'vitest'
import { WebDAVStorageProvider } from '@src/infrastructure/storage/webdav-provider'
import { createStorageProvider } from '@src/infrastructure/storage/provider-factory'

describe('WebDAVStorageProvider 契约适配测试', () => {
  const mockConfig = {
    url: 'https://dav.example.com',
    username: 'test_user',
    password: 'test_password',
  }

  it('成功初始化并声明驱动类型为 webdav', () => {
    const provider = new WebDAVStorageProvider(mockConfig)
    expect(provider.type).toBe('webdav')
  })

  it('testConnection 成功时输出 { ok: true }', async () => {
    const provider = new WebDAVStorageProvider(mockConfig)
    const client = provider.getClient()
    vi.spyOn(client, 'testConnection').mockResolvedValue(true)

    const res = await provider.testConnection()
    expect(res).toEqual({ ok: true })
  })

  it('testConnection 遇到网络错误时捕获异常并返回 { ok: false, message }', async () => {
    const provider = new WebDAVStorageProvider(mockConfig)
    const client = provider.getClient()
    vi.spyOn(client, 'testConnection').mockRejectedValue(new Error('网络超时 504'))

    const res = await provider.testConnection()
    expect(res.ok).toBe(false)
    expect(res.message).toBe('网络超时 504')
  })

  it('透传读写与文件列表等原子调用', async () => {
    const provider = new WebDAVStorageProvider(mockConfig)
    const client = provider.getClient()
    const getSpy = vi.spyOn(client, 'getFile').mockResolvedValue('{"test":1}')
    const putSpy = vi.spyOn(client, 'putFile').mockResolvedValue(undefined)
    const listSpy = vi.spyOn(client, 'listFiles').mockResolvedValue([
      { name: 'backup1.json', path: '/MarkSync/backup1.json', lastModified: 1000, size: 50 },
    ])
    const delSpy = vi.spyOn(client, 'deleteFile').mockResolvedValue(undefined)

    const content = await provider.getFile('/MarkSync/backup1.json')
    expect(content).toBe('{"test":1}')
    expect(getSpy).toHaveBeenCalledWith('/MarkSync/backup1.json', undefined)

    await provider.putFile('/MarkSync/backup2.json', '{"test":2}')
    expect(putSpy).toHaveBeenCalledWith('/MarkSync/backup2.json', '{"test":2}')

    const files = await provider.listFiles('/MarkSync')
    expect(files.length).toBe(1)
    expect(listSpy).toHaveBeenCalledWith('/MarkSync')

    await provider.deleteFile?.('/MarkSync/backup1.json')
    expect(delSpy).toHaveBeenCalledWith('/MarkSync/backup1.json')
  })
})

describe('createStorageProvider 工厂模式测试', () => {
  it('rejects unsupported drivers instead of falling back to WebDAV', () => {
    expect(() => createStorageProvider({ type: 'github', webdavConfig: {
      url: 'https://dav.example.com', username: 'u', password: 'p',
    } } as any)).toThrow('不支持');
  });
  it('直接传入 WebDAVConfig 能正确解析并创建 WebDAVStorageProvider', () => {
    const provider = createStorageProvider({
      url: 'https://dav.example.com',
      username: 'user',
      password: 'pwd',
    })
    expect(provider.type).toBe('webdav')
  })

  it('传入 StorageOptions 能正确创建 Provider', () => {
    const provider = createStorageProvider({
      type: 'webdav',
      webdavConfig: {
        url: 'https://dav.example.com',
        username: 'user',
        password: 'pwd',
      },
    })
    expect(provider.type).toBe('webdav')
  })

  it('传入无效配置抛出结构化错误', () => {
    expect(() => {
      // @ts-expect-error 测试无效入参
      createStorageProvider({})
    }).toThrowError('[StorageProviderFactory] 未提供有效的存储驱动配置')
  })
})
