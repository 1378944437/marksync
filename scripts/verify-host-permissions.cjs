// Disposable Edge profiles and loopback fixtures. Native permission dialogs are not automated.
const { chromium } = require(process.env.MARKSYNC_PLAYWRIGHT || 'playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const http = require('node:http'), assert = require('node:assert/strict');
const output = path.resolve(process.env.MARKSYNC_VALIDATION_OUTPUT || 'docs/validation/2026-09-20-host-permissions');
const extension = path.resolve('apps/chrome-extension/dist');
const results = [], requests = [], files = new Map();
let context, version, failure, holdWrite = false, releaseWrite, writtenPath, rawHost = 'gist.githubusercontent.com', remoteTime = Date.now();
const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url); requests.push({ method: req.method, path: url });
  const buffers = []; for await (const chunk of req) buffers.push(chunk);
  if (url.startsWith('/redirect')) { res.writeHead(302, { Location: '/trap' }); res.end(); return; }
  if (url === '/gists/synthetic') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: 'synthetic', updated_at: new Date().toISOString(), files: {
      'bookmarks_20260920_120000_edge_1_v1.json.gz': { filename: 'bookmarks_20260920_120000_edge_1_v1.json.gz',
        size: 1, truncated: true, raw_url: `https://${rawHost}/synthetic/raw/backup` },
    } })); return;
  }
  if (req.method === 'PROPFIND') {
    const entries = [...files].filter(([name]) => name.startsWith(url.replace(/\/$/, '') + '/'));
    res.writeHead(207, { 'Content-Type': 'application/xml', 'Cache-Control': 'no-store' });
    res.end('<d:multistatus xmlns:d="DAV:">' + entries.map(([name, file]) =>
      `<d:response><d:href>${name}</d:href><d:propstat><d:prop><d:resourcetype/><d:getlastmodified>${file.time}</d:getlastmodified><d:getcontentlength>${file.content.length}</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join('') + '</d:multistatus>');
  } else if (req.method === 'PUT') {
    files.set(url, { content: Buffer.concat(buffers).toString(), time: new Date(remoteTime += 1000).toUTCString() });
    if (holdWrite) { writtenPath = url; await new Promise(resolve => { releaseWrite = resolve; }); }
    res.writeHead(201); res.end();
  } else if (req.method === 'GET' && files.has(url)) { res.writeHead(200); res.end(files.get(url).content); }
  else if (req.method === 'MKCOL') { res.writeHead(201); res.end(); }
  else if (req.method === 'DELETE') { files.delete(url); res.writeHead(204); res.end(); }
  else { res.writeHead(404); res.end(); }
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 10000) {
  const start = Date.now();
  while (!await check()) { if (Date.now() - start > timeout) throw new Error('Condition timed out'); await pause(100); }
}
function pass(name) { results.push({ name, status: 'passed' }); console.log('PASS ' + name); }
async function run() {
  for (const shell of ['chrome', 'firefox']) {
    const manifest = JSON.parse(fs.readFileSync(`apps/${shell}-extension/dist/manifest.json`));
    assert.deepEqual(manifest.optional_host_permissions, ['http://*/*', 'https://*/*']);
    assert(!manifest.content_scripts && !manifest.host_permissions);
  }
  pass('both-built-manifests-have-only-optional-http-hosts-and-no-content-scripts');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const config = { url: base + '/dav/', username: 'synthetic', password: 'synthetic' };
  context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'marksync-permissions-')), {
    channel: 'msedge', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  version = context.browser().version();
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const page = await context.newPage(); await page.goto(`chrome-extension://${id}/index.html?mode=tab`);
  const state = () => page.evaluate(() => chrome.storage.local.get(null));
  const send = message => page.evaluate(message => chrome.runtime.sendMessage(message), message);
  const grants = () => page.evaluate(() => chrome.permissions.getAll());
  const revoke = () => page.evaluate(() => chrome.permissions.remove({ origins: ['http://127.0.0.1/*'] }));
  const authorize = async () => {
    await require('./permission-fixture.cjs')(context, page, config.url);
    await until(async () => (await grants()).origins.includes('http://127.0.0.1/*'));
  };
  await page.evaluate(config => chrome.storage.local.set({ app_language: 'en', auto_sync_enabled: false,
    scheduled_sync_enabled: false, storage_type: 'webdav', webdav_url: config.url,
    webdav_username: config.username, webdav_password: config.password }), config);
  assert.deepEqual((await grants()).origins, []);
  const blocked = await send({ type: 'webdav:test', config });
  assert.equal(blocked.ok, false); assert.match(blocked.error, /Site access required/); assert.equal(requests.length, 0);
  await page.getByRole('button', { name: 'Authorize site access', exact: true }).waitFor();
  fs.mkdirSync(output, { recursive: true });
  await pause(700); // 等待现有页面入场动画结束，再核对静态布局。
  await page.screenshot({ path: path.join(output, 'permission-required.png'), fullPage: true });
  pass('fresh-install-blocks-network-and-shows-actionable-permission-notice');
  await authorize();
  assert.deepEqual((await grants()).origins, ['http://127.0.0.1/*']);
  assert.equal((await send({ type: 'webdav:test', config })).ok, true);
  pass('panel-request-activates-exact-host-after-browser-manager-preauthorization');

  await page.reload();
  await page.getByText('Settings & Tools', { exact: true }).click();
  await page.locator('#webdav-url').fill(base + '/draft/');
  // Explicit failure injection for request(false); does not claim a native Cancel click.
  await page.evaluate(() => {
    globalThis.originalRequest = chrome.permissions.request;
    chrome.permissions.request = (_options, callback) => { callback?.(false); return Promise.resolve(false); };
  });
  await page.getByRole('button', { name: 'Save connection settings', exact: true }).click();
  await page.getByText(/Site access required; open MarkSync/).last().waitFor();
  assert.equal((await state()).webdav_url, config.url);
  assert.equal(await page.locator('#webdav-url').inputValue(), base + '/draft/');
  await page.evaluate(() => { chrome.permissions.request = globalThis.originalRequest; });
  pass('injected-request-denial-preserves-saved-connection-and-input-draft');
  await page.reload();
  await page.evaluate(() => chrome.bookmarks.create({ parentId: '1', title: 'first', url: 'https://example.invalid/first' }));
  assert.equal((await send({ type: 'sync:push', config })).success, true);
  const baseline = (await state()).syncState;
  await revoke();
  await page.evaluate(() => chrome.storage.local.set({ auto_sync_enabled: true }));
  const before = requests.length;
  await page.evaluate(() => chrome.bookmarks.create({ parentId: '1', title: 'pending', url: 'https://example.invalid/pending' }));
  await until(async () => !!(await state()).pending_bookmark_upload);
  await pause(1600);
  const pending = await state();
  assert.notEqual(pending.pending_bookmark_upload.id, pending.acknowledged_bookmark_upload);
  assert.deepEqual(pending.syncState, baseline); assert.equal(requests.length, before);
  pass('revoked-access-pauses-auto-upload-without-network-ack-or-baseline-change');
  await authorize();
  await page.evaluate(() => chrome.bookmarks.create({ parentId: '1', title: 'resume', url: 'https://example.invalid/resume' }));
  await until(async () => { const s = await state(); return s.acknowledged_bookmark_upload === s.pending_bookmark_upload?.id; });
  assert.notDeepEqual((await state()).syncState, baseline);
  pass('reauthorized-auto-upload-resumes-and-acknowledges-pending-edits');

  await page.evaluate(() => chrome.storage.local.set({ auto_sync_enabled: false }));
  await page.evaluate(() => chrome.bookmarks.create({ parentId: '1', title: 'write-window', url: 'https://example.invalid/write-window' }));
  const oldState = (await state()).syncState, oldNames = [...files.keys()];
  holdWrite = true;
  const writing = send({ type: 'sync:push', config });
  await until(() => !!writtenPath);
  await revoke(); holdWrite = false; releaseWrite();
  assert.equal((await writing).success, false);
  assert.deepEqual((await state()).syncState, oldState);
  assert(oldNames.every(name => files.has(name)) && files.has(writtenPath));
  pass('revocation-after-put-before-readback-preserves-baseline-and-cloud-history');
  await authorize();
  const puts = requests.filter(r => r.method === 'PUT').length;
  assert.equal((await send({ type: 'sync:smart', config })).success, true);
  assert.equal(requests.filter(r => r.method === 'PUT').length, puts);
  pass('reauthorization-resolves-unknown-write-by-reading-without-duplicate-upload');
  assert.equal((await send({ type: 'webdav:test', config: { ...config, url: base + '/redirect/' } })).ok, false);
  assert(!requests.some(r => r.path === '/trap'));
  pass('redirect-is-refused-before-following-to-another-address');

  const gist = { type: 'gist', token: 'synthetic', gistId: 'synthetic', endpoint: base };
  await page.evaluate(gist => chrome.storage.local.set({ storage_type: 'gist', gist_token: gist.token, gist_id: gist.gistId, gist_endpoint: gist.endpoint }), gist);
  const pathName = 'BookmarkSyncer/bookmarks_20260920_120000_edge_1_v1.json.gz';
  const rawBlocked = await send({ type: 'sync:restoreCloudBackup', config: gist, path: pathName });
  assert.equal(rawBlocked.success, false); assert.match(rawBlocked.message, /Site access required/);
  await page.getByText('https://gist.githubusercontent.com/*', { exact: true }).waitFor();
  await pause(700);
  await page.screenshot({ path: path.join(output, 'gist-raw-permission.png'), fullPage: true });
  await page.evaluate(() => chrome.storage.local.set({ gist_id: 'another-gist' }));
  await page.getByText('https://gist.githubusercontent.com/*', { exact: true }).waitFor({ state: 'hidden' });
  pass('trusted-raw-host-needs-separate-access-and-isolated-target-notice');
  rawHost = 'untrusted.example.invalid';
  const unsafe = await send({ type: 'sync:restoreCloudBackup', config: { ...gist, gistId: 'synthetic' }, path: pathName });
  assert.equal(unsafe.success, false); assert.match(unsafe.message, /Raw 文件地址不在允许的域内/);
  assert.deepEqual((await grants()).origins, ['http://127.0.0.1/*']);
  pass('untrusted-raw-host-is-rejected-without-grant-or-token-request');
}
(async () => {
  try { await run(); } catch (error) { failure = error.message; console.error(error); process.exitCode = 1; }
  finally {
    releaseWrite?.(); fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ recordedAt: new Date().toISOString(), browser: version,
      results, failure: failure || null, requestCounts: requests.reduce((counts, request) => ({ ...counts, [request.method]: (counts[request.method] || 0) + 1 }), {}),
      limitations: ['Headless Edge and loopback fixtures only; no real account',
        'Host grant is preauthorized in the test browser extension manager, then activated by the actual panel button',
        'Denied request is explicitly injected; native permission Accept/Cancel dialog is not validated',
        'No actual old-version upgrade, stock Firefox, mobile browser or toolbar popup test'] }, null, 2) + '\n');
    if (context) await context.close(); server.closeAllConnections(); server.close();
  }
})();
