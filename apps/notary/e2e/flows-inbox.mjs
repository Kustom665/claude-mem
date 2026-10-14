import { BASE, check, launch, login, summarize, watch } from './lib.mjs';
import { DEMO_ID, scalar, sql } from './db.mjs';

const results = [];
const problems = [];
const { browser, context } = await launch();
const page = await context.newPage();
watch(page, problems);
await login(page);
const demoId = DEMO_ID();

const card = (name) => page.locator('section').filter({ has: page.getByText(name) }).first();
const statusOf = (name) => scalar(`select status from "WorkRequest" where "requesterName"='${name}'`);

// ---------------------------------------------------------------------------
// Links on the card
// ---------------------------------------------------------------------------
await page.goto(`${BASE}/find-work/requests`);
const priya = card('Priya Natarajan');
const hrefs = await priya.locator('a').evaluateAll((els) => els.map((el) => el.getAttribute('href')));
check(results, 'the phone number is a tel: link with a country code', hrefs.includes('tel:+14125550171'), JSON.stringify(hrefs));
check(results, 'with a text-message link beside it', hrefs.includes('sms:+14125550171'));
check(results, 'the email is a mailto: link', hrefs.includes('mailto:priya.natarajan@example.com'));

// ---------------------------------------------------------------------------
// Mark contacted
// ---------------------------------------------------------------------------
await priya.getByRole('button', { name: 'Mark contacted' }).click();
await page.waitForFunction(() => !document.body.innerText.includes('1 new request waiting'), null, { timeout: 8000 }).catch(() => {});
check(results, 'marking a request contacted changes its status', statusOf('Priya Natarajan') === 'CONTACTED', statusOf('Priya Natarajan'));
await page.reload();
check(results, 'and the new-request alert goes away', !(await page.locator('main').innerText()).includes('new request waiting'));

// ---------------------------------------------------------------------------
// Accept: a request becomes a scheduled signing at a sensible time, in the notary's zone
// ---------------------------------------------------------------------------
await card('Priya Natarajan').getByRole('button', { name: 'Accept and schedule' }).click();
await page.waitForURL(/\/signings\/[a-z0-9]+$/, { timeout: 10000 }).catch(() => {});
const signingUrl = page.url();
check(results, 'accepting opens the new signing', /\/signings\/[a-z0-9]{10,}$/.test(signingUrl), signingUrl);

const accepted = sql(
  `select s.title, s.type, s.status, to_char((s."scheduledAt" at time zone 'UTC') at time zone 'America/New_York','YYYY-MM-DD HH24:MI'), s."signerName", s."signerPhone", s.city, regexp_replace(s.notes, '[[:space:]]+', ' ', 'g'), r.status, r."signingId" = s.id
     from "WorkRequest" r join "Signing" s on s.id = r."signingId" where r."requesterName"='Priya Natarajan'`,
)[0] ?? [];
check(results, 'the signing carries the requester’s name, phone and city', accepted[4] === 'Priya Natarajan' && accepted[5]?.includes('555-0171') && accepted[6] === 'Pittsburgh', JSON.stringify(accepted));
check(results, 'its type follows the service (estate planning) and it is scheduled', accepted[1] === 'ESTATE_PLANNING' && accepted[2] === 'SCHEDULED', `${accepted[1]} ${accepted[2]}`);
check(results, 'a "morning" request lands at 9:00 on the notary’s clock', /\s09:00$/.test(accepted[3] ?? ''), accepted[3]);
check(results, 'nothing the requester said is lost: the note keeps their message', (accepted[7] ?? '').includes('Requested through your public request link') && (accepted[7] ?? '').includes('Durable power of attorney'), accepted[7]);
check(results, 'the request is marked accepted and linked to its signing', accepted[8] === 'ACCEPTED' && accepted[9] === 't');
const shown = await page.locator('main').innerText();
check(results, 'the signing page shows 9:00 AM', /9:00\s*AM/.test(shown), shown.slice(0, 200).replace(/\n/g, ' | '));

// An accepted request cannot be flipped back by the status buttons, and shows its link.
await page.goto(`${BASE}/find-work/requests?filter=accepted`);
const acceptedCard = card('Priya Natarajan');
check(results, 'an accepted request offers a link to its signing', (await acceptedCard.getByRole('link', { name: 'Open the signing' }).count()) === 1);
check(results, 'and no longer offers accept/decline', (await acceptedCard.getByRole('button', { name: 'Accept and schedule' }).count()) === 0);

