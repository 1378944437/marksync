// Reload the actual previous local package with the new build in a disposable Edge profile.
const { chromium } = require(process.env.MARKSYNC_PLAYWRIGHT || 'playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const output = path.resolve(process.env.MARKSYNC_VALIDATION_OUTPUT || 'docs/validation/2026-09-20-host-permissions');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'marksync-permission-upgrade-'));
const extension = path.join(temporary, 'extension'), profile = path.join(temporary, 'profile');
let context, version, failure, oldOrigins, newOrigins;
const preserved = { app_language: 'en', storage_type: 'webdav', webdav_url: 'http://127.0.0.1:1/dav/',
  webdav_username: 'synthetic', webdav_password: 'synthetic', auto_sync_enabled: false, scheduled_sync_enabled: false,
  pending_bookmark_upload: { id: 'pending-before-upgrade', target: 'synthetic-target' },
  acknowledged_bookmark_upload: 'older-edit', syncState: { localHash: 'synthetic-baseline' },
  encryption_migration: { target: 'synthetic-target', path: 'synthetic-candidate' } };
async function launch() {
  context = await chromium.launchPersistentContext(profile, { channel: 'msedge', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  version = context.browser().version();
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage(); await page.goto(`chrome-extension://${new URL(worker.url()).host}/index.html?mode=tab`);
  return page;
}
(async () => {
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      'Add-Type -AssemblyName System.IO.Compression.FileSystem\n[System.IO.Compression.ZipFile]::ExtractToDirectory($env:MARKSYNC_OLD_PACKAGE,$env:MARKSYNC_UPGRADE_EXTENSION)'],
      { windowsHide: true, env: { ...process.env, MARKSYNC_UPGRADE_EXTENSION: extension,
        MARKSYNC_OLD_PACKAGE: path.resolve('artifacts/marksync-v1.6.2-empty-sync-20260920/marksync-chrome-v1.6.2-empty-sync-20260920.zip') } });
    let page = await launch();
    oldOrigins = (await page.evaluate(() => chrome.permissions.getAll())).origins;
    assert(oldOrigins.includes('<all_urls>'));
    await page.evaluate(values => chrome.storage.local.set(values), preserved);
    await context.close(); context = null;
    fs.cpSync(path.resolve('apps/chrome-extension/dist'), extension, { recursive: true });
    page = await launch();
    await page.getByRole('button', { name: 'Authorize site access', exact: true }).waitFor();
    const manifest = await page.evaluate(() => chrome.runtime.getManifest());
    assert(!manifest.content_scripts && !manifest.host_permissions);
    newOrigins = (await page.evaluate(() => chrome.permissions.getAll())).origins;
    assert.deepEqual(newOrigins, []);
    assert.deepEqual(await page.evaluate(keys => chrome.storage.local.get(keys), Object.keys(preserved)), preserved);
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'upgraded-permission-notice.png'), fullPage: true });
    console.log('PASS actual-previous-package-reload-removes-broad-grants-and-preserves-settings-pending-baseline-migration');
  } catch (error) { failure = error.message; console.error(error); process.exitCode = 1; }
  finally {
    if (context) await context.close(); fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'upgrade.json'), JSON.stringify({ recordedAt: new Date().toISOString(), browser: version,
      status: failure ? 'failed' : 'passed', oldOrigins, newOrigins, failure: failure || null,
      limitations: ['Unpacked previous package replaced by current build at the same path and version',
        'Not a Chrome Web Store update, stock Firefox update or native permission-dialog test',
        'Synthetic settings only; no real provider accessed'] }, null, 2) + '\n');
  }
})();
