// Disposable Edge profiles, synthetic IndexedDB snapshots and session-cache cloud metadata.
const { chromium } = require(process.env.MARKSYNC_PLAYWRIGHT || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const extension = path.resolve('apps/chrome-extension/dist');
const output = path.resolve(process.env.MARKSYNC_VALIDATION_OUTPUT || 'docs/validation/2026-09-20-responsive-panels');
const results = [];
const cases = [
  [360, 560, false], [1280, 900, false], [1920, 1080, false],
  [320, 640, true], [360, 740, true], [390, 844, true], [412, 915, true], [430, 932, true],
  [740, 360, true], [768, 1024, true], [1024, 768, true], [390, 740, true, true],
];
async function seed(page) {
  await page.evaluate(async () => {
    const request = indexedDB.open('bookmark-syncer-db', 1);
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const tx = db.transaction('snapshots', 'readwrite');
    for (let i = 1; i <= 12; i++) tx.objectStore('snapshots').put({ id: i, timestamp: Date.now() - i * 60000,
      reason: i === 1 ? 'Snapshot-' + 'LongTitle'.repeat(12) : `Snapshot ${i}`, count: 12345, tree: [] });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
    await chrome.storage.session.set({ cloud_backup_list_cache: {
      target: 'webdav:http://127.0.0.1:1|fixture', cachedAt: Date.now(),
      backups: Array.from({ length: 12 }, (_, i) => ({ name: `bookmarks_fixture_${i}.json.gz`,
        path: `/MarkSync/bookmarks_fixture_${i}.json.gz`, timestamp: Date.now() - i * 60000,
        totalCount: 12345, browser: 'edge', deviceName: 'Cloud device ' + 'LongName'.repeat(15) })),
    } });
  });
}
async function geometry(dialog) {
  return dialog.evaluate(el => {
    const panel = el.querySelector('.custom-scrollbar').parentElement;
    const r = panel.getBoundingClientRect();
    const scroller = panel.querySelector('.custom-scrollbar');
    return { width: r.width, left: r.left, right: r.right, bottom: r.bottom, viewport: innerWidth,
      overflow: scroller.scrollWidth > scroller.clientWidth + 1,
      scrollable: scroller.scrollHeight > scroller.clientHeight };
  });
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  for (const [width, height, mobile, largeText = false] of cases) {
    const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'marksync-responsive-')), {
      channel: 'msedge', headless: true, ignoreDefaultArgs: ['--hide-scrollbars'],
      viewport: { width, height }, isMobile: mobile, hasTouch: mobile,
      ...(mobile ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/153.0.0.0 Mobile Safari/537.36' } : {}),
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    try {
      const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
      await worker.evaluate(() => chrome.storage.local.set({ app_language: 'en', auto_sync_enabled: false,
        scheduled_sync_enabled: false, storage_type: 'webdav', webdav_url: 'http://127.0.0.1:1',
        webdav_username: 'fixture', webdav_password: 'fixture' }));
      const page = await context.newPage();
      await page.goto(worker.url().split('/').slice(0, 3).join('/') + '/index.html');
      await require('./permission-fixture.cjs')(context, page, 'http://127.0.0.1:1');
      await seed(page);
      await page.reload();
      if (largeText) await page.addStyleTag({ content: 'html { font-size: 20px !important; }' });
      for (const [language, theme] of [['en', 'light'], ['zh-CN', 'dark']]) {
        await page.evaluate(({ language, theme }) => chrome.storage.local.set({ app_language: language, theme }), { language, theme });
        const en = language === 'en';
        const local = en ? 'Local bookmarks' : '本地书签';
        const cloud = en ? 'Cloud backup' : '云端备份';
        const restore = en ? 'Restore' : '恢复';
        const cancel = en ? 'Cancel' : '取消';
        await page.getByText(local, { exact: true }).waitFor();
        await page.waitForTimeout(400);
        if (width >= 640) {
          const contained = await page.locator('.console-sync-panel').evaluate(el => {
            const panel = el.getBoundingClientRect(), footer = el.querySelector('.sync-footer').getBoundingClientRect();
            return footer.bottom <= panel.bottom && footer.left >= panel.left && footer.right <= panel.right;
          });
          assert(contained, 'Sync footer must remain inside its panel');
          const names = await page.locator('.console-navigation button').evaluateAll(els => els.map(el => el.getAttribute('aria-label')));
          assert(names.every(Boolean), 'Icon-only navigation must retain accessible names');
        }
        for (const label of [local, cloud]) {
          await page.getByText(label, { exact: true }).click();
          const dialog = page.locator('dialog.sync-drawer[open]');
          const row = dialog.locator('button[aria-expanded]').first();
          await row.waitFor();
          await page.waitForTimeout(500);
          await row.focus();
          await page.keyboard.press('Enter');
          assert.equal(await row.getAttribute('aria-expanded'), 'true');
          await page.keyboard.press('Space');
          assert.equal(await row.getAttribute('aria-expanded'), 'false');
          await row.click();
          const bounds = await geometry(dialog);
          assert(!bounds.overflow, 'Long labels must not cause horizontal list overflow');
          assert(bounds.width <= 673 && bounds.left >= 0 && bounds.right <= width, 'Responsive panel bounds');
          assert(bounds.bottom <= height + 1 && bounds.scrollable, 'Long list must scroll inside the viewport');
          if (mobile) assert((await dialog.getByRole('button', { name: restore, exact: true }).boundingBox()).height >= 44);
          await dialog.getByRole('button', { name: restore, exact: true }).click();
          const confirmation = page.locator('dialog[open]').last();
          assert.equal(await page.locator('dialog[open]').count(), 2, 'Restore still requires confirmation');
          await confirmation.getByRole('button', { name: cancel, exact: true }).click();
          assert.equal(await page.locator('dialog[open]').count(), 1, 'Cancel returns to the list');
          if (label === local) {
            await dialog.getByRole('button', { name: en ? 'Delete' : '删除', exact: true }).click();
            await dialog.getByRole('button', { name: cancel, exact: true }).click();
            assert.equal(await dialog.locator('button[aria-expanded]').count(), 12, 'Cancel must preserve snapshots');
          }
          await dialog.screenshot({ path: path.join(output, `${width}-${height}-${largeText}-${language}-${label === local ? 'local' : 'cloud'}.png`) });
          await page.keyboard.press('Escape');
          assert.equal(await page.locator('dialog[open]').count(), 0);
          results.push({ width, height, mobile, largeText, language, theme, label, ...bounds });
        }
      }
      console.log(`PASS ${width}x${height}${largeText ? ' large text' : ''}`);
    } finally { await context.close(); }
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
