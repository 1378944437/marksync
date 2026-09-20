/**
 * GitHub Gist HTTP 客户端 (GistClient)
 * 纯 HTTP 协议操作，封装 GitHub REST API v3 (/gists) 的读写、连通性探测与一键建库
 */
import type { GistConfig } from '../../core/storage/types'
import { requireHostPermission } from '../browser/host-permissions'

export interface GistFileDetail {
  filename: string
  size: number
  raw_url: string
  content?: string
  truncated?: boolean
}

export interface GistResponse {
  truncated?: boolean
  html_url?: string
  id: string
  description: string
  public: boolean
  created_at: string
  updated_at: string
  files: Record<string, GistFileDetail>
}

export class GistClient {
  private static readonly TIMEOUT_MS = 30_000
  private readonly token: string
  private readonly gistId: string
  private readonly endpoint: string

  constructor(private readonly config: GistConfig) {
    this.token = config.token.trim()
    this.gistId = (config.gistId || '').trim()
    // 规范化 API 端点，去除末尾斜杠，默认使用 https://api.github.com
    const rawEndpoint = config.endpoint?.trim() || 'https://api.github.com'
    this.endpoint = rawEndpoint.replace(/\/+$/, '')
  }

  async assertAccess(): Promise<void> { await requireHostPermission(this.endpoint, this.config) }

  /**
   * 基础 GitHub API 请求头
   */
  private getHeaders(): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }
  }

  /**
   * 包装超时 fetch
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    customSignal?: AbortSignal
  ): Promise<Response> {
    await requireHostPermission(url, this.config)
    const timeout = AbortSignal.timeout(GistClient.TIMEOUT_MS)
    const signal = customSignal ? AbortSignal.any([customSignal, timeout]) : timeout
    return fetch(url, { ...options, signal, redirect: 'error' })
  }

  /**
   * 测试 Token 有效性与 Gist 访问权限
   */
  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    if (!this.token) {
      return { ok: false, message: '请先填写 GitHub Personal Access Token (PAT)' }
    }

    try {
      // 1. 若配置了 GistId，优先检测目标 Gist
      if (this.gistId) {
        const res = await this.fetchWithTimeout(`${this.endpoint}/gists/${this.gistId}`, {
          method: 'GET',
          headers: this.getHeaders(),
        })

        if (res.ok) return { ok: true }
        if (res.status === 404) return { ok: false, message: `未找到指定的 Gist (${this.gistId})` }
        if (res.status === 401) return { ok: false, message: 'Token 无效或已过期 (401 Unauthorized)' }
        return { ok: false, message: `GitHub API 错误: HTTP ${res.status}` }
      }

      // 2. 未配 GistId 时，检测 Token 是否具备 gist 权限
      const res = await this.fetchWithTimeout(`${this.endpoint}/user`, {
        method: 'GET',
        headers: this.getHeaders(),
      })

      if (res.ok) {
        return { ok: true, message: 'Token 有效，请选择或自动创建私有 Gist' }
      }
      return { ok: false, message: `Token 鉴权失败: HTTP ${res.status}` }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  }

  /**
   * 自动在云端创建全新的私密 Gist
   */
  async createGist(
    description = 'MarkSync Bookmarks Backup (汇签云端同步)',
    isPublic = false
  ): Promise<{ id: string; url: string }> {
    const payload = {
      description,
      public: isPublic,
      files: {
        'README.md': {
          content: '# MarkSync Bookmarks Sync\nThis Gist stores encrypted/compressed bookmarks managed by MarkSync.',
        },
      },
    }

    const res = await this.fetchWithTimeout(`${this.endpoint}/gists`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`创建 Gist 失败 (HTTP ${res.status}): ${errText}`)
    }

    const data = (await res.json()) as GistResponse
    return { id: data.id, url: data.html_url || '' }
  }

  /**
   * 获取当前 Gist 完整详情
   */
  async getGist(signal?: AbortSignal): Promise<GistResponse> {
    if (!this.gistId) {
      throw new Error('未配置 Gist ID，无法执行读取')
    }

    const res = await this.fetchWithTimeout(`${this.endpoint}/gists/${this.gistId}`, {
      method: 'GET',
      headers: this.getHeaders(),
    }, signal)

    if (!res.ok) {
      throw new Error(`读取 Gist 失败 (HTTP ${res.status})`)
    }

    return (await res.json()) as GistResponse
  }

  /**
   * 原子修改 Gist 文件（更新内容或删除文件）
   * @param files 将内容更新为字符串，或赋值为 null 以删除该文件
   */
  async updateGist(files: Record<string, { content: string } | null>): Promise<GistResponse> {
    if (!this.gistId) {
      throw new Error('未配置 Gist ID，无法执行更新')
    }

    const res = await this.fetchWithTimeout(`${this.endpoint}/gists/${this.gistId}`, {
      method: 'PATCH',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ files }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`写入 Gist 失败 (HTTP ${res.status}): ${errText}`)
    }

    return (await res.json()) as GistResponse
  }

  /**
   * 校验 raw_url 的目标域：Token 只允许发往 Gist 静态域与用户配置端点的派生域，
   * 防止被篡改的响应或恶意端点诱导 Token 外发。
   */
  private assertSafeRawUrl(rawUrl: string): void {
    let target: URL
    try { target = new URL(rawUrl) } catch { throw new Error('Raw 文件地址无效') }
    const allowed = new Set(['gist.githubusercontent.com'])
    try {
      const endpointHost = new URL(this.endpoint).host
      allowed.add(endpointHost)
      if (endpointHost === 'api.github.com') allowed.add('raw.githubusercontent.com')
    } catch { /* 端点异常时仅允许官方静态域 */ }
    if (target.protocol !== 'https:' || !allowed.has(target.host)) {
      throw new Error(`Raw 文件地址不在允许的域内，已阻止携带 Token 的请求: ${target.host}`)
    }
  }

  /**
   * 获取截断大文件的原始 Raw 内容
   */
  async fetchRaw(rawUrl: string, signal?: AbortSignal): Promise<string> {
    this.assertSafeRawUrl(rawUrl)
    const res = await this.fetchWithTimeout(rawUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.token}` },
    }, signal)

    if (!res.ok) {
      throw new Error(`下载 Raw 文件失败 (HTTP ${res.status})`)
    }

    return await res.text()
  }
}
