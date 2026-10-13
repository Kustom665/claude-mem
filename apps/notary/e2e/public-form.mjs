import { BASE, check, launch, summarize, watch } from './lib.mjs';
import { scalar, sql } from './db.mjs';

const SLUG = 'keystone-mobile-notary';
const results = [];
const problems = [];
const ignoreProblems = []; // expected 404s etc. are filtered out of `problems` below

const requestCount = () => Number(scalar(`select count(*) from "WorkRequest"`));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fillValid(page, overrides = {}) {
  const values = {
    requesterName: 'Test Requester',
    requesterPhone: '(412) 555-0123',
    requesterEmail: 'requester@example.com',
    documentSummary: 'Car title transfer',
    city: 'Pittsburgh',
    postalCode: '15222',
    ...overrides,
  };
  for (const [name, value] of Object.entries(values)) {
    await page.fill(`[name=${name}]`, value);
  }
  await page.selectOption('[name=service]', 'GENERAL');
  await page.check('[name=consent]');
}

// ---------------------------------------------------------------------------
// Anonymous visitor
// ---------------------------------------------------------------------------
const { browser, context } = await launch({
  extraHTTPHeaders: { 'x-forwarded-for': '203.0.113.77' },
});
const page = await context.newPage();
watch(page, problems);

// 1. The page itself.
let response = await page.goto(`${BASE}/n/${SLUG}`);
check(results, 'public page renders for an anonymous visitor', response?.status() === 200);
const body = await page.locator('body').innerText();
check(results, 'shows the notary name', body.includes('Keystone Mobile Notary'));
check(
  results,
  'shows the Pennsylvania non-attorney statement',
  body.includes('not an attorney licensed to practice law in this Commonwealth'),
);
check(results, 'does not show internal fee notes', !/self-employment/i.test(body));
check(results, 'does not use the word notario', !/notario/i.test(body));
check(results, 'does not show the notary phone by default', !body.includes('555-0148'));
check(results, 'does not show the notary email', !body.includes('demo@notarydesk.test'));
check(
  results,
  'has a hidden honeypot field a person cannot reach',
  (await page.locator('input[name=website]').count()) === 1 &&
    (await page.locator('input[name=website]').evaluate((el) => el.tabIndex)) === -1,
);
check(
  results,
  'has a signed token field',
  /^\d{10,16}\.[0-9a-f]{64}$/.test(await page.locator('input[name=token]').inputValue()),
);

// 2. Canonical slug.
await page.goto(`${BASE}/n/Keystone-Mobile-Notary`);
check(results, 'upper-case slug redirects to the canonical address', page.url() === `${BASE}/n/${SLUG}`, page.url());

// 3. Unknown slug is a 404, and so is a reserved/invalid one.
response = await page.goto(`${BASE}/n/nobody-here`);
check(results, 'unknown slug is a 404', response?.status() === 404, `status ${response?.status()}`);
response = await page.goto(`${BASE}/n/a`);
check(results, 'too-short slug is a 404', response?.status() === 404, `status ${response?.status()}`);

// 4. Signed-in pages are closed to a stranger.
await page.goto(`${BASE}/find-work/requests`);
check(results, 'the inbox redirects a stranger to sign-in', page.url().includes('/sign-in'), page.url());

// 5. Server-side validation, and the typed text surviving a rejected submit.
await page.goto(`${BASE}/n/${SLUG}`);
await page.evaluate(() => {
  const form = document.querySelector('form#request');
  form.noValidate = true;
  for (const el of form.querySelectorAll('[required]')) el.removeAttribute('required');
});
await page.fill('[name=requesterName]', 'Partially Typed');
await page.fill('[name=documentSummary]', 'Something I wrote');
await sleep(2800); // clear the "too fast" gate so validation is what we see
const before = requestCount();
await page.click('button[type=submit]');
await page.waitForSelector('text=/Give a phone number or an email so the notary/', { timeout: 8000 }).catch(() => {});
const afterErrors = await page.locator('form#request').innerText();
check(
  results,
  'an incomplete request is rejected with field messages',
  /Give a phone number or an email/.test(afterErrors) && /City is required/.test(afterErrors),
  afterErrors.slice(0, 400).replace(/\n/g, ' | '),
);
check(results, 'nothing was stored for it', requestCount() === before);
check(
  results,
  'what the visitor typed is still in the form after the error',
  (await page.inputValue('[name=requesterName]')) === 'Partially Typed' &&
    (await page.inputValue('[name=documentSummary]')) === 'Something I wrote',
  `name=${await page.inputValue('[name=requesterName]')} docs=${await page.inputValue('[name=documentSummary]')}`,
);

// 6. Too fast.
await page.goto(`${BASE}/n/${SLUG}`);
await fillValid(page);
const beforeFast = requestCount();
await page.click('button[type=submit]'); // well inside 2.5 s of the page loading
await page.waitForSelector('text=/That was quick/', { timeout: 8000 }).catch(() => {});
check(
  results,
  'a form sent faster than a person could fill it is refused',
  (await page.locator('form#request').innerText()).includes('That was quick'),
);
check(results, 'nothing was stored for the fast one', requestCount() === beforeFast);

// 6b. ...and the same form goes through once a human-scale time has passed.
await sleep(2600);
await page.click('button[type=submit]');
await page.waitForURL(`${BASE}/n/${SLUG}/thanks`, { timeout: 10000 }).catch(() => {});
check(results, 'a valid request reaches the thank-you page', page.url().endsWith('/thanks'), page.url());
check(results, 'one request was stored', requestCount() === beforeFast + 1);

