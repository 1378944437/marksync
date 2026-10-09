/**
 * comparator.ts 测试
 * 测试书签树统计和签名提取逻辑
 */
import { compareWithCloud, computeTreeHash, countBookmarks, extractSignaturesWithHash } from "@src/core/bookmark/comparator";
import type { BookmarkNode } from "@src/types";
import { describe, expect, it, vi } from "vitest";

// Mock hash-calculator 和 normalizer 中被 comparator 间接引用的函数
vi.mock("@src/core/bookmark/hash-calculator", () => ({
  assignHashes: vi.fn(async (nodes: BookmarkNode[]) => nodes),
}));

vi.mock("@src/core/bookmark/normalizer", () => ({
  annotateSystemFolders: vi.fn((nodes: BookmarkNode[]) => nodes),
  CHROMIUM_ROOT_ID_TO_FOLDER_TYPE: { "1": "bookmarks-bar", "2": "other", "3": "mobile" },
  isSystemRootFolder: vi.fn((node: BookmarkNode) => {
    // 模拟系统根文件夹判断
    return node.id === "0" && !node.title;
  }),
  normalizeUrl: vi.fn((url: string) => url),
}));

describe("countBookmarks", () => {
  it("正确统计扁平结构的书签数量", () => {
    const nodes: BookmarkNode[] = [
      { title: "A", url: "https://a.com" },
      { title: "B", url: "https://b.com" },
      { title: "C", url: "https://c.com" },
    ];
    expect(countBookmarks(nodes)).toBe(3);
  });

  it("正确统计嵌套树的书签数量", () => {
    const nodes: BookmarkNode[] = [
      {
        title: "Folder",
        children: [
          { title: "A", url: "https://a.com" },
          {
            title: "Sub Folder",
            children: [
              { title: "B", url: "https://b.com" },
              { title: "C", url: "https://c.com" },
            ],
          },
        ],
      },
      { title: "D", url: "https://d.com" },
    ];
    expect(countBookmarks(nodes)).toBe(4);
  });

  it("空数组返回 0", () => {
    expect(countBookmarks([])).toBe(0);
  });

  it("只有文件夹没有书签返回 0", () => {
    const nodes: BookmarkNode[] = [
      { title: "Folder", children: [] },
      {
        title: "Another Folder",
        children: [{ title: "Sub Folder", children: [] }],
      },
    ];
    expect(countBookmarks(nodes)).toBe(0);
  });
});

describe("extractSignaturesWithHash", () => {
  it("提取书签签名 (B|hash 格式)", () => {
    const nodes: BookmarkNode[] = [
      { title: "A", url: "https://a.com", hash: "hash_a" },
      { title: "B", url: "https://b.com", hash: "hash_b" },
    ];
    const sigs = extractSignaturesWithHash(nodes);
    expect(sigs).toContain("B|hash_a");
    expect(sigs).toContain("B|hash_b");
  });

  it("提取文件夹签名 (F|title|childCount 格式)", () => {
    const nodes: BookmarkNode[] = [
      {
        title: "My Folder",
        children: [
          { title: "A", url: "https://a.com", hash: "hash_a" },
          { title: "B", url: "https://b.com", hash: "hash_b" },
        ],
      },
    ];
    const sigs = extractSignaturesWithHash(nodes);
    expect(sigs).toContain("F|My Folder|2");
    expect(sigs).toContain("B|hash_a");
    expect(sigs).toContain("B|hash_b");
  });

  it("跳过系统根文件夹", () => {
    const nodes: BookmarkNode[] = [
      {
        id: "0",
        title: "",
        children: [
          { title: "A", url: "https://a.com", hash: "hash_a" },
        ],
      },
    ];
    const sigs = extractSignaturesWithHash(nodes);
    // 系统根文件夹本身不产生签名，但它的子节点会被提取
    expect(sigs).not.toContain("F||1");
    expect(sigs).toContain("B|hash_a");
  });

  it("空数组返回空签名", () => {
    expect(extractSignaturesWithHash([])).toEqual([]);
  });
});

