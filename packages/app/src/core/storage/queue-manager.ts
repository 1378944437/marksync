import type { IWebDAVClient } from '../../infrastructure/http/webdav-client';
import type { IStorageProvider } from './provider-interface';
import { decryptText, E2EPasswordRequiredError } from '../../infrastructure/utils/crypto';
import { decompressText } from '../../infrastructure/utils/compression';
import { STORAGE_CONSTANTS } from './types';

/** 仅对同一客户端的原始下载去重；解密独立执行，密码不同的请求不能共享明文。 */
export class QueueManager {
  private ids = new WeakMap<object, number>();
  private nextId = 0;
  private downloads = new Map<string, { path: string; promise: Promise<string>; controller: AbortController }>();
  constructor(private readonly timeoutMs: number = STORAGE_CONSTANTS.DOWNLOAD_TIMEOUT_MS) {}
  async getFileWithDedup(client: IStorageProvider | IWebDAVClient, path: string, opts?: { passphrase?: string }): Promise<string> {
    let id = this.ids.get(client);
    if (!id) { id = ++this.nextId; this.ids.set(client, id); }
    const key = `${id}:${path}`;
    let entry = this.downloads.get(key);
    if (!entry) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<string>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error(`下载超时 (${this.timeoutMs / 1000}秒)`)); }, this.timeoutMs);
      });
      const promise = Promise.race([client.getFile(path, controller.signal), timeout]).finally(() => {
        clearTimeout(timer);
        if (this.downloads.get(key)?.promise === promise) this.downloads.delete(key);
      });
      entry = { path, promise, controller };
      this.downloads.set(key, entry);
    }
    let raw = await entry.promise;
    if (path.endsWith('.enc')) {
      if (!opts?.passphrase) throw new E2EPasswordRequiredError('此备份已启用端到端加密，请输入对应密码');
      raw = await decryptText(raw, opts.passphrase);
    }
    if (!path.replace(/\.enc$/, '').endsWith('.gz')) throw new Error('不支持的文件格式（必须是 .gz 压缩文件）');
    try { return await decompressText(raw); }
    catch (error) {
      // 保留原始原因：大小超限（红线）与 gzip 损坏的处置和提示不同，不能合并成一句话
      const reason = (error as Error)?.message || '未知错误';
      throw new Error(`解压备份文件失败：${reason}`);
    }
  }
  clearAll(): void {
    for (const entry of this.downloads.values()) entry.controller.abort();
    this.downloads.clear();
  }
  getQueueSize(): number { return this.downloads.size; }
  isDownloading(path: string): boolean { return [...this.downloads.values()].some(entry => entry.path === path); }
  getDownloadingFiles(): string[] { return [...this.downloads.values()].map(entry => entry.path); }
}
export const queueManager = new QueueManager();