const stored = sql(
  `select "requesterName","requesterPhone","preferredContact","service","state","status","ipHash" is not null from "WorkRequest" where "requesterName"='Test Requester' order by "createdAt" desc limit 1`,
)[0];
check(
  results,
  'the stored request has the right fields, status NEW and a hashed (not raw) address',
  stored?.[0] === 'Test Requester' && stored?.[5] === 'NEW' && stored?.[6] === 't',
  JSON.stringify(stored),
);
check(
  results,
  'the raw address is not stored anywhere',
  scalar(`select count(*) from "WorkRequest" where "ipHash" like '%203.0.113%'`) === '0',
);

// 7. Honeypot: pretend success, store nothing.
await page.goto(`${BASE}/n/${SLUG}`);
await fillValid(page, { requesterName: 'Bot Filled' });
await page.evaluate(() => {
  document.querySelector('input[name=website]').value = 'http://spam.example';
});
await sleep(2800);
const beforeBot = requestCount();
await page.click('button[type=submit]');
await page.waitForURL(`${BASE}/n/${SLUG}/thanks`, { timeout: 10000 }).catch(() => {});
check(results, 'a honeypot hit is shown the thank-you page (so a bot learns nothing)', page.url().endsWith('/thanks'), page.url());
check(results, 'but nothing was stored', requestCount() === beforeBot);

// 8. A tampered token is refused.
await page.goto(`${BASE}/n/${SLUG}`);
await fillValid(page, { requesterName: 'Forged Token' });
await page.evaluate(() => {
  const token = document.querySelector('input[name=token]');
  token.value = token.value.replace(/.$/, (c) => (c === '0' ? '1' : '0'));
});
await sleep(2800);
const beforeForged = requestCount();
await page.click('button[type=submit]');
await page.waitForSelector('text=/could not verify/i', { timeout: 8000 }).catch(() => {});
check(
  results,
  'a forged token is refused',
  (await page.locator('form#request').innerText()).includes('could not verify'),
);
check(results, 'nothing was stored for the forged one', requestCount() === beforeForged);

// 9. A service the notary does not offer is refused even if the form is edited.
await page.goto(`${BASE}/n/${SLUG}`);
await fillValid(page, { requesterName: 'Wrong Service' });
await page.evaluate(() => {
  const select = document.querySelector('select[name=service]');
  const option = document.createElement('option');
  option.value = 'INTERNATIONAL';
  option.textContent = 'x';
  select.appendChild(option);
  select.value = 'INTERNATIONAL';
});
await sleep(2800);
const beforeService = requestCount();
await page.click('button[type=submit]');
await page.waitForSelector('text=/does not offer/i', { timeout: 8000 }).catch(() => {});
check(
  results,
  'a service the notary does not offer is refused',
  (await page.locator('form#request').innerText()).includes('does not offer'),
);
check(results, 'nothing was stored for it', requestCount() === beforeService);

// 10. Per-address rate limit: three an hour. One is already stored from this address.
let accepted = 1;
let refused = false;
for (let attempt = 0; attempt < 4 && !refused; attempt += 1) {
  await page.goto(`${BASE}/n/${SLUG}`);
  await fillValid(page, { requesterName: `Rate Test ${attempt}` });
  await sleep(2800);
  await page.click('button[type=submit]');
  await Promise.race([
    page.waitForURL(`${BASE}/n/${SLUG}/thanks`, { timeout: 10000 }),
    page.waitForSelector('text=/several requests/i', { timeout: 10000 }),
  ]).catch(() => {});
  if (page.url().endsWith('/thanks')) accepted += 1;
  else if ((await page.locator('form#request').innerText()).includes('several requests')) refused = true;
}
check(results, 'the per-address limit kicks in after three requests', refused && accepted === 3, `accepted=${accepted} refused=${refused}`);

// 11. Switch the link off: the page says so and the form cannot be used.
sql(`update "User" set "acceptingRequests" = false where email = 'demo@notarydesk.test'`);
await page.goto(`${BASE}/n/${SLUG}`);
check(
  results,
  'a paused link shows a friendly unavailable notice and no form',
  (await page.locator('body').innerText()).includes('not taking online requests') &&
    (await page.locator('form#request').count()) === 0,
);
sql(`update "User" set "acceptingRequests" = true where email = 'demo@notarydesk.test'`);

// 12. An expired commission takes the page down.
sql(`update "User" set "commissionExpiresOn" = now() - interval '3 days' where email = 'demo@notarydesk.test'`);
await page.goto(`${BASE}/n/${SLUG}`);
check(
  results,
  'an expired commission takes the public page down',
  (await page.locator('body').innerText()).includes('not taking online requests'),
);
sql(`update "User" set "commissionExpiresOn" = now() + interval '61 days' where email = 'demo@notarydesk.test'`);

// Clean up what this script created.
sql(`delete from "WorkRequest" where "requesterName" in ('Test Requester','Rate Test 0','Rate Test 1','Rate Test 2','Rate Test 3','Bot Filled','Forged Token','Wrong Service')`);

// Expected failures (the deliberate 404s) are not problems.
const real = problems.filter((p) => !/HTTP 404 .*\/n\/(nobody-here|a)\b/.test(p) && !/Failed to load resource: the server responded with a status of 404/.test(p));
const ok = summarize(results, real);
await browser.close();
process.exit(ok ? 0 : 1);
