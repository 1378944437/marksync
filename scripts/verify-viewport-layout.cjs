// Unpacked extension: native action popup sizing and mobile viewport layout.
const { chromium } = require(process.env.MARKSYNC_PLAYWRIGHT || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const baseline = process.argv.includes('--baseline');
const extension = path.resolve('apps/chrome-extension/dist');
const output = path.resolve(process.env.MARKSYNC_VALIDATION_OUTPUT || 'docs/validation/2026-09-15-viewport-layout');
const results = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function attachPopup(cdp, targetId) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false });
  let sequence = 0;
  return async (method, params = {}) => {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cdp.off('Target.receivedMessageFromTarget', receive); reject(new Error(method + ' timed out')); }, 10000);
      const receive = event => {
        if (event.sessionId !== sessionId) return;
        const response = JSON.parse(event.message);
        if (response.id !== id) return;
        clearTimeout(timer); cdp.off('Target.receivedMessageFromTarget', receive);
        if (response.error) reject(new Error(JSON.stringify(response.error)));
        else resolve(response.result);
      };
      cdp.on('Target.receivedMessageFromTarget', receive);
      cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
    });
  };
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'marksync-viewport-')),
    { channel: 'msedge', headless: true, viewport: null,
      args: ['--screen-info={1280x900}', '--window-size=1280,900', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  let mobileContext;
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const url = worker.url().split('/').slice(0, 3).join('/') + '/index.html';
    await worker.evaluate(() => chrome.storage.local.set({ app_language: 'en', auto_sync_enabled: false,
      scheduled_sync_enabled: false }));
    for (let attempt = 0; attempt < (baseline ? 1 : 3); attempt++) {
      await context.pages()[0].bringToFront();
      await pause(300);
      await worker.evaluate(() => chrome.action.openPopup());
      await pause(1500);
      const cdp = await context.browser().newBrowserCDPSession();
      const target = (await cdp.send('Target.getTargets')).targetInfos.find(p => p.url.startsWith(url));
      if (!target) throw new Error('Native popup target missing');
      const send = await attachPopup(cdp, target.targetId);
      const readDimensions = () => ({ width: innerWidth, height: innerHeight,
        contentWidth: document.documentElement.scrollWidth, contentHeight: document.documentElement.scrollHeight,
        container: document.querySelector('#root > div')?.getBoundingClientRect().toJSON() });
      const dimensions = (await send('Runtime.evaluate', { expression: `(${readDimensions})()`, returnByValue: true })).result.value;
      results.push({ name: 'native-action-popup', attempt, ...dimensions });
      console.log(JSON.stringify(dimensions));
      const screenshot = await send('Page.captureScreenshot');
      fs.writeFileSync(path.join(output, baseline ? 'popup-before.png' : 'popup-after.png'), Buffer.from(screenshot.data, 'base64'));
      if (!baseline) {
        assert.equal(dimensions.width, 360);
        assert.equal(dimensions.height, 560);
      }
      await send('Runtime.evaluate', { expression: 'window.close()' });
      await pause(300);
    }
    if (!baseline) {
      mobileContext = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'marksync-mobile-')),
        { channel: 'msedge', headless: true, viewport: { width: 390, height: 740 }, isMobile: true, hasTouch: true,
          userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36',
          args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
      const page = await mobileContext.newPage();
      await page.goto(url);
      await page.evaluate(() => chrome.storage.local.set({ app_language: 'en', auto_sync_enabled: false }));
      for (const [width, height] of [[390, 740], [412, 915], [320, 640], [390, 320], [390, 740]]) {
        await page.setViewportSize({ width, height });
        await page.getByRole('button', { name: 'Sync', exact: true }).click();
        await page.getByRole('button', { name: 'Settings', exact: true }).waitFor();
        await pause(500);
        for (const view of ['sync', 'settings']) {
          if (view === 'settings') {
            await page.getByRole('button', { name: 'Settings', exact: true }).click();
            await pause(500);
          }
          const state = await page.locator('.compact-layout').evaluate(el => ({
            width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height,
            bottom: el.getBoundingClientRect().bottom, viewport: innerHeight,
            documentWidth: document.documentElement.scrollWidth,
            touch: matchMedia('(hover: none) and (pointer: coarse)').matches,
            coarse: matchMedia('(pointer: coarse)').matches, hover: matchMedia('(hover: hover)').matches,
            touches: navigator.maxTouchPoints,
          }));
          assert(await page.locator('.mobile-layout').count(), 'Mobile device must use viewport sizing');
          assert.equal(state.width, width);
          assert.equal(state.height, height);
          assert.equal(state.bottom, height, 'No unused area below mobile container');
          assert.equal(state.documentWidth, width, 'No mobile horizontal overflow');
          results.push({ name: 'mobile-fills-viewport', view, ...state });
          if (width === 390 && height === 740) {
            await page.screenshot({ path: path.join(output, `mobile-${view}.png`) });
          }
        }
      }
      await page.close();
    }
  } finally {
    fs.writeFileSync(path.join(output, baseline ? 'baseline.json' : 'results.json'), JSON.stringify(results, null, 2) + '\n');
    await context.close();
    if (mobileContext) await mobileContext.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
