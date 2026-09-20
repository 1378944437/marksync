/**
 * file-manager.ts 测试
 * 测试文件名生成、解析、识别功能
 */
import { FileManager } from "@src/core/storage/file-manager";
import { describe, expect, it, vi } from "vitest";

const fm = new FileManager();

describe("FileManager - generateBackupFileName", () => {
  it("生成正确格式的文件名", () => {
    const name = fm.generateBackupFileName("Edge", 157, 1);
    // 格式: bookmarks_YYYYMMDD_HHMMSS_edge_157_v1.json
    expect(name).toMatch(
      /^bookmarks_\d{8}_\d{6}_edge_157_v1\.json$/
    );
  });

  it("浏览器名称转为小写并去除空格", () => {
    const name = fm.generateBackupFileName("Microsoft Edge", 100, 2);
    expect(name).toMatch(/_microsoftedge_100_v2\.json$/);
  });

  it("默认修订号为 1", () => {
    const name = fm.generateBackupFileName("Chrome", 200);
    expect(name).toMatch(/_v1\.json$/);
  });

  it("修订号大于 1 时正确写入", () => {
    const name = fm.generateBackupFileName("Firefox", 50, 5);
    expect(name).toMatch(/_firefox_50_v5\.json$/);
  });
});

describe("FileManager - parseBackupFileName", () => {
  it("正确解析标准文件名", () => {
    const result = fm.parseBackupFileName(
      "bookmarks_20260127_143052_edge_157_v1.json"
    );
    expect(result).not.toBeNull();
    expect(result!.browser).toBe("edge");
    expect(result!.count).toBe(157);
    expect(result!.revisionNumber).toBe(1);
    expect(result!.timestamp).toBeGreaterThan(0);
  });

  it("正确解析带 .gz 扩展名的文件名", () => {
    const result = fm.parseBackupFileName(
      "bookmarks_20260127_143052_edge_157_v3.json.gz"
    );
    expect(result).not.toBeNull();
    expect(result!.browser).toBe("edge");
    expect(result!.count).toBe(157);
    expect(result!.revisionNumber).toBe(3);
  });

  it("正确解析时间戳", () => {
    const result = fm.parseBackupFileName(
      "bookmarks_20260127_143052_chrome_200_v1.json"
    );
    expect(result).not.toBeNull();
    // 2026-01-27 14:30:52
    const date = new Date(result!.timestamp);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(0); // January = 0
    expect(date.getDate()).toBe(27);
    expect(date.getHours()).toBe(14);
    expect(date.getMinutes()).toBe(30);
    expect(date.getSeconds()).toBe(52);
  });

  it("不匹配格式返回 null", () => {
    expect(fm.parseBackupFileName("random_file.json")).toBeNull();
    expect(fm.parseBackupFileName("bookmarks.json")).toBeNull();
    expect(fm.parseBackupFileName("")).toBeNull();
    expect(fm.parseBackupFileName("bookmarks_invalid.json")).toBeNull();
  });
});

describe("FileManager - isBackupFile", () => {
  it("识别正确的 .json.gz 备份文件", () => {
    expect(
      fm.isBackupFile("bookmarks_20260127_143052_edge_157_v1.json.gz")
    ).toBe(true);
  });

  it("不匹配的文件名返回 false", () => {
    expect(fm.isBackupFile("bookmarks_20260127.json")).toBe(false);
    expect(fm.isBackupFile("readme.txt")).toBe(false);
    expect(fm.isBackupFile("bookmarks_.json.gz")).toBe(true); // starts with bookmarks_ and ends with .json.gz
  });

  it("没有 .gz 扩展名返回 false", () => {
    expect(
      fm.isBackupFile("bookmarks_20260127_143052_edge_157_v1.json")
    ).toBe(false);
  });
});

describe("FileManager - 设备标识与自定义名称扩展", () => {
  it("生成携带设备标签与自定义设备名称的文件名", () => {
    const name = fm.generateBackupFileName("Chrome", 120, 1, "a1b2c3d4", "客厅电脑");
    expect(name).toMatch(/_chrome_120_d-a1b2c3d4_n-[a-zA-Z0-9_-]+_v1\.json$/);
  });

  it("正确解析携带设备标签与自定义中文设备名称的文件名", () => {
    const generated = fm.generateBackupFileName("Edge", 88, 2, "mydevtag", "工作笔记本");
    const parsed = fm.parseBackupFileName(generated);

    expect(parsed).not.toBeNull();
    expect(parsed!.browser).toBe("edge");
    expect(parsed!.count).toBe(88);
    expect(parsed!.revisionNumber).toBe(2);
    expect(parsed!.deviceTag).toBe("mydevtag");
    expect(parsed!.deviceName).toBe("工作笔记本");
  });

  it("正确解析未携带设备名称的旧版本文件名并向下兼容", () => {
    const parsed = fm.parseBackupFileName("bookmarks_20260127_143052_edge_157_d-olddev_v1.json.gz");
    expect(parsed).not.toBeNull();
    expect(parsed!.deviceTag).toBe("olddev");
    expect(parsed!.deviceName).toBeUndefined();
  });
});

describe("FileManager - cleanOldBackups 双轨安全清理", () => {
  it('propagates listing failures rather than reporting zero deleted files', async () => {
    await expect(fm.cleanOldBackups({ listFiles: async () => { throw new Error('offline'); } })).rejects.toThrow('offline');
  });

  it('stops cleanup after the first deletion failure and keeps the newest files', async () => {
    const deleteFile = vi.fn().mockRejectedValueOnce(new Error('403'));
    const listFiles = async () => Array.from({ length: 8 }, (_, i) => ({
      name: `bookmarks_${i}.json.gz`, path: `/p${i}`, lastModified: i + 1,
    }));
    await expect(fm.cleanOldBackups({ listFiles, deleteFile }, { minToKeep: 5, maxToKeep: 5 })).rejects.toThrow('403');
    expect(deleteFile).toHaveBeenCalledExactlyOnceWith('/p2');
  });
  it("文件数不超过保底份数时不执行删除", async () => {
    const mockClient = {
      listFiles: async () => [
        { name: "bookmarks_20260101_120000_edge_10_v1.json.gz", path: "/p1", lastModified: 1000 },
        { name: "bookmarks_20260102_120000_edge_10_v1.json.gz", path: "/p2", lastModified: 2000 },
      ],
      deleteFile: async () => {},
    } as any;

    const deleted = await fm.cleanOldBackups(mockClient, { minToKeep: 5, maxToKeep: 10, daysToKeep: 1 });
    expect(deleted).toBe(0);
  });

  it("超出总份数上限时安全删除多余的最旧备份", async () => {
    const deletedPaths: string[] = [];
    const now = Date.now();
    const files = Array.from({ length: 12 }, (_, i) => ({
      name: `bookmarks_20260101_1200${i.toString().padStart(2, "0")}_edge_10_v1.json.gz`,
      path: `/p${i}`,
      lastModified: now + (i + 1) * 1000, // p0 最旧，p11 最新
    }));

    const mockClient = {
      listFiles: async () => files,
      deleteFile: async (path: string) => {
        deletedPaths.push(path);
      },
    } as any;

    const deleted = await fm.cleanOldBackups(mockClient, { minToKeep: 5, maxToKeep: 10, daysToKeep: 999 });
    // 12 个文件，上限 10 个，应删除最旧的 2 个（p0, p1）
    expect(deleted).toBe(2);
    expect(deletedPaths).toContain("/p0");
    expect(deletedPaths).toContain("/p1");
  });
});
