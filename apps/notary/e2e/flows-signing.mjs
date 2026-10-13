import { BASE, check, launch, login, summarize, watch } from './lib.mjs';
import { scalar, sql } from './db.mjs';

const results = [];
const problems = [];
const { browser, context } = await launch();
const page = await context.newPage();
watch(page, problems);
await login(page);

// --- A rejected submission: do the typed values (including selects) survive? ---
await page.goto(`${BASE}/signings/new`);
await page.evaluate(() => { document.querySelector('main form').noValidate = true; });
const typeOptions = await page.locator('select[name=type] option').evaluateAll((els) => els.map((e) => e.value));
await page.fill('[name=title]', '');
await page.fill('[name=signerName]', 'Retention Check');
await page.selectOption('select[name=type]', typeOptions[2]);
await page.click('main button[type=submit]');
await page.waitForSelector('text=/required/i', { timeout: 8000 }).catch(() => {});
check(results, 'a signing with no title is rejected on the server', (await page.locator('main').innerText()).includes('required'));
check(
  results,
  'the typed text survives the rejection',
  (await page.inputValue('[name=signerName]')) === 'Retention Check',
  `signerName=${await page.inputValue('[name=signerName]')}`,
);
check(
  results,
  'the chosen option in a select survives the rejection',
  (await page.locator('select[name=type]').inputValue()) === typeOptions[2],
  `type=${await page.locator('select[name=type]').inputValue()} wanted=${typeOptions[2]}`,
);

// --- The notary's clock, with the server running in UTC ---
await page.goto(`${BASE}/signings/new`);
await page.fill('[name=title]', 'E2E Clock Check');
await page.fill('[name=signerName]', 'Clock Tester');
await page.fill('[name=scheduledAt]', '2026-10-20T14:30');
await page.click('main button[type=submit]');
await page.waitForURL((url) => /\/signings\/[a-z0-9]+$/.test(url.pathname) && !url.pathname.endsWith('/new'), { timeout: 10000 }).catch(() => {});
const signingUrl = page.url();
check(results, 'a valid signing is created and opened', /\/signings\/[a-z0-9]+$/.test(signingUrl) && !signingUrl.endsWith('/new'), signingUrl);
const shown = await page.locator('main').innerText();
check(results, 'the signing page shows 2:30 PM on the notary’s clock', /Oct 20, 2026,\s*2:30\s*PM/.test(shown), shown.slice(0, 300).replace(/\n/g, ' | '));
const stored = scalar(`select to_char("scheduledAt" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') from "Signing" where title='E2E Clock Check'`);
check(results, 'it is stored as 18:30Z (14:30 Eastern), not 14:30Z', stored === '2026-10-20T18:30Z', stored);

// Editing it must not move it.
const signingId = signingUrl.split('/').pop();
await page.goto(`${BASE}/signings/${signingId}`);
const editForm = page.locator('main form').filter({ has: page.locator('[name=scheduledAt]') });
if ((await editForm.count()) > 0) {
  await page.fill('[name=signerName]', 'Clock Tester Edited');
  await editForm.locator('button[type=submit]').click();
  await page.waitForTimeout(1500);
  const after = scalar(`select to_char("scheduledAt" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') from "Signing" where id='${signingId}'`);
  check(results, 'saving the signing again does not move it', after === '2026-10-20T18:30Z', after);
} else {
  console.log('(no inline edit form on the signing page; skipping the re-save check)');
}

// Clean up.
sql(`delete from "Signing" where title='E2E Clock Check'`);
const ok = summarize(results, problems);
await browser.close();
process.exit(ok ? 0 : 1);