// ---------------------------------------------------------------------------
// Accept without a date: the earliest slot the notice setting allows
// ---------------------------------------------------------------------------
await page.goto(`${BASE}/find-work/requests`);
const beforeAccept = Date.now();
await card('Marcus Bell').getByRole('button', { name: 'Accept and schedule' }).click();
await page.waitForURL(/\/signings\/[a-z0-9]{10,}$/, { timeout: 10000 }).catch(() => {});
const scheduled = new Date(scalar(`select to_char(s."scheduledAt" at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') from "Signing" s join "WorkRequest" r on r."signingId"=s.id where r."requesterName"='Marcus Bell'`));
const hoursAhead = (scheduled.getTime() - beforeAccept) / 3_600_000;
check(results, 'a request with no date is scheduled at least the notice period ahead (12 h)', hoursAhead >= 11.99 && hoursAhead <= 13.1, `${hoursAhead.toFixed(2)} h ahead`);
check(results, 'on the hour', scheduled.getUTCMinutes() === 0 && scheduled.getUTCSeconds() === 0, scheduled.toISOString());

// ---------------------------------------------------------------------------
// Decline / spam / reopen / delete
// ---------------------------------------------------------------------------
sql(`insert into "WorkRequest" (id, "userId", status, "requesterName", "requesterEmail", "preferredContact", service, "signerCount", "preferredWindow", city, state, "postalCode", "createdAt", "updatedAt")
     values ('e2e_req_1','${demoId}','NEW','Dana Decline','dd@example.com','ANY','GENERAL',1,'FLEXIBLE','Pittsburgh','PA','15222', now(), now())`);
await page.goto(`${BASE}/find-work/requests`);
await card('Dana Decline').getByRole('button', { name: 'Decline' }).click();
await page.waitForTimeout(1200);
check(results, 'decline sets the status', statusOf('Dana Decline') === 'DECLINED', statusOf('Dana Decline'));

await page.goto(`${BASE}/find-work/requests?filter=closed`);
await card('Dana Decline').getByRole('button', { name: 'Reopen' }).click();
await page.waitForTimeout(1200);
check(results, 'a declined request can be reopened', statusOf('Dana Decline') === 'NEW', statusOf('Dana Decline'));

await page.goto(`${BASE}/find-work/requests`);
await card('Dana Decline').getByRole('button', { name: 'Spam' }).click();
await page.waitForTimeout(1200);
check(results, 'spam sets the status', statusOf('Dana Decline') === 'SPAM', statusOf('Dana Decline'));

// Delete asks first. Dismiss: nothing happens.
await page.goto(`${BASE}/find-work/requests?filter=closed`);
page.once('dialog', (dialog) => dialog.dismiss());
await card('Dana Decline').getByRole('button', { name: 'Delete' }).click();
await page.waitForTimeout(800);
check(results, 'cancelling the delete confirmation keeps the request', scalar(`select count(*) from "WorkRequest" where "requesterName"='Dana Decline'`) === '1');
page.once('dialog', (dialog) => dialog.accept());
await card('Dana Decline').getByRole('button', { name: 'Delete' }).click();
await page.waitForTimeout(1200);
check(results, 'confirming it erases the stranger’s contact details', scalar(`select count(*) from "WorkRequest" where "requesterName"='Dana Decline'`) === '0');

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------
sql(`insert into "User" (id, email, "passwordHash", name, "timezone", "updatedAt") values ('e2e_other_user','other@example.test','x','Other Notary','America/New_York', now()) on conflict do nothing`);
sql(`insert into "SourceApplication" (id, "userId", name, category, status, "updatedAt") values ('e2e_other_app','e2e_other_user','Their Secret Prospect','OTHER','APPLIED', now()) on conflict do nothing`);
sql(`insert into "WorkRequest" (id, "userId", status, "requesterName", "preferredContact", service, "signerCount", "preferredWindow", "updatedAt") values ('e2e_other_req','e2e_other_user','NEW','Their Private Lead','ANY','GENERAL',1,'FLEXIBLE', now()) on conflict do nothing`);
const response = await page.goto(`${BASE}/find-work/pipeline/e2e_other_app`);
check(results, 'another notary’s pipeline entry is a 404', response?.status() === 404, `status ${response?.status()}`);
await page.goto(`${BASE}/find-work/requests?filter=all`);
check(results, 'another notary’s requests never appear in the inbox', !(await page.locator('main').innerText()).includes('Their Private Lead'));
await page.goto(`${BASE}/find-work/pipeline`);
check(results, 'nor their pipeline entries', !(await page.locator('main').innerText()).includes('Their Secret Prospect'));

// Clean up what this script made. (Accepted signings stay: they are real rows of the demo notary; remove them too.)
sql(`delete from "Signing" where id in (select "signingId" from "WorkRequest" where "requesterName" in ('Priya Natarajan','Marcus Bell'))`);
sql(`delete from "User" where id='e2e_other_user'`);
sql(`delete from "WorkRequest" where "requesterName" in ('Priya Natarajan','Marcus Bell','Dana Decline')`);

const real = problems.filter((p) => !/HTTP 404 .*e2e_other_app/.test(p) && !/Failed to load resource: the server responded with a status of 404/.test(p));
const ok = summarize(results, real);
await browser.close();
process.exit(ok ? 0 : 1);
