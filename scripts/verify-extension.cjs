// Real unpacked extension + disposable Edge profiles + loopback-only WebDAV fixture.
// Usage: MARKSYNC_PLAYWRIGHT=<installed Playwright module path> node scripts/verify-extension.cjs
const { chromium } = require(process.env.MARKSYNC_PLAYWRIGHT || 'playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const lifecycle = process.argv.includes('--lifecycle');
const interruption = process.argv.includes('--interruption');
const restoreInterruption = process.argv.includes('--restore-interruption');
const firefox = process.argv.includes('--firefox');
const handoff = process.argv.includes('--handoff');
const emptySync = process.argv.includes('--empty-sync');
assert([lifecycle, interruption, restoreInterruption, firefox, handoff, emptySync].filter(Boolean).length <= 1, 'Select one validation mode');
const extension = path.resolve('apps/chrome-extension/dist');
const output = path.resolve(process.env.MARKSYNC_VALIDATION_OUTPUT || ('docs/validation/' + (emptySync ? '2026-09-20-empty-sync' : handoff ? '2026-09-19-handoff' : firefox ? '2026-09-15-firefox' : restoreInterruption ? '2026-09-15-restore' : interruption ? '2026-09-15-interruption' : '2026-09-14-' + (lifecycle ? 'lifecycle' : 'extension'))));
const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
const id = crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex')
  .slice(0, 32).replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16)));
const files = new Map(), requests = [], results = [], contexts = [];
let fault = false, gate = null, revision = 0, unblock = () => {};
const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url);
  requests.push({ method: req.method, path: url, failed: fault, time: Date.now() });
  if (fault) { res.writeHead(503); res.end('Synthetic service unavailable'); return; }
  const buffers = []; for await (const chunk of req) buffers.push(chunk);
  const content = Buffer.concat(buffers).toString();
  if (req.method === 'PROPFIND') {
    if (/\.gz(?:\.enc)?$/.test(url) && !files.has(url)) { res.writeHead(404); res.end(); return; }
    const entries = [...files].filter(([name]) => name.startsWith(url.replace(/\/$/, '') + '/'));
    const response = entries.map(([name, file]) => `<d:response><d:href>${name}</d:href><d:propstat><d:prop><d:resourcetype/><d:getlastmodified>${file.time}</d:getlastmodified><d:getcontentlength>${file.content.length}</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join('');
    res.writeHead(207, { 'Content-Type': 'application/xml', 'Cache-Control': 'no-store' });
    res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${response}</d:multistatus>`);
  } else if (req.method === 'PUT') {
    const current = gate; gate = null;
    if (current && !current.afterWrite) { current.entered(url); await current.wait; }
    files.set(url, { content, time: new Date(Date.now() + ++revision * 1000).toUTCString() });
    if (current?.afterWrite) { current.entered(url); await current.wait; }
    res.writeHead(201); res.end();
  } else if (req.method === 'GET' && files.has(url)) {
    res.writeHead(200, { 'Cache-Control': 'no-store' }); res.end(files.get(url).content);
  } else if (req.method === 'DELETE') {
    files.delete(url); res.writeHead(204); res.end();
  } else if (req.method === 'MKCOL') { res.writeHead(201); res.end(); }
  else { res.writeHead(404); res.end(); }
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, timeout = 10000) {
  const start = Date.now();
  while (!await predicate()) {
    if (Date.now() - start > timeout) throw new Error('Condition timed out after ' + timeout + ' ms');
    await pause(200);
  }
}
function holdPut(afterWrite = false) {
  let uploadedPath, release;
  gate = { afterWrite, entered: value => { uploadedPath = value; }, wait: new Promise(resolve => { release = resolve; }) };
  unblock = release;
  return { get path() { return uploadedPath; }, release };
}
function pass(name, details = {}) { results.push({ name, status: 'passed', ...details }); console.log('PASS ' + name); }
async function open(context) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/index.html?mode=tab`);
  return page;
}
const send = (page, message) => page.evaluate(message => chrome.runtime.sendMessage(message), message);
const state = page => page.evaluate(() => chrome.storage.local.get(null));
const bookmarks = (page, parent = '1') => page.evaluate(parent => chrome.bookmarks.getChildren(parent), parent);
const add = (page, title, parentId = '1') => page.evaluate(({ title, parentId }) =>
  chrome.bookmarks.create({ parentId, title, url: `https://marksync.invalid/${title}` }), { title, parentId });
