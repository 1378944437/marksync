// Real browser bookmark writes. Only disposable profiles and the loopback WebDAV fixture are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');
const snapshots = page => page.evaluate(() => new Promise((resolve, reject) => {
  const opening = indexedDB.open('bookmark-syncer-db');
  opening.onerror = () => reject(opening.error);
  opening.onsuccess = () => {
    const db = opening.result, tx = db.transaction('snapshots', 'readonly');
    const request = tx.objectStore('snapshots').getAll();
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  };
}));
module.exports = async function ({ device, add, send, state, config, holdPut, files, requests,
  until, pass, output, bookmarks, expectSuccess }) {
  fs.mkdirSync(output, { recursive: true });
  let a = await device('empty-sender'), b = await device('empty-receiver');
  const puts = () => requests.filter(r => r.method === 'PUT').length;
  const clearBar = page => page.evaluate(async () => {
    for (const node of await chrome.bookmarks.getChildren('1')) await chrome.bookmarks.removeTree(node.id);
  });
  const push = page => send(page, { type: 'sync:push', config });
  const pull = page => send(page, { type: 'sync:pull', config, mode: 'overwrite' });
  const pending = async page => (await state(page)).pending_safety_confirmation;
  const accept = page => page.getByRole('button', { name: 'Back up and clear local bookmarks', exact: true }).click();
  const publish = page => page.getByRole('button', { name: 'Publish clear request', exact: true }).click();
  await add(a.page, 'one'); await add(a.page, 'sender-private', '2');
  await add(b.page, 'receiver-private', '2');
  expectSuccess(await push(a.page)); expectSuccess(await pull(b.page));
  const originalPath = [...files.keys()][0];
  await clearBar(a.page);
  await a.page.evaluate(() => chrome.storage.local.set({ sync_safety_settings: { enabled: false, threshold: 20 } }));
  assert.equal((await push(a.page)).success, false);
  assert.equal((await pending(a.page)).deletedCount, 1); assert.equal(puts(), 1);
  await a.page.getByRole('button', { name: 'Publish clear request', exact: true }).waitFor();
  await a.page.screenshot({ path: path.join(output, 'sender-confirmation.png'), fullPage: true });
  const held = holdPut(true), senderUrl = a.page.url();
  await publish(a.page); await until(() => !!held.path);
  await a.page.close(); held.release();
  a.page = await a.context.newPage(); await a.page.goto(senderUrl);
  await until(async () => (await state(a.page)).last_background_result?.result.success === true);
  assert.equal(puts(), 2); assert(files.has(originalPath));
  const wire = JSON.parse(gunzipSync(Buffer.from(files.get(held.path).content, 'base64')).toString());
  assert.equal(wire.data.format, 'marksync-empty-v1'); assert(!Array.isArray(wire.data));
  pass('sender-confirms-one-bookmark-with-breaker-disabled-and-history-retained');
  pass('publishing-finishes-in-background-after-fulltab-closes');

  // Real scheduled handler must stop, including the dirty-device auto-merge path.
  await add(b.page, 'unsynced-edit');
  await b.page.evaluate(() => chrome.storage.local.set({ scheduled_sync_enabled: true, scheduled_sync_interval: 1 }));
  console.log('WAIT natural one-minute scheduler: receiver must ask before clearing or merging');
  await until(async () => (await pending(b.page))?.emptyAction === 'pull', 90000);
  await b.page.evaluate(() => chrome.storage.local.set({ scheduled_sync_enabled: false }));
  assert.equal((await bookmarks(b.page)).length, 2); assert.equal(puts(), 2);
  assert.equal((await pending(b.page)).deletedCount, 2);
  await b.page.getByRole('button', { name: 'Back up and clear local bookmarks', exact: true }).waitFor();
  await b.page.screenshot({ path: path.join(output, 'receiver-confirmation.png'), fullPage: true });
  pass('natural-scheduled-pull-blocks-dirty-device-merge-and-resurrection');
  await accept(b.page);
  await until(async () => (await bookmarks(b.page)).length === 0 && !(await state(b.page)).bookmark_recovery);
  assert.deepEqual((await bookmarks(b.page, '2')).map(n => n.title), ['receiver-private']);
  const safety = (await snapshots(b.page)).findLast(s => s.count === 3);
  assert(safety); assert.equal(safety.tree[0].children.find(n => n.id === '1').children.length, 2);
  assert.equal((await pull(b.page)).action, 'skipped'); assert.equal(puts(), 2);
  expectSuccess(await send(b.page, { type: 'sync:restoreLocalSnapshot', id: safety.id }));
  assert.equal((await bookmarks(b.page)).length, 2);
  pass('receiver-confirmation-preserves-excluded-folder-and-restorable-full-snapshot');

  // A stale receive confirmation must not clear a new edit or a newly included folder.
  assert.equal((await pull(b.page)).success, false);
  const stale = (await pending(b.page)).id;
  await add(b.page, 'newer-edit');
  assert.equal((await send(b.page, { type: 'sync:pull', config, mode: 'overwrite', confirmationId: stale })).success, false);
  assert.equal((await bookmarks(b.page)).length, 3);
  const staleScope = (await pending(b.page)).id;
  await b.page.evaluate(() => chrome.storage.local.set({ sync_scope: { 'bookmarks-bar': true, other: true, mobile: false } }));
  assert.equal((await send(b.page, { type: 'sync:pull', config, mode: 'overwrite', confirmationId: staleScope })).success, false);
  assert.deepEqual((await pending(b.page)).affectedScope, { 'bookmarks-bar': true, other: false, mobile: false });
  await accept(b.page);
  await until(async () => (await bookmarks(b.page)).length === 0 && !(await state(b.page)).bookmark_recovery);
  assert.deepEqual((await bookmarks(b.page, '2')).map(n => n.title), ['receiver-private']);
  await b.page.evaluate(() => chrome.storage.local.set({ sync_scope: { 'bookmarks-bar': true, other: false, mobile: false } }));
  pass('receiver-rejects-stale-confirmation-after-edit-or-scope-change');

  // A larger clear exercises the quantity breaker exemption and interrupted deletion recovery.
  for (let i = 0; i < 25; i++) await add(a.page, 'large-' + i);
  expectSuccess(await push(a.page)); expectSuccess(await pull(b.page));
  assert.equal((await bookmarks(b.page)).length, 25);
  await clearBar(a.page); assert.equal((await push(a.page)).success, false);
  const before = puts(); await publish(a.page);
  await until(async () => puts() === before + 1 && (await state(a.page)).last_background_result?.result.success === true);
  assert.equal((await pull(b.page)).success, false);
  const worker = b.context.serviceWorkers()[0];
  await worker.evaluate(() => {
    const remove = chrome.bookmarks.remove.bind(chrome.bookmarks);
    globalThis.emptyDeleteProbe = { removed: 0 };
    chrome.bookmarks.remove = (id, callback) => {
      // Actual writes complete for the first two; third rejects before touching the next node.
      if (++globalThis.emptyDeleteProbe.removed === 3) {
        chrome.bookmarks.remove = remove;
        return Promise.reject(new Error('Synthetic interrupted clear'));
      }
      return callback ? remove(id, callback) : remove(id);
    };
  });
  await accept(b.page);
  await until(async () => (await state(b.page)).last_background_result?.result.message?.includes('Synthetic interrupted clear'));
  const recovery = (await state(b.page)).bookmark_recovery;
  assert(recovery); assert.equal((await bookmarks(b.page)).length, 23);
  assert.equal((await push(b.page)).success, false);
  assert.equal((await snapshots(b.page)).find(s => s.id === recovery.snapshotId).count, 26);
  const receiverUrl = b.page.url(); await b.page.close();
  b.page = await b.context.newPage(); await b.page.goto(receiverUrl);
  assert.deepEqual((await state(b.page)).bookmark_recovery, recovery);
  await b.page.getByRole('button', { name: 'Restore bookmarks from before the operation', exact: true }).waitFor();
  await b.page.screenshot({ path: path.join(output, 'interrupted-clear.png'), fullPage: true });
  expectSuccess(await send(b.page, { type: 'sync:restoreLocalSnapshot', id: recovery.snapshotId }));
  assert.equal((await bookmarks(b.page)).length, 25);
  assert.deepEqual((await bookmarks(b.page, '2')).map(n => n.title), ['receiver-private']);
  pass('interrupted-clear-retains-snapshot-blocks-sync-and-restores-all-25-bookmarks');
  assert.equal((await pull(b.page)).success, false); await accept(b.page);
  await until(async () => (await bookmarks(b.page)).length === 0 && !(await state(b.page)).bookmark_recovery);
  assert.equal((await pull(b.page)).action, 'skipped');
  pass('confirmed-large-clear-completes-and-is-not-reapplied');
};
