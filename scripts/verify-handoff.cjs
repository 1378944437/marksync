// Focused UI/background checks against loopback fixtures in a disposable Edge profile.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

module.exports = async function ({ device, add, send, state, config, holdPut, files, requests, until, pass, output }) {
  const a = await device('handoff');
  let page = a.page;
  const pageUrl = page.url();
  const settings = async label => {
    await page.reload();
    await page.getByText('Settings & Tools', { exact: true }).click();
    await page.getByRole('button', { name: new RegExp(label) }).click();
  };
  // The local fixture uses only synthetic credentials. It never contacts GitHub.
  let postCount = 0, releaseCreate;
  const createGate = new Promise(resolve => { releaseCreate = resolve; });
  const gistServer = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/user') {
      res.setHeader('X-OAuth-Scopes', 'gist');
      res.writeHead(req.headers.authorization?.includes('bad-test-token') ? 401 : 200);
      res.end(JSON.stringify({ login: 'synthetic-user' }));
    } else if (req.url === '/gists' && req.method === 'POST') {
      postCount++;
      for await (const _ of req) { /* drain synthetic payload */ }
      await createGate;
      res.writeHead(201); res.end(JSON.stringify({ id: 'synthetic-created-id', html_url: '' }));
    } else { res.writeHead(404); res.end('{}'); }
  });
  await new Promise(resolve => gistServer.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${gistServer.address().port}`;
  try {
    await settings('^Cloud storage$');
    await page.getByRole('button', { name: 'GitHub Gist', exact: true }).click();
    await page.getByRole('button', { name: /Advanced options/ }).click();
    await page.locator('#gist-endpoint').fill(endpoint);
    await page.locator('#gist-token').fill('bad-test-token');
    await page.getByRole('button', { name: 'Test Gist Connection', exact: true }).click();
    await page.getByText(/HTTP 401/).waitFor();
    await page.locator('#gist-token').fill('synthetic-token');
    await page.getByRole('button', { name: 'Test Gist Connection', exact: true }).click();
    await page.getByText('GitHub Gist connected successfully!', { exact: true }).waitFor();
    pass('gist-settings-connection-success-and-specific-401-error');
    await page.getByRole('button', { name: 'Auto Create', exact: true }).click();
    await until(() => postCount === 1);
    await page.close();
    releaseCreate();
    page = await a.context.newPage();
    await page.goto(pageUrl);
    await until(async () => (await state(page)).last_created_gist?.id === 'synthetic-created-id');
    assert.equal((await state(page)).gist_id, undefined);
    await settings('^Cloud storage$');
    await page.getByRole('button', { name: 'Use the recently created Gist', exact: true }).click();
    assert.equal(await page.locator('#gist-id').inputValue(), 'synthetic-created-id');
    assert.equal(postCount, 1);
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'gist-recovered-draft.png'), fullPage: true });
    pass('gist-creation-survives-page-close-and-recovers-draft-without-saving-connection');

    await page.getByRole('button', { name: 'WebDAV Service', exact: true }).click();
    await page.locator('#webdav-url').fill('');
    const beforeTest = requests.length;
    await page.getByRole('button', { name: 'Test these inputs', exact: true }).click();
    await page.getByText(/URL|address/i).filter({ hasText: /invalid|valid|enter/i }).last().waitFor();
    assert.equal(requests.length, beforeTest);
    pass('empty-webdav-address-is-rejected-in-settings');

    await add(page, 'migration-safety');
    assert.equal((await send(page, { type: 'sync:push', config })).success, true);
    const hold = holdPut(true);
    const migrating = send(page, { type: 'sync:encryption', config, next: { enabled: true, passphrase: 'synthetic-new-password' } });
    await until(() => hold.path);
    const candidate = files.get(hold.path);
    files.set(hold.path, { ...candidate, content: 'synthetic-corruption' });
    hold.release();
    assert.equal((await migrating).success, false);
    files.set(hold.path, candidate);
    const oldState = (await state(page)).syncState;
    await settings('^End-to-End Encryption$');
    await page.getByRole('button', { name: 'Resume encryption migration', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Cancel migration', exact: true }).click();
    await until(async () => !(await state(page)).encryption_migration);
    assert.equal(files.has(hold.path), false);
    assert.deepEqual((await state(page)).syncState, oldState);
    assert.equal((await send(page, { type: 'sync:push', config })).success, true);
    pass('cancel-migration-ui-deletes-only-candidate-and-unblocks-sync');

    // Scope includes only the bar; demonstrate that a rejected restore writes nothing.
    const beforeBookmarks = await page.evaluate(() => chrome.bookmarks.getTree());
    const invalidPath = '/dav/MarkSync/bookmarks_invalid.json.gz';
    const zlib = require('node:zlib');
    files.set(invalidPath, { time: new Date().toUTCString(), content: zlib.gzipSync(JSON.stringify({
      data: [{ title: '', children: [{ id: '1', title: 'Bar', folderType: 'bookmarks-bar', children: [{ title: 'bookmarklet', url: 'javascript:void(0)' }] }] }],
    })).toString('base64') });
    const rejected = await send(page, { type: 'sync:restoreCloudBackup', config, path: 'MarkSync/bookmarks_invalid.json.gz' });
    assert.equal(rejected.success, false);
    assert.match(rejected.message, /结构无效/);
    assert.deepEqual(await page.evaluate(() => chrome.bookmarks.getTree()), beforeBookmarks);
    files.delete(invalidPath);
    pass('protocol-whitelist-rejects-entire-restore-before-bookmark-writes');

    await page.evaluate(() => chrome.storage.local.set({ last_scheduled_check: Date.now(), scheduled_sync_interval: 30 }));
    await settings('^Sync Policy$');
    const pageNetwork = [];
    page.on('request', request => { if (request.url().startsWith('http')) pageNetwork.push(request.url()); });
    await page.getByText('Scheduled sync', { exact: true }).click();
    await until(async () => (await page.evaluate(() => chrome.alarms.get('scheduledSync')))?.periodInMinutes === 30);
    await page.locator('input[type="number"]').first().fill('1');
    await until(async () => (await page.evaluate(() => chrome.alarms.get('scheduledSync')))?.periodInMinutes === 1);
    assert.equal(pageNetwork.length, 0);
    const check = (await state(page)).last_scheduled_check;
    const beforeAlarm = requests.length;
    console.log('WAIT natural one-minute scheduled alarm');
    await until(async () => (await state(page)).last_scheduled_check > check && requests.slice(beforeAlarm).some(request => request.method === 'PROPFIND'), 80000);
    assert.equal(pageNetwork.length, 0);
    await page.getByText('Scheduled sync', { exact: true }).click();
    await until(async () => !(await page.evaluate(() => chrome.alarms.get('scheduledSync'))));
    pass('settings-reconcile-background-alarm-and-natural-due-sync-with-no-page-network');
  } finally {
    releaseCreate();
    gistServer.closeAllConnections();
    await new Promise(resolve => gistServer.close(resolve));
  }
};
