// Sample from first DOM render, before locator waits can hide entrance motion.
const { chromium } = require(process.env.MARKSYNC_PLAYWRIGHT || 'playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = path.resolve(process.env.MARKSYNC_VALIDATION_OUTPUT || 'docs/validation/2026-09-20-popup-startup');
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const results = [];
  for (const width of [360, 320, 390, 430]) {
    const extension = path.resolve('apps/chrome-extension/dist');
    const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'marksync-startup-')), {
      channel: 'msedge', headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], viewport: { width, height: 740 },
      ...(width !== 360 ? { isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/153.0.0.0 Mobile Safari/537.36' } : {}),
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    try {
      const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
      await worker.evaluate(() => chrome.storage.local.set({ app_language: 'en', auto_sync_enabled: false }));
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.startupFrames = [];
        const end = performance.now() + 2000;
        function sample() {
          const view = document.querySelector('.console-sync-view');
          if (view) {
            const elements = [view, ...view.children, view.parentElement];
            window.startupFrames.push({ transforms: elements.map(el => getComputedStyle(el).transform),
              countHeights: [...view.querySelectorAll('.text-3xl')].map(el => el.getBoundingClientRect().height) });
          }
          if (performance.now() < end) requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        await page.goto(worker.url().split('/').slice(0, 3).join('/') + '/index.html');
        await page.waitForTimeout(2100);
        const frames = await page.evaluate(() => window.startupFrames);
        assert(frames.length > 20);
        assert(frames.every(f => f.transforms.every(t => t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)')),
          'Startup must not translate the main view or its cards');
        assert(frames.every(f => f.countHeights.every(h => h === 36)), 'Loading/count row height must stay fixed');
        results.push({ width, attempt, frames: frames.length, translatedFrames: 0, countHeight: 36 });
      }
    } finally { await context.close(); }
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(results);
})().catch(error => { console.error(error); process.exitCode = 1; });
