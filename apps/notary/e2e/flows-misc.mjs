import { BASE, check, launch, login, summarize, watch } from './lib.mjs';
import { DEMO_ID, scalar, sql } from './db.mjs';

const results = [];
const problems = [];
const { browser, context } = await launch();
const page = await context.newPage();
watch(page, problems);
await login(page);
const demoId = DEMO_ID();
const main = page.locator('main');
const nyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// ---------------------------------------------------------------------------
// Mileage: today's date on the notary's calendar, and a fractional IRS rate
// ---------------------------------------------------------------------------
await page.goto(`${BASE}/billing/mileage`);
check(results, 'the mileage form defaults to today on the notary’s calendar, not the server’s', (await page.inputValue('#date')) === nyToday(), `${await page.inputValue('#date')} vs ${nyToday()}`);

await page.fill('#purpose', 'E2E decimal rate');
await page.fill('#miles', '10');
await page.fill('#ratePerMileCents', '72.5');
await page.locator('main form').filter({ has: page.locator('#purpose') }).locator('button[type=submit]').click();
await page.waitForTimeout(2000);
const stored = scalar(`select "ratePerMileCents" from "MileageEntry" where purpose='E2E decimal rate'`);
check(results, 'the IRS half-cent rate (72.5¢) is stored exactly, not rounded to 73 or rejected', stored === '72.5', String(stored));
check(results, 'a successful log clears the form for the next trip', (await page.inputValue('#purpose')) === '');
const bodyText = await main.innerText();
check(results, 'the entry shows its value, $7.25 for 10 miles', bodyText.includes('$7.25'), bodyText.slice(0, 200));
sql(`delete from "MileageEntry" where purpose='E2E decimal rate'`);

// Profile default rate takes a fraction too.
await page.goto(`${BASE}/settings`);
await page.fill('[name=mileageRateCents]', '72.5');
await page.locator('main form').filter({ has: page.locator('[name=mileageRateCents]') }).locator('button[type=submit]').click();
await page.waitForTimeout(1500);
check(results, 'the profile’s default mileage rate accepts 72.5', scalar(`select "mileageRateCents" from "User" where id='${demoId}'`) === '72.5');
sql(`update "User" set "mileageRateCents"=76 where id='${demoId}'`);

// ---------------------------------------------------------------------------
// Commission dates: a date typed is a date shown, and re-saving never drifts it
// ---------------------------------------------------------------------------
await page.goto(`${BASE}/settings/commission`);
const commissionForm = main.locator('form').first();
await page.fill('[name=commissionExpiresOn]', '2027-03-01');
await commissionForm.locator('button[type=submit]').click();
await page.waitForTimeout(1500);
const expiry = scalar(`select to_char("commissionExpiresOn" at time zone 'UTC','YYYY-MM-DD"T"HH24:MI"Z"') from "User" where id='${demoId}'`);
check(results, 'a commission expiry typed as 1 March is stored at noon Eastern (17:00Z)', expiry === '2027-03-01T17:00Z', expiry);
await page.reload();
check(results, 'and reads back as 1 March', (await page.inputValue('[name=commissionExpiresOn]')) === '2027-03-01');
for (let i = 0; i < 3; i += 1) {
  await commissionForm.locator('button[type=submit]').click();
  await page.waitForTimeout(1200);
}
const after = scalar(`select to_char("commissionExpiresOn" at time zone 'UTC','YYYY-MM-DD"T"HH24:MI"Z"') from "User" where id='${demoId}'`);
check(results, 'saving three more times does not walk the date back a day each time', after === '2027-03-01T17:00Z', after);
sql(`update "User" set "commissionExpiresOn" = now() + interval '61 days' where id='${demoId}'`);

// ---------------------------------------------------------------------------
// The journal form: rejection keeps everything, one pass shows every problem
// ---------------------------------------------------------------------------
await page.goto(`${BASE}/journal/new`);
await page.evaluate(() => { document.querySelector('main form').noValidate = true; });
await page.fill('[name=signerName]', 'Retention Test');
await page.fill('[name=performedAt]', '2026-10-12T21:30');
await page.selectOption('[name=actType]', 'JURAT');
await page.selectOption('[name=identityMethod]', 'CREDIBLE_WITNESS');
await page.fill('[name=documentType]', '');
await main.locator('form button[type=submit]').last().click();
await page.waitForTimeout(1800);
const journalErrors = (await main.locator('form .text-red-600, form [role=alert]').allInnerTexts()).join(' | ');
check(results, 'a journal entry with a blank document type AND a credible-witness method with no witness reports both', /Document type is required/.test(journalErrors) && /credible identifying witness/i.test(journalErrors), journalErrors);
check(results, 'the signer name typed is still there', (await page.inputValue('[name=signerName]')) === 'Retention Test');
check(results, 'so is the act type chosen in a select', (await page.locator('[name=actType]').inputValue()) === 'JURAT');
check(results, 'and the identification method', (await page.locator('[name=identityMethod]').inputValue()) === 'CREDIBLE_WITNESS');
check(results, 'and the time of the act', (await page.inputValue('[name=performedAt]')) === '2026-10-12T21:30');
check(results, 'nothing was added to the sealed journal by the rejected attempt', scalar(`select count(*) from "JournalEntry" where "userId"='${demoId}'`) === '12');

// A valid entry: 9:30 pm Eastern on 12 Oct is 01:30Z on 13 Oct.
await page.fill('[name=documentType]', 'E2E Affidavit');
await page.fill('[name=credibleWitnessName]', 'Witness Person');
await main.locator('form button[type=submit]').last().click();
await page.waitForURL(/\/journal(\/[a-z0-9]+)?$/, { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(1500);
const entry = sql(`select "sequenceNumber", to_char("performedAt" at time zone 'UTC','YYYY-MM-DD"T"HH24:MI"Z"'), "documentType" from "JournalEntry" where "documentType"='E2E Affidavit'`)[0] ?? [];
check(results, 'a valid entry is sealed with the next sequence number (13)', entry[0] === '13', JSON.stringify(entry));
check(results, '9:30 pm Eastern is stored as 01:30Z the next day, with the server in UTC', entry[1] === '2026-10-13T01:30Z', entry[1]);

// The date filter uses the notary's calendar: that 9:30 pm entry belongs to 12 October.
await page.goto(`${BASE}/journal?from=2026-10-12&to=2026-10-12`);
check(results, 'filtering the journal to 12 October finds the 9:30 pm entry (it is 13 Oct in UTC)', (await main.innerText()).includes('E2E Affidavit'));
await page.goto(`${BASE}/journal?from=2026-10-13&to=2026-10-13`);
check(results, 'and filtering to 13 October does not', !(await main.innerText()).includes('E2E Affidavit'));
const csv = await page.request.get(`${BASE}/journal/export?from=2026-10-12&to=2026-10-12`);
check(results, 'the CSV export agrees', (await csv.text()).includes('E2E Affidavit'));
const bad = await page.goto(`${BASE}/journal?from=garbage&to=2026-02-31`);
check(results, 'a hand-edited date range shows the journal instead of an error page', bad?.status() === 200);

const real = problems.filter((p) => !/Failed to load resource: the server responded with a status of 404/.test(p));
const ok = summarize(results, real);
await browser.close();
process.exit(ok ? 0 : 1);
