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
const entryForm = main.locator('form').filter({ has: page.locator('[name=category]') }).first();
const errorsText = async () => (await entryForm.locator('.text-red-600, [role=alert]').allInnerTexts()).join(' | ');
const nyDay = (offset) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offset * 86_400_000));
  return parts;
};

// Start from a clean slate for the keys this script touches.
sql(`delete from "SourceApplication" where "userId"='${demoId}' and ("sourceKey"='proof' or name in ('E2E Prospect','E2E Bad'))`);
sql(`delete from "Client" where "userId"='${demoId}' and name like 'Proof%'`);

// ---------------------------------------------------------------------------
// Track a source from the directory (idempotent)
// ---------------------------------------------------------------------------
await page.goto(`${BASE}/find-work`);
const proofCard = page.locator('#proof');
await proofCard.getByRole('button', { name: /Track this/ }).click();
await page.waitForURL(/\/find-work\/pipeline\/[a-z0-9]{10,}$/, { timeout: 10000 }).catch(() => {});
const entryUrl = page.url();
check(results, 'tracking a source opens its pipeline entry', /\/find-work\/pipeline\/[a-z0-9]{10,}$/.test(entryUrl), entryUrl);
check(results, 'one entry now exists for it', scalar(`select count(*) from "SourceApplication" where "userId"='${demoId}' and "sourceKey"='proof'`) === '1');

await page.goto(`${BASE}/find-work`);
const trackedLink = page.locator('#proof').getByRole('link', { name: /Open|pipeline|Tracking|View/i });
check(results, 'the directory now shows it as tracked, not "Track this"', (await page.locator('#proof').getByRole('button', { name: /Track this/ }).count()) === 0);

// ---------------------------------------------------------------------------
// Status changes stamp dates and suggest a follow-up on the notary's calendar
// ---------------------------------------------------------------------------
await page.goto(entryUrl);
await page.selectOption('[name=status]', 'APPLIED');
await entryForm.locator('button[type=submit]').click();
await page.waitForTimeout(1500);
const follow = sql(`select to_char(("nextFollowUpOn" at time zone 'UTC') at time zone 'America/New_York','YYYY-MM-DD HH24:MI'), "appliedOn" is not null from "SourceApplication" where "userId"='${demoId}' and "sourceKey"='proof'`)[0] ?? [];
check(results, 'moving to Applied suggests a follow-up a week out, at noon on the notary’s calendar', follow[0] === `${nyDay(7)} 12:00`, `${follow[0]} (wanted ${nyDay(7)} 12:00)`);
check(results, 'and stamps the date applied', follow[1] === 't');
await page.reload();
check(results, 'the form shows that follow-up date back unchanged (no day drift)', (await page.inputValue('[name=nextFollowUpOn]')) === nyDay(7), await page.inputValue('[name=nextFollowUpOn]'));

// Saving again must not move the date.
await entryForm.locator('button[type=submit]').click();
await page.waitForTimeout(1200);
const again = scalar(`select to_char(("nextFollowUpOn" at time zone 'UTC') at time zone 'America/New_York','YYYY-MM-DD') from "SourceApplication" where "userId"='${demoId}' and "sourceKey"='proof'`);
check(results, 're-saving does not shift the follow-up date', again === nyDay(7), again);

// Declined clears the follow-up.
await page.selectOption('[name=status]', 'DECLINED');
await entryForm.locator('button[type=submit]').click();
await page.waitForTimeout(1200);
check(results, 'declining clears the follow-up, so a closed entry never nags', scalar(`select "nextFollowUpOn" is null from "SourceApplication" where "userId"='${demoId}' and "sourceKey"='proof'`) === 't');

// ---------------------------------------------------------------------------
// Convert to a client
// ---------------------------------------------------------------------------
await page.selectOption('[name=status]', 'APPROVED');
await entryForm.locator('button[type=submit]').click();
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Convert to a client' }).click();
await page.waitForURL(/\/clients\/[a-z0-9]{10,}$/, { timeout: 10000 }).catch(() => {});
check(results, 'converting opens the new client', /\/clients\/[a-z0-9]{10,}$/.test(page.url()), page.url());
const converted = sql(`select a.status, a."clientId" is not null, c.name from "SourceApplication" a join "Client" c on c.id = a."clientId" where a."userId"='${demoId}' and a."sourceKey"='proof'`)[0] ?? [];
check(results, 'the entry becomes Receiving work and points at the client', converted[0] === 'ACTIVE' && converted[1] === 't', JSON.stringify(converted));
await page.goto(entryUrl);
check(results, 'a converted entry offers the client instead of converting again', (await page.getByRole('button', { name: 'Convert to a client' }).count()) === 0 && (await page.getByRole('link', { name: 'Open the client' }).count()) === 1);

