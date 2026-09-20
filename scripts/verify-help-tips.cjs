// Run after build: MARKSYNC_PLAYWRIGHT may point to the installed Playwright module.
const { chromium } = require(process.env.MARKSYNC_PLAYWRIGHT || 'playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const extension = path.resolve('apps/chrome-extension/dist');
  for (const [width, height, mobile, fullTab] of [[360,560,false,false], [320,640,true,false], [390,740,true,false], [1280,900,false,true]]) {
    const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'marksync-help-')), {
      channel: 'msedge', headless: true, viewport: { width, height }, isMobile: mobile, hasTouch: mobile,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    try {
      const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
      await worker.evaluate(() => chrome.storage.local.set({ app_language: 'zh-CN', auto_sync_enabled: false }));
      const page = await context.newPage();
      await page.goto(worker.url().split('/').slice(0,3).join('/') + '/index.html' + (fullTab ? '?mode=tab' : ''));
      if (fullTab) await page.locator('.console-navigation button').last().click();
      else await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.waitForTimeout(300);
      await page.getByText(fullTab ? '同步策略' : '同步策略与范围', { exact: true }).filter({ visible: true }).click();
      await page.waitForTimeout(400);
      for (let index = 0; index < 3; index++) {
        const button = page.getByRole('button', { name: '查看说明', exact: true }).nth(index);
        await button.scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        const tip = page.getByRole('tooltip');
        async function check() {
          await tip.waitFor({ state: 'visible' });
          assert(!(await tip.innerText()).includes('settings.sync.'), 'Missing translation');
          const rect = await tip.boundingBox();
          assert(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width && rect.y + rect.height <= height, 'Tooltip must fit viewport');
          assert(await button.getAttribute('aria-describedby'), 'Accessible description');
        }
        if (mobile) await button.tap();
        else await button.click();
        await check();
        await page.keyboard.press('Escape');
        await tip.waitFor({ state: 'hidden' });
        if (!mobile) {
          await page.mouse.move(0,0); await button.hover(); await check();
          await page.mouse.move(0,0); await tip.waitFor({ state: 'hidden' });
        }
        await button.evaluate(el => el.blur());
        await button.focus(); await check();
        await page.keyboard.press('Enter'); await check();
        await page.keyboard.press('Escape'); await tip.waitFor({ state: 'hidden' });
      }
      console.log(JSON.stringify({ width, height, mobile, fullTab, tips: 3, result: 'passed' }));
    } finally { await context.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
