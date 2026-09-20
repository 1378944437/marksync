/**
 * webdav-xml-parser.ts 测试
 * href 解析容错：URL 编码解码、绝对地址只解码一次、非法 % 序列不击穿列表
 */
import { parseDavList } from "@src/infrastructure/http/webdav-xml-parser";
import { describe, expect, it } from "vitest";

const BASE = "/remote.php/dav/files/user";

function entryXml(href: string, opts?: { collection?: boolean; lastmod?: string; size?: string }): string {
  return `  <d:response>
    <d:href>${href}</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype>${opts?.collection ? "<d:collection/>" : ""}</d:resourcetype>
        <d:getlastmodified>${opts?.lastmod ?? "Mon, 27 Jan 2026 14:30:52 GMT"}</d:getlastmodified>
        <d:getcontentlength>${opts?.size ?? "4096"}</d:getcontentlength>
      </d:prop>
    </d:propstat>
  </d:response>`;
}

function multistatus(entries: string[]): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
${entries.join("\n")}
</d:multistatus>`;
}

describe("parseDavList - href 容错", () => {
  it("URL 编码的 href 解码为已解码路径", () => {
    const xml = multistatus([entryXml(`${BASE}/MarkSync/bookmarks%20name%20v1.json.gz`)]);
    const files = parseDavList(xml, BASE);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("MarkSync/bookmarks name v1.json.gz");
    expect(files[0].name).toBe("bookmarks name v1.json.gz");
  });

  it("绝对 URL href 只解码一次，不把编码序列重新引入路径", () => {
    const xml = multistatus([entryXml(`https://dav.example.com${BASE}/MarkSync/foo%20bar.json.gz`)]);
    const files = parseDavList(xml, BASE);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("MarkSync/foo bar.json.gz");
  });

  it("剥离 href 查询串", () => {
    const xml = multistatus([entryXml(`${BASE}/MarkSync/a.json.gz?op=GETCONTENT`)]);
    const files = parseDavList(xml, BASE);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("MarkSync/a.json.gz");
  });

  it("含非法 % 序列的 href 不击穿整个列表，其余条目正常解析", () => {
    const xml = multistatus([
      entryXml(`${BASE}/MarkSync/bad%zzentry.json.gz`),
      entryXml(`${BASE}/MarkSync/good.json.gz`, { lastmod: "Wed, 28 Jan 2026 10:00:00 GMT" }),
    ]);
    const files = parseDavList(xml, BASE);
    const good = files.find((f) => f.name === "good.json.gz");
    expect(good).toBeDefined();
    expect(good?.lastModified).toBe(new Date("Wed, 28 Jan 2026 10:00:00 GMT").getTime());
    // 异常条目保留原始形态，仍然可见（不会被静默丢失）
    expect(files.find((f) => f.name.includes("bad"))).toBeDefined();
  });
});