describe("computeTreeHash", () => {
  it("同一棵树两次计算结果一致", async () => {
    const nodes: BookmarkNode[] = [
      { title: "F", children: [{ title: "A", url: "https://a.com", hash: "h1" }] },
    ];
    expect(await computeTreeHash(nodes)).toBe(await computeTreeHash(nodes));
  });

  it("书签改名会改变哈希", async () => {
    const before: BookmarkNode[] = [
      { title: "F", children: [{ title: "A", url: "https://a.com", hash: "h1" }] },
    ];
    const after: BookmarkNode[] = [
      { title: "F", children: [{ title: "A2", url: "https://a.com", hash: "h2" }] },
    ];
    expect(await computeTreeHash(before)).not.toBe(await computeTreeHash(after));
  });

  it("书签增删会改变哈希", async () => {
    const before: BookmarkNode[] = [
      { title: "F", children: [{ title: "A", url: "https://a.com", hash: "h1" }] },
    ];
    const after: BookmarkNode[] = [
      { title: "F", children: [{ title: "A", url: "https://a.com", hash: "h1" }, { title: "B", url: "https://b.com", hash: "h2" }] },
    ];
    expect(await computeTreeHash(before)).not.toBe(await computeTreeHash(after));
  });

  it("顺序重排改变哈希", async () => {
    const a: BookmarkNode[] = [
      { title: "F", children: [
        { title: "A", url: "https://a.com", hash: "h1" },
        { title: "B", url: "https://b.com", hash: "h2" },
      ] },
    ];
    const b: BookmarkNode[] = [
      { title: "F", children: [
        { title: "B", url: "https://b.com", hash: "h2" },
        { title: "A", url: "https://a.com", hash: "h1" },
      ] },
    ];
    expect(await computeTreeHash(a)).not.toBe(await computeTreeHash(b));
  });

  it("书签在文件夹间移动改变哈希", async () => {
    const before: BookmarkNode[] = [
      { title: "F1", children: [{ title: "A", url: "https://a.com", hash: "h1" }] },
      { title: "F2", children: [] },
    ];
    const after: BookmarkNode[] = [
      { title: "F1", children: [] },
      { title: "F2", children: [{ title: "A", url: "https://a.com", hash: "h1" }] },
    ];
    expect(await computeTreeHash(before)).not.toBe(await computeTreeHash(after));
  });

  it("空文件夹改名改变哈希", async () => {
    const before: BookmarkNode[] = [{ title: "F", children: [] }];
    const after: BookmarkNode[] = [{ title: "G", children: [] }];
    expect(await computeTreeHash(before)).not.toBe(await computeTreeHash(after));
  });
});

describe("compareWithCloud（结构口径）", () => {
  const node = (title: string, url: string, hash: string): BookmarkNode => ({
    title,
    url,
    hash,
  });

  it("相同书签、不同顺序/不同文件夹排布 → 不一致", async () => {
    const local: BookmarkNode[] = [
      {
        id: "1",
        title: "Bar",
        folderType: "bookmarks-bar",
        children: [node("A", "https://a.com", "h1"), node("B", "https://b.com", "h2")],
      },
    ];
    const cloud: BookmarkNode[] = [
      {
        id: "2",
        title: "Other",
        folderType: "other",
        children: [node("B", "https://b.com", "h2"), node("A", "https://a.com", "h1")],
      },
    ];
    expect(await compareWithCloud(local, cloud)).toBe(false);
  });

  it("云端多一条书签 → 不一致", async () => {
    const local: BookmarkNode[] = [node("A", "https://a.com", "h1")];
    const cloud: BookmarkNode[] = [
      node("A", "https://a.com", "h1"),
      node("B", "https://b.com", "h2"),
    ];
    expect(await compareWithCloud(local, cloud)).toBe(false);
  });

  it("同 URL 不同标题（hash 不同）→ 不一致", async () => {
    const local: BookmarkNode[] = [node("A", "https://a.com", "h1")];
    const cloud: BookmarkNode[] = [node("A2", "https://a.com", "h2")];
    expect(await compareWithCloud(local, cloud)).toBe(false);
  });

  it("重复次数不同（本地 A×1、云端 A×2）→ 不一致", async () => {
    const local: BookmarkNode[] = [node("A", "https://a.com", "h1")];
    const cloud: BookmarkNode[] = [
      node("A", "https://a.com", "h1"),
      node("A2", "https://a.com", "h1"),
    ];
    expect(await compareWithCloud(local, cloud)).toBe(false);
  });
});
