// Test-only setup: the real extension manager preauthorizes a loopback host.
// The actual panel button must still activate the optional permission.
module.exports = async function authorizeFixture(context, page, targetUrl) {
  const url = new URL(targetUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Fixture host must be loopback');
  const manager = await context.newPage();
  try {
    await manager.goto('edge://extensions/');
    await manager.evaluate(({ id, origin }) => chrome.developerPrivate.addHostPermission(id, origin),
      { id: new URL(page.url()).host, origin: `${url.protocol}//${url.hostname}/*` });
    await page.getByRole('button', { name: 'Authorize site access', exact: true }).click();
    await page.waitForFunction(origin => chrome.permissions.contains({ origins: [origin] }), `${url.protocol}//${url.hostname}/*`);
  } finally { await manager.close(); }
};
