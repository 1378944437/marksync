import { beforeEach, expect, it, vi } from 'vitest';
import browser from 'webextension-polyfill';
import type { BookmarkNode } from '@src/types';
import { BookmarkRepository } from '@src/core/bookmark/repository';
import { assignHashes } from '@src/core/bookmark/hash-calculator';
import { compareWithCloud } from '@src/core/bookmark/comparator';
import { annotateSystemFolders } from '@src/core/bookmark/normalizer';

let local: BookmarkNode[];
const bookmark = (id: string, parentId: string, index: number): BookmarkNode => ({
  id, parentId, index, title: id, url: `https://${id}.example.com`,
});
function find(id: string, nodes = local): BookmarkNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = node.children && find(id, node.children);
    if (found) return found;
  }
}
function reindex(parent: BookmarkNode) {
  parent.children!.forEach((node, index) => { node.index = index; node.parentId = parent.id; });
}
beforeEach(() => {
  vi.resetAllMocks();
  local = [{ id: '0', title: '', children: [{ id: '1', title: 'Bar', children: [
    bookmark('a', '1', 0), bookmark('b', '1', 1), bookmark('c', '1', 2),
  ] }, { id: '2', title: 'Other', children: [] }] }];
  vi.mocked(browser.bookmarks.getTree).mockImplementation(async () => structuredClone(local) as never);
  vi.mocked(browser.bookmarks.getChildren).mockImplementation(async id => structuredClone(find(id)?.children ?? []) as never);
  vi.mocked(browser.bookmarks.move).mockImplementation(async (id, destination) => {
    const node = find(id)!;
    const oldParent = find(node.parentId!)!;
    oldParent.children = oldParent.children!.filter(child => child.id !== id);
    reindex(oldParent);
    const parent = find(destination.parentId ?? oldParent.id!)!;
    parent.children!.splice(destination.index ?? parent.children!.length, 0, node);
    reindex(parent);
    return structuredClone(node) as never;
  });
});

it.each(['abc', 'acb', 'bac', 'bca', 'cab', 'cba'])('restores ordering %s and converges', async order => {
  const cloud = structuredClone(local);
  cloud[0].children![0].children = [...order].map((id, index) => bookmark(id, '1', index));
  await new BookmarkRepository().restoreFromBackup(await assignHashes(annotateSystemFolders(cloud)));
  expect(local[0].children![0].children!.map(node => node.id).join('')).toBe(order);
  expect(await compareWithCloud(local, cloud)).toBe(true);
});

it('restores a move between system roots and converges', async () => {
  const cloud = structuredClone(local);
  cloud[0].children![0].children!.splice(1, 1);
  cloud[0].children![1].children = [bookmark('b', '2', 0)];
  await new BookmarkRepository().restoreFromBackup(await assignHashes(annotateSystemFolders(cloud)));
  expect(await compareWithCloud(local, cloud)).toBe(true);
});