// ---------------------------------------------------------------------------
// Own prospect: validation reports everything at once; a clean one is stored tidily
// ---------------------------------------------------------------------------
await page.goto(`${BASE}/find-work/pipeline/new`);
await page.evaluate(() => { document.querySelector('main form').noValidate = true; });
await page.fill('[name=name]', 'E2E Bad');
await page.fill('[name=website]', 'javascript:alert(1)');
await page.fill('[name=contactEmail]', 'not an email');
await page.fill('[name=contactPhone]', '12');
await page.fill('[name=notes]', 'keep me');
await entryForm.locator('button[type=submit]').click();
await page.waitForTimeout(1500);
const badErrors = await errorsText();
check(results, 'a bad website, email and phone are all reported in one pass', /web address/i.test(badErrors) && /valid email/i.test(badErrors) && /phone number/i.test(badErrors), badErrors);
check(results, 'a javascript: link is refused', /web address/i.test(badErrors));
check(results, 'the notes typed alongside are not wiped', (await page.inputValue('[name=notes]')) === 'keep me');
check(results, 'nothing was stored for the bad one', scalar(`select count(*) from "SourceApplication" where "userId"='${demoId}' and name='E2E Bad'`) === '0');

await page.fill('[name=name]', 'E2E Prospect');
await page.fill('[name=website]', 'example.com/vendors');
await page.fill('[name=contactEmail]', 'Closer@Example.com');
await page.fill('[name=contactPhone]', '(412) 555-0100');
await page.selectOption('[name=status]', 'APPLIED');
await entryForm.locator('button[type=submit]').click();
await page.waitForURL(/\/find-work\/pipeline\/[a-z0-9]{10,}$/, { timeout: 10000 }).catch(() => {});
const prospect = sql(`select website, "contactEmail", status, to_char(("nextFollowUpOn" at time zone 'UTC') at time zone 'America/New_York','YYYY-MM-DD') from "SourceApplication" where "userId"='${demoId}' and name='E2E Prospect'`)[0] ?? [];
check(results, 'a bare domain gets https:// in front of it', prospect[0] === 'https://example.com/vendors', prospect[0]);
check(results, 'the email is lower-cased', prospect[1] === 'closer@example.com', prospect[1]);
check(results, 'and a follow-up is suggested for a new Applied prospect', prospect[3] === nyDay(7), `${prospect[3]} vs ${nyDay(7)}`);
check(results, 'the pipeline lists it', (await (async () => { await page.goto(`${BASE}/find-work/pipeline`); return (await main.innerText()).includes('E2E Prospect'); })()));

// ---------------------------------------------------------------------------
// The manual checklist changes readiness everywhere
// ---------------------------------------------------------------------------
sql(`update "User" set "readinessChecklist"='' where id='${demoId}'`);
await page.goto(`${BASE}/find-work`);
const blue = page.locator('#bluenotary');
const percentBefore = (await blue.innerText()).match(/(\d+)%/)?.[1];
await page.getByLabel(/Approved for electronic \/ remote notarization/).check();
await page.getByRole('button', { name: 'Save checklist' }).click();
await page.waitForTimeout(1500);
await page.reload();
const percentAfter = (await page.locator('#bluenotary').innerText()).match(/(\d+)%/)?.[1];
check(results, 'ticking "approved for electronic notarization" raises BlueNotary’s readiness', Number(percentAfter) > Number(percentBefore), `${percentBefore}% -> ${percentAfter}%`);
check(results, 'and it is stored as a manual requirement only', scalar(`select "readinessChecklist" from "User" where id='${demoId}'`) === 'ELECTRONIC_NOTARY_APPROVAL', scalar(`select "readinessChecklist" from "User" where id='${demoId}'`));
check(results, 'an automatic requirement (commission) cannot be ticked by hand', (await page.getByLabel(/Active notary commission/).count()) === 0);

// ---------------------------------------------------------------------------
// Delete asks first; the client created from an entry stays
// ---------------------------------------------------------------------------
await page.goto(entryUrl);
page.once('dialog', (dialog) => dialog.accept());
await page.getByRole('button', { name: 'Remove from pipeline' }).click();
await page.waitForURL(`${BASE}/find-work/pipeline`, { timeout: 10000 }).catch(() => {});
check(results, 'removing an entry takes it out of the pipeline', scalar(`select count(*) from "SourceApplication" where "userId"='${demoId}' and "sourceKey"='proof'`) === '0');
check(results, 'but the client made from it stays', scalar(`select count(*) from "Client" where "userId"='${demoId}' and name like 'Proof%'`) === '1');

// Clean up.
sql(`delete from "SourceApplication" where "userId"='${demoId}' and name='E2E Prospect'`);
sql(`delete from "Client" where "userId"='${demoId}' and name like 'Proof%'`);
sql(`update "User" set "readinessChecklist"='PRINTER_SCANNER,W9' where id='${demoId}'`);

const real = problems.filter((p) => !/Failed to load resource: the server responded with a status of 404/.test(p));
const ok = summarize(results, real);
await browser.close();
process.exit(ok ? 0 : 1);
