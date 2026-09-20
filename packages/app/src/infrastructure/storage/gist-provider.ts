import type { ConnectionTestResult, IStorageProvider, RemoteFileInfo } from '../../core/storage/provider-interface';
import type { GistConfig } from '../../core/storage/types';
import { GistClient, type GistResponse } from './gist-client';
import { INDEX_FILE, isBackupName, readIndex, type GistIndex } from './gist-index';

export class GistStorageProvider implements IStorageProvider {
  readonly type = 'gist' as const;
  async assertAccess(): Promise<void> { await this.client.assertAccess(); }
  private client: GistClient;
  private observedRevision: string | undefined;
  constructor(config: GistConfig) { this.client = new GistClient(config); }
  testConnection(): Promise<ConnectionTestResult> { return this.client.testConnection(); }
  async getFile(path: string, signal?: AbortSignal): Promise<string> {
    const name = path.split('/').pop()!;
    const gist = await this.client.getGist(signal);
    const file = gist.files[name];
    if (!file) throw new Error('Gist 中未找到备份文件');
    if (file.truncated) {
      if (!file.raw_url) throw new Error('Gist 备份被截断且无下载地址');
      return this.client.fetchRaw(file.raw_url, signal);
    }
    if (typeof file.content !== 'string') throw new Error('Gist 备份内容缺失');
    return file.content;
  }
  private baseIndex(gist: GistResponse): GistIndex {
    const index = readIndex(gist);
    if (index) return index;
    const names = Object.keys(gist.files).filter(isBackupName);
    if (names.length > 1) throw new Error('请先在 Gist 设置中选择当前历史版本');
    return { version: 1, revision: '', current: names[0] ?? null,
      entries: names.map(name => ({ name, order: 1, timestamp: Date.parse(gist.updated_at) })) };
  }
  async putFile(path: string, content: string): Promise<void> {
    const name = path.split('/').pop()!;
    if (!isBackupName(name)) throw new Error('只允许写入书签备份');
    const gist = await this.client.getGist();
    const index = this.baseIndex(gist);
    if (this.observedRevision !== undefined && index.revision !== this.observedRevision) throw new Error('Gist 版本已变化，请重新同步');
    if (gist.files[name]) throw new Error('备份文件已存在，请重新生成文件名');
    const next: GistIndex = { ...index, revision: crypto.randomUUID(), current: name,
      entries: [...index.entries, { name, order: Math.max(0, ...index.entries.map(e => e.order)) + 1, timestamp: Date.now() }] };
    // 一次 PATCH 同时发布数据与索引；GitHub 无分布式 CAS，读回发现冲突即停止清理。
    await this.client.updateGist({ [name]: { content }, [INDEX_FILE]: { content: JSON.stringify(next) } });
    const verified = readIndex(await this.client.getGist());
    if (verified?.revision !== next.revision || verified.current !== name) throw new Error('Gist 写入版本未确认，已保留历史备份');
    this.observedRevision = next.revision;
  }
  async createDirectory(): Promise<void> {}
  async exists(path: string): Promise<boolean> {
    const name = path.split('/').pop();
    if (!name || name === 'MarkSync' || name === 'BookmarkSyncer') return true;
    return !!(await this.client.getGist()).files[name];
  }
  async listFiles(dir: string): Promise<RemoteFileInfo[]> {
    const gist = await this.client.getGist();
    const index = readIndex(gist);
    this.observedRevision = index?.revision ?? '';
    return Object.entries(gist.files).filter(([name]) => isBackupName(name)).map(([name, file]) => {
      const entry = index?.entries.find(e => e.name === name);
      return { name, path: `${dir}/${name}`, size: file.size,
        order: index?.current === name ? Number.MAX_SAFE_INTEGER : entry?.legacy ? 0 : entry?.order ?? 0,
        lastModified: entry?.timestamp ?? Date.parse(gist.updated_at) };
    });
  }
  async deleteFile(path: string): Promise<void> {
    const name = path.split('/').pop()!;
    const gist = await this.client.getGist();
    const index = readIndex(gist);
    if (!index || index.current === name) throw new Error('禁止自动删除当前版本或未索引的 Gist 备份');
    if (this.observedRevision !== undefined && index.revision !== this.observedRevision) throw new Error('Gist 版本已变化，停止清理');
    if (index.entries.find(entry => entry.name === name)?.legacy) throw new Error('禁止自动删除顺序未知的历史备份');
    if (!index.entries.some(entry => entry.name === name)) throw new Error('文件不属于备份索引');
    const next = { ...index, revision: crypto.randomUUID(), entries: index.entries.filter(entry => entry.name !== name) };
    await this.client.updateGist({ [name]: null, [INDEX_FILE]: { content: JSON.stringify(next) } });
    if (readIndex(await this.client.getGist())?.revision !== next.revision) throw new Error('Gist 清理版本未确认');
    this.observedRevision = next.revision;
  }
  async adoptBackup(path: string): Promise<void> {
    const name = path.split('/').pop()!;
    const gist = await this.client.getGist();
    if (readIndex(gist)) throw new Error('Gist 已有版本索引，无需接管');
    const names = Object.keys(gist.files).filter(isBackupName);
    if (!names.includes(name)) throw new Error('选定的备份不存在');
    // 历史顺序未知：所有历史条目保留，选定项作为唯一当前版本。
    const index: GistIndex = { version: 1, revision: crypto.randomUUID(), current: name,
      entries: names.map((n, i) => ({ name: n, order: i + 1, timestamp: Date.parse(gist.updated_at), legacy: true })) };
    await this.client.updateGist({ [INDEX_FILE]: { content: JSON.stringify(index) } });
    if (readIndex(await this.client.getGist())?.revision !== index.revision) throw new Error('Gist 接管结果未确认');
  }
  async rollbackBackup(path: string, previousPath: string | null, expectedContent: string): Promise<void> {
    const name = path.split('/').pop()!;
    const previous = previousPath?.split('/').pop() ?? null;
    const gist = await this.client.getGist();
    const index = readIndex(gist);
    if (!gist.files[name]) return;
    if (!index || !index.entries.some(entry => entry.name === name && !entry.legacy)) throw new Error('迁移候选文件不属于受管理版本');
    const file = gist.files[name];
    const content = file.truncated ? await this.client.fetchRaw(file.raw_url) : file.content;
    if (content !== expectedContent) throw new Error('迁移候选文件内容已变化');
    if (index.current === name && (previous === name ||
        (previous ? !index.entries.some(entry => entry.name === previous) : index.entries.length > 1))) {
      throw new Error('无法确认迁移前的当前版本');
    }
    const next: GistIndex = { ...index, revision: crypto.randomUUID(),
      current: index.current === name ? previous : index.current,
      entries: index.entries.filter(entry => entry.name !== name) };
    await this.client.updateGist({ [name]: null, [INDEX_FILE]: { content: JSON.stringify(next) } });
    const verified = await this.client.getGist();
    if (readIndex(verified)?.revision !== next.revision || verified.files[name]) throw new Error('迁移取消结果未确认');
    this.observedRevision = next.revision;
  }
  getClient(): GistClient { return this.client; }
  async clearBackups(): Promise<number> {
    const gist = await this.client.getGist();
    readIndex(gist);
    const names = Object.keys(gist.files).filter(isBackupName);
    const index: GistIndex = { version: 1, revision: crypto.randomUUID(), current: null, entries: [] };
    await this.client.updateGist({ ...Object.fromEntries(names.map(name => [name, null])), [INDEX_FILE]: { content: JSON.stringify(index) } });
    if (readIndex(await this.client.getGist())?.revision !== index.revision) throw new Error('Gist 清空结果未确认');
    return names.length;
  }
}
