import type { BookmarkNode } from "../../types";
import { annotateSystemFolders, CHROMIUM_ROOT_ID_TO_FOLDER_TYPE } from "./normalizer";
import { FIREFOX_ID_TO_FOLDER_TYPE } from "./types";

type TreeSignature = [string, string, TreeSignature[]];

export function signatureRoots(nodes: BookmarkNode[]): BookmarkNode[] {
  const roots = nodes.map(node => ({ ...node,
    ...(node.children ? { children: node.children.map(child => ({ ...child })) } : {}),
  }));
  const container = roots.length === 1 && !roots[0].url && !!roots[0].children &&
    (roots[0].id === "0" || roots[0].id === "root________" || (!roots[0].id && roots[0].title === ""));
  const topLevel = container ? roots[0].children! : roots;
  annotateSystemFolders([{ title: "", children: topLevel }]);
  // Firefox's menu is local-only and is not restored by cloud synchronization.
  return topLevel.filter(node => node.id !== "menu________");
}

/** Canonical structure: browser IDs/titles are ignored only for system roots. */
export function treeSignature(nodes: BookmarkNode[]): string {
  const encode = (node: BookmarkNode): TreeSignature => node.url
    ? ["B", node.hash!, []]
    : ["F", node.title.trim(), (node.children ?? []).map(encode)];

  const systemRoots: TreeSignature[] = [];
  const ordinaryRoots: TreeSignature[] = [];
  for (const node of nodes) {
    const type = !node.url && (node.folderType || (node.id &&
      (FIREFOX_ID_TO_FOLDER_TYPE[node.id] || CHROMIUM_ROOT_ID_TO_FOLDER_TYPE[node.id])));
    if (type) {
      // Browsers may omit unused empty system roots; they contain no edits to sync.
      if (node.children?.length) systemRoots.push(["S", type, node.children.map(encode)]);
    } else {
      ordinaryRoots.push(encode(node));
    }
  }
  systemRoots.sort((a, b) => a[1].localeCompare(b[1]));
  return JSON.stringify([systemRoots, ordinaryRoots]);
}
