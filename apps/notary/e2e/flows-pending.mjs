import { BASE, check, launch, login, summarize, watch } from './lib.mjs';
import { scalar, sql } from './db.mjs';

const results = [];
const problems = [];
const { browser, context } = await launch();
const page = await context.newPage();
watch(page, problems);
await login(page);

// Hold every server-action POST for 1.5 s so the in-between state can be seen.
await page.route('**/*', async (route) => {
  const request = route.request();
  if (request.method() === 'POST' && request.headers()['next-action']) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  await route.continue();
});

await page.goto(`${BASE}/signings/new`);
await page.fill('[name=title]', 'E2E Pending Check');
const button = page.locator('main button[type=submit]');
const before = await button.innerText();
await button.click();
await page.waitForTimeout(500);
const during = await button.innerText().catch(() => '(gone)');
const disabled = await button.isDisabled().catch(() => false);
check(results, 'the button says what it is doing while the action runs', /Saving|Scheduling|…/.test(during) && during !== before, `before="${before}" during="${during}"`);
check(results, 'and is disabled, so a second click cannot double-submit', disabled);

await page.waitForURL((url) => /\/signings\/[a-z0-9]+$/.test(url.pathname) && !url.pathname.endsWith('/new'), { timeout: 15000 }).catch(() => {});
check(results, 'the signing was created once', scalar(`select count(*) from "Signing" where title='E2E Pending Check'`) === '1');
sql(`delete from "Signing" where title='E2E Pending Check'`);

const ok = summarize(results, problems);
await browser.close();
process.exit(ok ? 0 : 1);
