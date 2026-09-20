/**
 * compression.ts 测试
 * 验证 Issue #8 栈溢出修复：大数据量的 Uint8Array → Base64 转换
 */
import { compressText, decompressText } from "@src/infrastructure/utils/compression";
import { describe, expect, it } from "vitest";

describe("compression", () => {
  it("小数据的压缩/解压 round-trip", async () => {
    const original = JSON.stringify({ bookmarks: [{ title: "Test", url: "https://example.com" }] });
    const compressed = await compressText(original);
    const decompressed = await decompressText(compressed);
    expect(decompressed).toBe(original);
  });

  it("大数据 round-trip（200KB+，验证 Issue #8 栈溢出修复）", async () => {
    // 生成 ~250KB 的 JSON 字符串，模拟大量书签
    const bookmarks = Array.from({ length: 3000 }, (_, i) => ({
      title: `Bookmark ${i} - ${"A".repeat(50)}`,
      url: `https://example-${i}.com/path/to/page?query=value&id=${i}`,
      hash: `hash_${i}_${"x".repeat(20)}`,
    }));
    const largeJson = JSON.stringify({ data: bookmarks });

    // 确保测试数据足够大（200KB+）
    expect(largeJson.length).toBeGreaterThan(200 * 1024);

    // 这一步在修复前会因 String.fromCharCode(...) 超出调用栈而抛出 RangeError
    const compressed = await compressText(largeJson);
    const decompressed = await decompressText(compressed);
    expect(decompressed).toBe(largeJson);
  });

  it("压缩输出是合法的 Base64 字符串", async () => {
    const original = "Hello, World! 你好世界";
    const compressed = await compressText(original);

    // 合法的 Base64 只包含 A-Z, a-z, 0-9, +, /, =
    expect(compressed).toMatch(/^[A-Za-z0-9+/]+=*$/);

    // 可以成功 atob 解码
    expect(() => atob(compressed)).not.toThrow();
  });

  it("解压非法数据时抛错", async () => {
    await expect(decompressText("not-valid-gzip-data")).rejects.toThrow();
  });

  it("空字符串压缩/解压", async () => {
    const compressed = await compressText("");
    const decompressed = await decompressText(compressed);
    expect(decompressed).toBe("");
  });

  it("包含 Unicode 字符的压缩/解压", async () => {
    const original = "中文书签 🔖 émojis ñ Ω ℃";
    const compressed = await compressText(original);
    const decompressed = await decompressText(compressed);
    expect(decompressed).toBe(original);
  });

  it("压缩输入超过 32 MiB 上限时拒绝（停而不截）", async () => {
    const oversized = "A".repeat(32 * 1024 * 1024 + 1);
    await expect(decompressText(oversized)).rejects.toThrow("压缩备份超过 32 MiB");
  });

  it("解压后超过 maxBytes 上限时中止", async () => {
    const compressed = await compressText("B".repeat(1024 * 1024));
    await expect(decompressText(compressed, 1024)).rejects.toThrow("解压备份超过大小限制");
  });

  it("未超限时 maxBytes 参数不影响正常解压", async () => {
    const original = "ok";
    const decompressed = await decompressText(await compressText(original), 64 * 1024 * 1024);
    expect(decompressed).toBe(original);
  });
});
