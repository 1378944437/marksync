/**
 * WebDAV PROPFIND 响应解析
 * 自 webdav-client 拆出：DOMParser 优先（按 localName 解析，忽略命名空间前缀），
 * 解析异常时回退正则匹配，兼容 d:/D:/无前缀等多种服务端返回
 */

export interface DavListEntry {
  name: string;
  path: string;
  lastModified: number;
  size: number;
}

/**
 * 从 href 提取「已解码」路径。
 * 先按 URL 解析出 pathname（绝对地址与相对路径均可，顺带剥离查询串），再解码；
 * href 含非法 % 序列时保留原始形态——单个异常条目不允许击穿整个目录列举。
 */
function decodeHrefPath(href: string): string {
  let decoded = href;
  try {
    decoded = new URL(href, "https://webdav.invalid").pathname;
  } catch {
    // URL 解析失败时退回原始 href，继续尝试解码
  }
  if (decoded.includes("%")) {
    try { decoded = decodeURIComponent(decoded); } catch { /* 保留编码形态 */ }
  }
  return decoded;
}

export function parseDavList(xml: string, baseUrlPath: string): DavListEntry[] {
  const files: DavListEntry[] = [];

  // DOMParser 优先（按 localName 解析，忽略命名空间前缀），更健壮
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const parserError = doc.getElementsByTagName("parsererror")[0];
    if (parserError) {
      throw new Error("Invalid XML response");
    }

    const responseEls = Array.from(doc.getElementsByTagNameNS("*", "response"));

    for (const responseEl of responseEls) {
      const hrefEl = responseEl.getElementsByTagNameNS("*", "href")[0];
      const href = hrefEl?.textContent?.trim();
      if (!href) continue;

      const resourceTypeEl = responseEl.getElementsByTagNameNS("*", "resourcetype")[0];
      const isCollection = !!resourceTypeEl?.getElementsByTagNameNS("*", "collection")[0];
      if (isCollection) continue;

      let decodedHref = decodeHrefPath(href);

      // 移除 base path 前缀，避免重复
      if (decodedHref.startsWith(baseUrlPath + "/")) {
        decodedHref = decodedHref.substring((baseUrlPath + "/").length);
      } else if (decodedHref === baseUrlPath) {
        decodedHref = "";
      }

      // 移除前导斜杠
      decodedHref = decodedHref.replace(/^\/+/, "");

      const name = decodedHref.split("/").filter(Boolean).pop() || "";

      const lastModifiedEl = responseEl.getElementsByTagNameNS("*", "getlastmodified")[0];
      const lastModifiedStr = lastModifiedEl?.textContent?.trim() || "";
      const lastModified = lastModifiedStr ? (new Date(lastModifiedStr).getTime() || 0) : 0;

      const sizeEl = responseEl.getElementsByTagNameNS("*", "getcontentlength")[0];
      const sizeStr = sizeEl?.textContent?.trim() || "0";
      const size = parseInt(sizeStr, 10) || 0;

      if (!name || !decodedHref) continue;

      files.push({
        name,
        path: decodedHref,
        lastModified,
        size,
      });
    }
  } catch (error) {
    console.warn("[WebDAV] DOMParser failed, falling back to regex parser:", error);

    // 兼容可选前缀（例如 d:/D:）以及无前缀（默认命名空间）
    const responseRegex = /<(?:\w+:)?response[^>]*>([\s\S]*?)<\/(?:\w+:)?response>/gi;
    const responses = [...xml.matchAll(responseRegex)];

    for (const m of responses) {
      const responseBlock = m[1];

      const hrefMatch = responseBlock.match(/<(?:\w+:)?href[^>]*>(.*?)<\/(?:\w+:)?href>/i);
      if (!hrefMatch) continue;

      const isCollection = /<(?:\w+:)?collection\s*\/>/i.test(responseBlock);
      if (isCollection) continue;

      let decodedHref = decodeHrefPath(hrefMatch[1].trim());

      if (decodedHref.startsWith(baseUrlPath + "/")) {
        decodedHref = decodedHref.substring((baseUrlPath + "/").length);
      } else if (decodedHref === baseUrlPath) {
        decodedHref = "";
      }

      decodedHref = decodedHref.replace(/^\/+/, "");
      const name = decodedHref.split("/").filter(Boolean).pop() || "";

      const lastModifiedMatch = responseBlock.match(/<(?:\w+:)?getlastmodified[^>]*>(.*?)<\/(?:\w+:)?getlastmodified>/i);
      const lastModifiedStr = lastModifiedMatch ? lastModifiedMatch[1].trim() : "";
      const lastModified = lastModifiedStr ? (new Date(lastModifiedStr).getTime() || 0) : 0;

      const sizeMatch = responseBlock.match(/<(?:\w+:)?getcontentlength[^>]*>(.*?)<\/(?:\w+:)?getcontentlength>/i);
      const sizeStr = sizeMatch ? sizeMatch[1].trim() : "0";
      const size = parseInt(sizeStr, 10) || 0;

      if (!name || !decodedHref) continue;

      files.push({
        name,
        path: decodedHref,
        lastModified,
        size,
      });
    }
  }

  return files;
}
