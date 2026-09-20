// Real extension UI, disposable profiles; synthetic tall content isolates scrollbar changes.
const { chromium } = require(process.env.MARKSYNC_PLAYWRIGHT || 'playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const baseline = process.argv.includes('--baseline');
const output = path.resolve(process.env.MARKSYNC_VALIDATION_OUTPUT || 'docs/validation/2026-09-20-drawer-width');
const extension = path.resolve('apps/chrome-extension/dist');
const results = [];
async function sample(page, action) {
  await page.evaluate(() => {
    window.widthFrames = [];
    const end = performance.now() + 900;
    function frame() {
      const dialog = document.querySelector('dialog[open]');
      const panel = dialog?.querySelector('[style*="transform"]');
      if (panel) window.widthFrames.push({ panel: panel.getBoundingClientRect().width,
        dialog: dialog.clientWidth, viewport: innerWidth, overflow: dialog.scrollHeight > dialog.clientHeight });
      if (performance.now() < end) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
  await action();
  await page.waitForTimeout(1000);
  return page.evaluate(() => window.widthFrames);
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  for (const [width, height, mobile, fullTab] of [[360, 560, false, false], [320, 640, true, false],
    [390, 740, true, false], [390, 320, true, false], [1280, 900, false, true], [390, 740, true, true]]) {
    const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'marksync-width-')), {
      channel: 'msedge', headless: true, ignoreDefaultArgs: ['--hide-scrollbars'],
      viewport: { width, height }, isMobile: mobile, hasTouch: mobile,
      ...(mobile ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/153.0.0.0 Mobile Safari/537.36' } : {}),
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    try {
      const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
      await worker.evaluate(() => chrome.storage.local.set({ app_language: 'en', auto_sync_enabled: false,
        scheduled_sync_enabled: false, storage_type: 'webdav', webdav_url: 'https://dav.example.com',
        webdav_username: 'fixture', webdav_password: 'fixture' }));
      const page = await context.newPage();
      await page.goto(worker.url().split('/').slice(0, 3).join('/') + '/index.html' + (fullTab ? '?mode=tab' : ''));
      await page.getByText('Local bookmarks', { exact: true }).waitFor();
      await page.waitForTimeout(400);
      for (const label of ['Local bookmarks', 'Cloud backup', 'View local snapshots']) {
        const frames = await sample(page, () => page.getByText(label, { exact: true }).click());
        assert(frames.length > 10, 'Must sample the opening animation');
        const widths = frames.map(f => f.panel);
        const shift = Math.max(...widths) - Math.min(...widths);
        const scroller = page.locator('dialog[open] .custom-scrollbar');
        const before = await scroller.evaluate(el => el.clientWidth);
        const after = await scroller.evaluate(el => {
          const filler = document.createElement('div'); filler.dataset.widthFixture = '';
          filler.style.height = '2000px'; el.append(filler); return el.clientWidth;
        });
        const scroll = await scroller.evaluate(el => { el.scrollTop = 300; return el.scrollTop; });
        const overflow = await page.locator('dialog[open]').evaluate(el => el.scrollWidth > el.clientWidth);
        results.push({ width, height, mobile, fullTab, label, shift, before, after, scroll, overflow });
        if (!baseline) {
          assert(shift < 1, `Opening width shift: ${shift}px`);
          assert.equal(after, before, 'Loading long content must not change available width');
          assert(scroll > 0, 'Long content must remain scrollable');
          assert(!overflow, 'No horizontal overflow');
        }
        await scroller.evaluate(el => { el.scrollTop = 0; });
        if (label === 'Local bookmarks') await page.screenshot({ path: path.join(output,
          `${baseline ? 'before' : 'after'}-${width}-${height}-${fullTab}.png`) });
        await scroller.locator('[data-width-fixture]').evaluate(el => el.remove());
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);
        assert.equal(await page.locator('dialog[open]').count(), 0);
      }
      if (fullTab && !baseline) {
        const stable = await page.locator('.console-shell').evaluate(el => {
          const start = el.getBoundingClientRect().width;
          const filler = document.createElement('div'); filler.style.height = '2000px';
          el.append(filler); const tall = el.getBoundingClientRect().width;
          filler.remove(); return { start, tall, end: el.getBoundingClientRect().width };
        });
        assert.equal(stable.start, stable.tall, 'Document scrollbar must not shift console width');
        assert.equal(stable.start, stable.end);
        results.push({ width, height, fullTab, name: 'console-scrollbar', ...stable });
      }
    } finally { await context.close(); }
  }
  fs.writeFileSync(path.join(output, baseline ? 'baseline.json' : 'results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results));
})().catch(error => { console.error(error); process.exitCode = 1; });
