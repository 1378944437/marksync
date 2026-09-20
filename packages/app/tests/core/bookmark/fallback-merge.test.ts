/**
 * 缺失文件夹兜底合并回归测试
 * 真实链路（不 mock merger-basic / smart-sync-engine）：
 * 兜底合并进「其他书签」的节点必须登记进 shared.processedLocalIds，
 * 否则同一轮恢复的统一删除阶段会立即把它们删掉。
 */
import { __resetMockStore } from "@src/__mocks__/webextension-polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";

/** 本设备没有 mobile 系统文件夹的真实 Chrome 结构 */
function localTree(): any[] {
  return [
    {
      id: "0",
      title: "",
      children: [
        { id: "1", title: "Bookmarks Bar", parentId: "0", index: 0, children: [] },
        { id: "2", title: "Other Bookmarks", parentId: "0", index: 1, children: [] },
      ],
    },
  ];
}

describe("missingFolderFallback 与统一删除阶段交互", () => {
  beforeEach(() => {
    __resetMockStore();
    vi.clearAllMocks();
  });

  it("兜底合并进其他书签的内容不被同一轮删除阶段清除", async () => {
    const tree = localTree();
    vi.mocked(browser.bookmarks.getTree).mockResolvedValue(tree as any);

    // 云端同时包含 other 与本设备缺失的 mobile（多设备同步的常规形态）
    const backup = {
      metadata: { timestamp: Date.now() },
      data: [
        {
          id: "0",
          title: "",
          children: [
            { id: "1", title: "Bookmarks Bar", children: [] },
            {
              id: "2",
              title: "Other Bookmarks",
              children: [{ title: "Other Site", url: "https://other.example.com" }],
            },
            {
              id: "3",
              title: "Mobile Bookmarks",
              children: [{ title: "Mobile Site", url: "https://m.example.com" }],
            },
          ],
        },
      ],
    };

    let nextId = 100;
    const created: any[] = [];
    vi.mocked(browser.bookmarks.create).mockImplementation(async (opts: any) => {
      const node = {
        id: String(nextId++),
        title: opts.title,
        url: opts.url,
        parentId: opts.parentId,
        index: opts.index,
      };
      created.push(node);
      // 模拟浏览器真实行为：新节点挂进树，getChildren 才能看到
      const findParent = (nodes: any[]): any => {
        for (const n of nodes) {
          if (n.id === opts.parentId) return n;
          const inner = n.children ? findParent(n.children) : null;
          if (inner) return inner;
        }
        return null;
      };
      const parent = findParent(tree);
      if (parent) (parent.children ??= []).push(node);
      return node;
    });
    vi.mocked(browser.bookmarks.getChildren).mockImplementation(async (id: any) => {
      const find = (nodes: any[]): any[] | null => {
        for (const n of nodes) {
          if (n.id === id) return n.children || [];
          const inner = n.children ? find(n.children) : null;
          if (inner) return inner;
        }
        return null;
      };
      return (find(tree) || []) as any;
    });
    vi.mocked(browser.bookmarks.remove).mockResolvedValue(undefined as any);
    vi.mocked(browser.bookmarks.removeTree).mockResolvedValue(undefined as any);
    vi.mocked(browser.bookmarks.move).mockResolvedValue({} as any);
    vi.mocked(browser.bookmarks.update).mockResolvedValue({} as any);

    const { BookmarkRepository } = await import("@src/core/bookmark/repository");
    const repo = new BookmarkRepository();
    await repo.restoreFromBackup(backup as any, { missingFolderFallback: true });

    const mobileSite = created.find((n) => n.title === "Mobile Site");
    expect(mobileSite).toBeDefined();
    expect(mobileSite.parentId).toBe("2");

    // 关键断言：兜底合并进来的节点不被删除阶段移除
    expect(browser.bookmarks.remove).not.toHaveBeenCalledWith(mobileSite.id);
    expect(browser.bookmarks.removeTree).not.toHaveBeenCalledWith(mobileSite.id);
  });
});
