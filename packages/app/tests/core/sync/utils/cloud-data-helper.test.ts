/**
 * cloud-data-helper.ts 测试
 * metadata 与正文一样按不可信输入校验：类型、长度受限；正文结构红线与 hash 重算不变
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getFile: vi.fn() }));
vi.mock("@src/core/storage/queue-manager", () => ({
  queueManager: { getFileWithDedup: (...args: any[]) => mocks.getFile(...args) },
}));

import { fetchValidatedCloudBackup } from "@src/core/sync/utils/cloud-data-helper";
import { CloudDataError } from "@src/core/sync/types";

const TREE = [
  {
    id: "0",
    title: "",
    children: [
      {
        id: "1",
        title: "Bookmarks Bar",
        folderType: "bookmarks-bar",
        children: [{ title: "Example", url: "https://example.com" }],
      },
    ],
  },
];

const backup = (metadata: unknown) => JSON.stringify({ metadata, data: TREE });

beforeEach(() => {
  mocks.getFile.mockReset();
});

describe("fetchValidatedCloudBackup - metadata 校验", () => {
  it("合法 metadata 通过，正文 hash 重算", async () => {
    mocks.getFile.mockResolvedValueOnce(
      backup({ timestamp: 123, clientVersion: "2.0.0-hash", deviceId: "dev-1", deviceName: "Chrome" }),
    );
    const data = await fetchValidatedCloudBackup({} as any, "MarkSync/a.json.gz");
    expect(data?.metadata.deviceId).toBe("dev-1");
    expect(data?.data[0].children[0].children[0].hash).toBeTruthy();
  });

  it("metadata 缺失时放行（兼容旧数据）", async () => {
    mocks.getFile.mockResolvedValueOnce(JSON.stringify({ data: TREE }));
    await expect(fetchValidatedCloudBackup({} as any, "p")).resolves.toBeTruthy();
  });

  it("metadata 非对象时抛出 CloudDataError", async () => {
    mocks.getFile.mockResolvedValueOnce(backup("not-an-object"));
    await expect(fetchValidatedCloudBackup({} as any, "p")).rejects.toThrow(CloudDataError);
  });

  it("字段类型错误（timestamp 非数字）抛出 CloudDataError", async () => {
    mocks.getFile.mockResolvedValueOnce(backup({ timestamp: "123" }));
    await expect(fetchValidatedCloudBackup({} as any, "p")).rejects.toThrow(CloudDataError);
  });

  it("字符串字段超过 128 字符时抛出 CloudDataError", async () => {
    mocks.getFile.mockResolvedValueOnce(backup({ deviceName: "x".repeat(129) }));
    await expect(fetchValidatedCloudBackup({} as any, "p")).rejects.toThrow(CloudDataError);
  });

  it("正文结构无效仍然抛出 CloudDataError（红线不变）", async () => {
    mocks.getFile.mockResolvedValueOnce(JSON.stringify({ metadata: {}, data: "not-a-tree" }));
    await expect(fetchValidatedCloudBackup({} as any, "p")).rejects.toThrow(CloudDataError);
  });
});
