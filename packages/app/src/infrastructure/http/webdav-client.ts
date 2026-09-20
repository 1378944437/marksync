/**
 * WebDAV HTTP 客户端（单例模式）
 * 纯 HTTP 协议操作，不包含业务逻辑
 */
import type { WebDAVConfig } from "../../core/storage/types";
import { parseDavList } from "./webdav-xml-parser";
import { requireHostPermission } from '../browser/host-permissions';

export interface WebDAVFile {
  name: string;
  path: string;
  lastModified: number;
  size: number;
}

/** 日志脱敏：剥离 URL 中可能内嵌的 Basic 凭证（user:pass@host），解析失败时原样返回 */
function redactUrlCredentials(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = "";
      parsed.password = "";
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * WebDAV 客户端接口
 */
export interface IWebDAVClient {
  assertAccess?(): Promise<void>;
  testConnection(): Promise<boolean>;
  putFile(path: string, content: string): Promise<void>;
  getFile(path: string, signal?: AbortSignal): Promise<string>;
  createDirectory(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  listFiles(dirPath: string): Promise<WebDAVFile[]>;
  deleteFile(path: string): Promise<void>;
}

/**
 * WebDAV 客户端类（支持单例缓存）
 */
export class WebDAVClient implements IWebDAVClient {
  /** 常规请求超时（毫秒） */
  private static readonly REQUEST_TIMEOUT_MS = 30_000;

  /** 上传请求超时（毫秒）：大书签集的压缩备份可能较慢 */
  private static readonly UPLOAD_TIMEOUT_MS = 120_000;

  private readonly config: WebDAVConfig;

  constructor(config: WebDAVConfig) {
    this.config = config;
  }

  async assertAccess(): Promise<void> { await requireHostPermission(this.config.url, this.config); }

  /**
   * 基础认证头（所有请求共用）
   * 不再包含 Content-Type，由各请求方法按需设置
   */
  private getAuthHeaders() {
    // 使用 TextEncoder 处理非 ASCII 字符（如中文用户名/密码）
    const credentials = `${this.config.username}:${this.config.password}`;
    const auth = btoa(
      Array.from(new TextEncoder().encode(credentials), (b) => String.fromCharCode(b)).join("")
    );
    return {
      Authorization: `Basic ${auth}`,
    };
  }

  private normalizeUrl(path: string): string {
    const baseUrl = this.config.url.endsWith("/") ? this.config.url : `${this.config.url}/`;
    const cleanPath = path.startsWith("/") ? path.slice(1) : path;
    // 内部路径统一为「已解码」形态（本地生成与 listFiles 返回一致），
    // 上送前按路径段编码，防止文件名中的 #/?/%/空格改变 URL 语义。
    const encodedPath = cleanPath.split("/").map(encodeURIComponent).join("/");
    return `${baseUrl}${encodedPath}`;
  }

  /**
   * 带超时的 fetch：防止挂起的服务器让同步无限期占锁。
   * 外部 signal（如下载队列超时）与内部超时任一触发都会中止请求
   */
  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    await requireHostPermission(url, this.config);
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    // 原生超时信号持续覆盖响应体读取，不在收到响应头时提前解除。
    return fetch(url, { ...init, signal, redirect: 'error' });
  }

  async testConnection(): Promise<boolean> {
    const response = await this.fetchWithTimeout(this.normalizeUrl(""), {
      method: "PROPFIND",
      headers: {
        ...this.getAuthHeaders(),
        Depth: "0",
        Connection: "close",
      },
      credentials: "omit",
    }, WebDAVClient.REQUEST_TIMEOUT_MS);
    return response.ok || response.status === 207;
  }

  async putFile(path: string, content: string): Promise<void> {
    const response = await this.fetchWithTimeout(this.normalizeUrl(path), {
      method: "PUT",
      headers: {
        ...this.getAuthHeaders(),
        "Content-Type": "application/octet-stream",
        Connection: "close",
      },
      body: content,
      credentials: "omit",
    }, WebDAVClient.UPLOAD_TIMEOUT_MS);

    if (!response.ok) {
      throw new Error(
        `Failed to upload file: ${response.status} ${response.statusText}`
      );
    }
  }

  async getFile(path: string, signal?: AbortSignal): Promise<string> {
    const fullUrl = this.normalizeUrl(path);
    const fileName = path.split("/").pop() || path;
    console.log(`[WebDAV] Getting file: ${fileName}`);

    // 直接下载，不重试 409（409 说明有并发问题，应该在上层解决）
    const response = await this.fetchWithTimeout(fullUrl, {
      method: "GET",
      headers: {
        ...this.getAuthHeaders(),
        Connection: "close",
        // 添加缓存控制，确保不使用缓存
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
      },
      credentials: "omit",
      // 强制不使用缓存
      cache: "no-store",
      signal,
    }, WebDAVClient.REQUEST_TIMEOUT_MS);

    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`[WebDAV] File not found: ${path}`);
        throw new Error(`文件不存在: ${path}`);
      }

      if (response.status === 401 || response.status === 403) {
        console.error(`[WebDAV] Authentication/permission error for: ${path}`);
        throw new Error(`认证失败: ${path}`);
      }

      if (response.status === 409) {
        // 获取响应体查看详细错误信息
        const errorBody = await response.text().catch(() => "");
        console.error(
          `[WebDAV] ❌ CONFLICT (409) on GET request!`,
          `\n  File: ${fileName}`,
          `\n  URL: ${redactUrlCredentials(fullUrl)}`,
          `\n  Response: ${errorBody.substring(0, 200)}`
        );
        throw new Error(`文件访问冲突，请稍后再试 (409)`);
      }

      throw new Error(
        `Failed to download file: ${response.status} ${response.statusText}`
      );
    }

    const content = await response.text();
    console.log(`[WebDAV] ✓ Successfully retrieved ${fileName} (${content.length} bytes)`);
    return content;
  }

  async createDirectory(path: string): Promise<void> {
    const response = await this.fetchWithTimeout(this.normalizeUrl(path), {
      method: "MKCOL",
      headers: {
        ...this.getAuthHeaders(),
        Connection: "close",
      },
      credentials: "omit",
    }, WebDAVClient.REQUEST_TIMEOUT_MS);

    if (!response.ok && response.status !== 405) {
      throw new Error(
        `Failed to create directory: ${response.status} ${response.statusText}`
      );
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(this.normalizeUrl(path), {
        method: "PROPFIND",
        headers: {
          ...this.getAuthHeaders(),
          Depth: "0",
          Connection: "close",
        },
        credentials: "omit",
      }, WebDAVClient.REQUEST_TIMEOUT_MS);
      if (response.status === 404) return false;
      if (!response.ok && response.status !== 207) throw new Error(`WebDAV 目录检查失败: HTTP ${response.status}`);
      return response.ok || response.status === 207;
    } catch (error) {
      throw error;
    }
  }

  async listFiles(dirPath: string): Promise<WebDAVFile[]> {
    try {
      const response = await this.fetchWithTimeout(this.normalizeUrl(dirPath), {
        method: "PROPFIND",
        headers: {
          ...this.getAuthHeaders(),
          Depth: "1",
          Connection: "close",
        },
        credentials: "omit",
      }, WebDAVClient.REQUEST_TIMEOUT_MS);

      if (response.status === 401 || response.status === 403) {
        console.warn("[WebDAV] Authentication/permission failed when listing files");
        // 必须抛错：UI 才能提示"认证失败"，而不是误显示为 0
        throw new Error("WebDAV 认证失败（用户名/密码或权限不正确）");
      }

      if (response.status === 404) {
        console.log("[WebDAV] Directory not found, returning empty list");
        return [];
      }

      if (!response.ok && response.status !== 207) {
        // 5xx 等服务端错误必须抛错：
        // 否则返回空数组会被上层缓存为“有效的空备份列表”，误导 UI 和自动拉取
        console.error(
          `[WebDAV] Failed to list files: ${response.status} ${response.statusText}`
        );
        throw new Error(`WebDAV 列出文件失败（${response.status}）`);
      }

      const xml = await response.text();
      // 解析委托给独立模块（DOMParser 优先，异常回退正则；见 webdav-xml-parser）
      // baseUrlPath 同样保持「已解码」形态，与解析器返回的 path 前缀比较一致
      let baseUrlPath = new URL(this.config.url).pathname.replace(/\/+$/, "");
      try { baseUrlPath = decodeURIComponent(baseUrlPath); } catch { /* 保留原始形态 */ }
      const files = parseDavList(xml, baseUrlPath);

      console.log(`[WebDAV] Listed ${files.length} files from ${dirPath}`);
      if (files.length > 0) {
        console.log(
          `[WebDAV] Sample file - name: ${files[0].name}, path: ${files[0].path}`
        );
      }

      return files;
    } catch (error) {
      console.error("[WebDAV] Failed to list files:", error);
      throw error; // 向上传播错误，不再静默吞掉
    }
  }

  async deleteFile(path: string): Promise<void> {
    const response = await this.fetchWithTimeout(this.normalizeUrl(path), {
      method: "DELETE",
      headers: {
        ...this.getAuthHeaders(),
        Connection: "close",
      },
      credentials: "omit",
    }, WebDAVClient.REQUEST_TIMEOUT_MS);

    if (!response.ok && response.status !== 404) {
      throw new Error(
        `Failed to delete file: ${response.status} ${response.statusText}`
      );
    }
  }
}

/**
 * 获取 WebDAV 客户端
 * @param config WebDAV 配置
 * @returns WebDAV 客户端实例（每次创建新实例，避免连接复用导致的 409 冲突）
 */
export function getWebDAVClient(config: WebDAVConfig): WebDAVClient {
  console.log(`[WebDAVClient] Creating fresh client instance for ${redactUrlCredentials(config.url)}`);
  return new WebDAVClient(config);
}