const expectSuccess = result => assert.equal(result?.success, true, JSON.stringify(result));
let config, version, nativeBrowser, nativeError, nativeProfile;
async function device(name, existingProfile) {
  const profile = existingProfile || fs.mkdtempSync(path.join(os.tmpdir(), 'marksync-real-' + name + '-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'msedge', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  contexts.push(context); version = context.browser().version();
  if (!context.serviceWorkers().length) await context.waitForEvent('serviceworker', { timeout: 10000 });
  const page = await open(context);
  await page.evaluate(config => chrome.storage.local.set({ app_language: 'en', auto_sync_enabled: false,
    scheduled_sync_enabled: false, storage_type: 'webdav', webdav_url: config.url,
    webdav_username: config.username, webdav_password: config.password,
    sync_scope: { 'bookmarks-bar': true, other: false, mobile: false } }), config);
  if (!(await page.evaluate(() => chrome.permissions.getAll())).origins.length) await require('./permission-fixture.cjs')(context, page, config.url);
  return { context, page, profile };
}
async function nativeProcess() {
  if (!nativeProfile) return null;
  // Edge's launcher can exit after handing off to another PID; identify only our disposable profile.
  const command = 'Get-CimInstance Win32_Process -Filter "name = \'msedge.exe\'" | ' +
    'Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:MARKSYNC_TEST_PROFILE) -and $_.CommandLine -notmatch "--type=" } | ' +
    'Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress';
  const result = await new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-Command', command],
    { windowsHide: true, env: { ...process.env, MARKSYNC_TEST_PROFILE: nativeProfile } },
    (error, stdout) => error ? reject(error) : resolve(stdout.trim())));
  if (!result) return null;
  const processInfo = JSON.parse(result);
  assert(!Array.isArray(processInfo), 'Expected one native test browser');
  assert(!/remote-debugging/.test(processInfo.CommandLine), 'Unexpected debugging connection');
  return processInfo;
}
async function stopNative() {
  const processInfo = await nativeProcess();
  if (!processInfo) return;
  const pid = processInfo.ProcessId;
  assert(Number.isSafeInteger(pid) && pid > 0);
  await new Promise((resolve, reject) => execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'],
    { windowsHide: true }, error => error ? reject(error) : resolve()));
  await until(async () => !await nativeProcess());
}
async function runLifecycle() {
  const a = await device('lifecycle');
  await add(a.page, 'before-restart');
  expectSuccess(await send(a.page, { type: 'sync:push', config }));
  fault = true;
  await a.page.evaluate(() => chrome.storage.local.set({ auto_sync_enabled: true }));
  await add(a.page, 'pending-across-restart');
  await until(() => requests.some(r => r.failed && r.method === 'PROPFIND'));
  const pending = (await state(a.page)).pending_bookmark_upload;
  assert(pending && (await state(a.page)).acknowledged_bookmark_upload !== pending.id);
  await a.page.close(); await a.context.close();
  const started = Date.now(), firstRequest = requests.length;
  const args = ['--headless=new', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${a.profile}`, `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`, 'about:blank'];
  assert(args.every(arg => !/remote-debugging/.test(arg)));
  nativeProfile = a.profile;
  nativeBrowser = spawn(path.join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
    args, { windowsHide: true, stdio: 'ignore' });
  nativeBrowser.on('error', error => { nativeError = error; });
  await until(async () => { if (nativeError) throw nativeError; return !!await nativeProcess(); });
  const observed = () => {
    if (nativeError) throw nativeError;
    return requests.slice(firstRequest);
  };
  console.log('WAIT debugger-free Edge: failed retry after at least 40 seconds');
  await until(() => observed().some(r => r.failed && r.method === 'PROPFIND' && r.time - started >= 40000), 80000);
  const recovered = Date.now(); fault = false;
  console.log('WAIT debugger-free Edge: natural retry after service recovery');
  await until(() => observed().some(r => r.method === 'PUT' && !r.failed), 80000);
  const uploaded = observed().find(r => r.method === 'PUT' && !r.failed);
  await until(() => observed().some(r => r.method === 'GET' && r.path === uploaded.path));
  // Give the actual background operation time to persist its ACK before terminating our process tree.
  await pause(2000);
  await stopNative();
  nativeProfile = null;
  pass('debugger-free-restart-and-natural-alarm-upload', {
    firstDelayedFailureMs: requests.slice(firstRequest).find(r => r.failed && r.time - started >= 40000).time - started,
    recoveryToUploadMs: uploaded.time - recovered,
    requestCounts: requests.slice(firstRequest).reduce((a, r) => ({ ...a, [r.method]: (a[r.method] || 0) + 1 }), {})
  });
  // Reattach only after the no-debugger phase has ended; prevent a later retry from masking a lost ACK.
  fault = true;
  const check = await device('inspect', a.profile);
  const stored = await state(check.page);
  assert.equal(stored.acknowledged_bookmark_upload, pending.id);
  assert.equal(stored.syncState.basis.filePath, uploaded.path.replace('/dav/', ''));
  assert.deepEqual((await bookmarks(check.page)).map(n => n.title), ['before-restart', 'pending-across-restart']);
  pass('completed-upload-ack-and-baseline-survive-process-termination');
}
async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  config = { type: 'webdav', url: `http://127.0.0.1:${server.address().port}/dav`, username: 'test', password: 'test-only' };
  if (emptySync) return require('./verify-empty-sync.cjs')({ device, add, send, state, config, holdPut, files, requests, until, pass, output, bookmarks, expectSuccess });
  if (handoff) return require('./verify-handoff.cjs')({ device, add, send, state, config, holdPut, files, requests, until, pass, output });
  if (lifecycle) return runLifecycle();
  if (interruption) return require('./verify-interruption.cjs')({ device, add, send, state, bookmarks,
    expectSuccess, config, holdPut, files, requests, until, pause, pass });
  if (restoreInterruption) return require('./verify-restore-interruption.cjs')({ device, send, state,
    expectSuccess, config, requests, until, pause, pass, output });
  if (firefox) return require('./verify-firefox.cjs')({ device, send, state, add, bookmarks,
    expectSuccess, config, until, pass, output, contexts });
  const a = await device('a'), b = await device('b');
  await add(a.page, 'one'); const two = await add(a.page, 'two');
  await add(a.page, 'a-protected', '2'); await add(b.page, 'b-local');
  const protectedB = await add(b.page, 'one', '2');
  expectSuccess(await send(a.page, { type: 'sync:smart', config }));
  const conflict = await send(b.page, { type: 'sync:smart', config });
  assert.equal(conflict.needsConflictResolution, true);
  assert.deepEqual((await bookmarks(b.page)).map(n => n.title), ['b-local']);
  expectSuccess(await send(b.page, { type: 'sync:pull', config, mode: 'overwrite' }));
  assert.deepEqual((await bookmarks(b.page)).map(n => n.title), ['one', 'two']);
  assert.equal((await bookmarks(b.page, '2'))[0].id, protectedB.id);
  pass('two-profile-first-sync-and-excluded-root-protection');

  const firstHash = (await state(b.page)).syncState.localHash;
  expectSuccess(await send(b.page, { type: 'sync:smart', config }));
  assert.equal((await state(b.page)).syncState.localHash, firstHash);
  await a.page.evaluate(id => chrome.bookmarks.remove(id), two.id);
  expectSuccess(await send(a.page, { type: 'sync:push', config }));
  expectSuccess(await send(b.page, { type: 'sync:smart', config }));
  assert.deepEqual((await bookmarks(b.page)).map(n => n.title), ['one']);
  assert.equal((await bookmarks(b.page, '2'))[0].id, protectedB.id);
  pass('identical-baseline-and-remote-deletion-propagation');

  const local = (await bookmarks(b.page))[0];
  await b.page.evaluate(id => chrome.bookmarks.update(id, { title: 'unsent-edit' }), local.id);
  await add(a.page, 'three'); expectSuccess(await send(a.page, { type: 'sync:push', config }));
  assert.equal((await send(b.page, { type: 'sync:smart', config })).needsConflictResolution, true);
  assert.equal((await bookmarks(b.page))[0].title, 'unsent-edit');
  pass('dirty-local-edit-requires-direction-choice');

  fault = true; const putsBefore = requests.filter(r => r.method === 'PUT').length;
  await add(a.page, 'retry');
  assert.equal((await send(a.page, { type: 'sync:push', config })).success, false);
  assert.equal(requests.filter(r => r.method === 'PUT').length, putsBefore);
  pass('remote-503-fails-closed-with-zero-upload');
  await a.page.evaluate(() => chrome.storage.local.set({ auto_sync_enabled: true }));
  const failedReads = requests.filter(r => r.failed && r.method === 'PROPFIND').length;
  await add(a.page, 'automatic-retry');
  await until(() => requests.filter(r => r.failed && r.method === 'PROPFIND').length > failedReads);
  const pending = (await state(a.page)).pending_bookmark_upload;
  assert(pending && (await state(a.page)).acknowledged_bookmark_upload !== pending.id);
  fault = false;
  console.log('WAIT natural 45-second retry alarm');
  await until(async () => (await state(a.page)).acknowledged_bookmark_upload === pending.id, 65000);
  await a.page.evaluate(() => chrome.storage.local.set({ auto_sync_enabled: false }));
  pass('failed-bookmark-event-retries-via-natural-alarm-without-another-edit');

  const before = [...await bookmarks(a.page), ...await bookmarks(a.page, '2')].map(n => n.title).sort();
  const cleared = await send(a.page, { type: 'storage:maintenance', kind: 'local' });
  assert(Number.isSafeInteger(cleared.snapshotId), JSON.stringify(cleared));
  assert.equal((await bookmarks(a.page)).length, 0);
  expectSuccess(await send(a.page, { type: 'sync:restoreLocalSnapshot', id: cleared.snapshotId }));
  assert.deepEqual([...await bookmarks(a.page), ...await bookmarks(a.page, '2')].map(n => n.title).sort(), before);
  assert.equal((await state(a.page)).bookmark_recovery, undefined);
  pass('real-indexeddb-safety-snapshot-clear-and-restore');

  const plainHistory = [...files.keys()];
  expectSuccess(await send(a.page, { type: 'sync:encryption', config, next: { enabled: true, passphrase: 'first-test-password' } }));
  const oldEncrypted = (await state(a.page)).syncState.basis.filePath;
  expectSuccess(await send(a.page, { type: 'sync:encryption', config, next: { enabled: true, passphrase: 'second-test-password' } }));
  assert.equal((await state(a.page)).e2e_passphrase, 'second-test-password');
  assert(plainHistory.every(file => files.has(file)));
  expectSuccess(await send(a.page, { type: 'sync:restoreCloudBackup', config, path: oldEncrypted, passphrase: 'first-test-password' }));
  assert.equal((await state(a.page)).e2e_passphrase, 'second-test-password');
  expectSuccess(await send(a.page, { type: 'sync:encryption', config, next: { enabled: false, passphrase: '' } }));
  assert.equal((await state(a.page)).e2e_enabled, false);
  assert.equal((await state(a.page)).encryption_migration, undefined);
  pass('encryption-enable-rotate-history-password-and-disable');

  await add(a.page, 'survives-page-close');
  const hold = holdPut(), sender = await open(a.context);
  const sending = send(sender, { type: 'sync:push', config }).catch(() => null);
  await until(() => hold.path);
  const uploadedPath = hold.path;
  const competing = await send(a.page, { type: 'sync:push', config });
  assert.equal(competing.success, false); assert.match(competing.message, /进行中/);
  await sender.close(); hold.release(); await sending;
  await until(async () => (await state(a.page)).syncState?.basis.filePath === uploadedPath.replace('/dav/', ''));
  pass('closed-extension-page-keeps-background-upload-and-shared-lock');

  const cdp = await a.context.newCDPSession(a.page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  assert.equal((await send(a.page, { type: 'storage:test', config })).ok, true);
  await cdp.detach();
  pass('service-worker-stop-and-message-wakeup');
  fs.mkdirSync(output, { recursive: true });
  await a.page.reload(); await a.page.getByRole('button', { name: /Sync now|Done/ }).first().waitFor();
  await a.page.waitForFunction(() => {
    let node = [...document.querySelectorAll('button')].find(button => /Sync now|Done/.test(button.textContent));
    if (!node) return false;
    while (node) { if (+getComputedStyle(node).opacity < 0.99) return false; node = node.parentElement; }
    return true;
  });
  await until(async () => (await state(a.page)).sync_history_logs?.some(log => log.trigger === 'manual'));
  await a.page.screenshot({ path: path.join(output, 'real-extension.png'), fullPage: true });
}
(async () => {
  let failure;
  try { await run(); }
  catch (error) { failure = error.message; console.error(error); process.exitCode = 1; }
  finally {
    unblock();
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ date: new Date().toISOString(),
      browser: version, extensionVersion: manifest.version, environment: lifecycle
        ? 'Real Edge extension; temporary profile; native Edge without debugging flags during observation; loopback WebDAV fixture'
        : handoff ? 'Real Edge extension; disposable profile; settings UI and background operations; loopback WebDAV/Gist fixtures'
        : firefox ? 'Real Edge and Playwright Firefox extensions; temporary profiles; loopback WebDAV fixture'
        : restoreInterruption ? 'Real Edge extension; disposable profile; actual bookmark writes with third create callback suspended, then browser crash; loopback WebDAV fixture'
        : interruption ? 'Real Edge extension; disposable profile; browser crash after server PUT commit; loopback WebDAV fixture'
        : 'Real Edge extension; two temporary profiles; loopback WebDAV fixture',
      results, failure: failure || null, requestCounts: requests.reduce((a, r) => ({ ...a, [r.method]: (a[r.method] || 0) + 1 }), {}),
      limitations: ['Not a real remote WebDAV/Gist service', 'Loopback site access preauthorized through isolated extension manager; native permission dialog not tested', lifecycle
        ? 'Playwright used only before/after native phase; natural worker suspension not directly observed; no interruption during writes'
        : 'Browser automation attached', 'Not a toolbar popup lifecycle test', firefox
        ? 'Playwright Firefox runtime, not stock Firefox; no mobile browser' : 'No Firefox or mobile browser'] }, null, 2) + '\n');
    await stopNative();
    for (const context of contexts) await Promise.race([context.close().catch(() => {}), pause(3000)]);
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
})();
