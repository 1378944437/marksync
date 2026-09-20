/**
 * validation.ts 测试
 * 结构红线（深度/数量/停而不截）与 URL 协议白名单
 */
import { validateBookmarkTree, validateRestoreTree } from "@src/core/bookmark/validation";
import { describe, expect, it } from "vitest";

const ROOT = { id: "0", title: "", children: [{ id: "1", title: "Bookmarks Bar", children: [] }] };

describe("validateBookmarkTree - URL 协议白名单", () => {
  it.each(["https://example.com", "http://example.com", "ftp://example.com/a", "ftps://example.com"])(
    "允许网络协议书签 %s",
    (url) => {
      expect(() =>
        validateBookmarkTree([{ ...ROOT, children: [{ id: "1", title: "Bar", children: [{ title: "X", url }] }] }]),
      ).not.toThrow();
    },
  );

  it("拒绝 javascript: 书签（可执行代码不得经恢复写入浏览器）", () => {
    const tree = [{ ...ROOT, children: [{ id: "1", title: "Bar", children: [{ title: "X", url: "javascript:alert(1)" }] }] }];
    expect(() => validateBookmarkTree(tree)).toThrow("备份书签 URL 协议不受支持");
  });

  it("拒绝 data: 书签", () => {
    const tree = [{ ...ROOT, children: [{ id: "1", title: "Bar", children: [{ title: "X", url: "data:text/html,<script>" }] }] }];
    expect(() => validateBookmarkTree(tree)).toThrow("备份书签 URL 协议不受支持");
  });

  it("拒绝 file: 书签", () => {
    const tree = [{ ...ROOT, children: [{ id: "1", title: "Bar", children: [{ title: "X", url: "file:///C:/x.html" }] }] }];
    expect(() => validateBookmarkTree(tree)).toThrow("备份书签 URL 协议不受支持");
  });

  it("协议白名单不影响原有结构校验（格式错误仍拒绝）", () => {
    const tree = [{ ...ROOT, children: [{ id: "1", title: "Bar", children: [{ title: "X", url: "not a url" }] }] }];
    expect(() => validateBookmarkTree(tree)).toThrow("备份书签 URL 无效");
  });
});

describe("validateBookmarkTree - 结构红线（回归保护）", () => {
  it("超深层级拒绝且不截断", () => {
    let node: any = { title: "leaf", url: "https://example.com" };
    for (let i = 0; i <= 101; i++) node = { title: `f${i}`, children: [node] };
    expect(() => validateBookmarkTree([node])).toThrow("层级过深");
  });

  it("restore 校验要求单根容器结构", () => {
    expect(() => validateRestoreTree([])).toThrow("备份数据为空");
    // 结构合法但根下直接是书签（而非系统文件夹容器）→ 根结构无效
    expect(() =>
      validateRestoreTree([{ title: "", children: [{ title: "X", url: "https://example.com" }] }]),
    ).toThrow("备份根结构无效");
  });
});
