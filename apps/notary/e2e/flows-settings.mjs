import { BASE, check, launch, login, summarize, watch } from './lib.mjs';
import { DEMO_ID, scalar, sql } from './db.mjs';

const results = [];
const problems = [];
const { browser, context } = await launch();
const page = await context.newPage();
watch(page, problems);
await login(page);
const demoId = DEMO_ID();

const form = page.locator('main form').first();
const save = async () => {
  await form.locator('button[type=submit]').click();
  await page.waitForTimeout(1500);
};
const errorsText = async () => (await form.locator('.text-red-600, [role=alert]').allInnerTexts()).join(' | ');
const slugInDb = () => scalar(`select "publicSlug" from "User" where id='${demoId}'`);

await page.goto(`${BASE}/settings/request-link`);

// 1. A normal edit persists and shows on the public page.
await page.fill('[name=publicHeadline]', 'E2E headline for the public page');
await save();
check(results, 'saving shows a confirmation', (await form.innerText()).includes('Saved.'));
check(results, 'the edit is stored', scalar(`select "publicHeadline" from "User" where id='${demoId}'`) === 'E2E headline for the public page');
await page.goto(`${BASE}/n/keystone-mobile-notary`);
check(results, 'and appears on the public page', (await page.locator('body').innerText()).includes('E2E headline for the public page'));

// 2. Slug normalised.
await page.goto(`${BASE}/settings/request-link`);
await page.fill('[name=publicSlug]', 'Keystone Mobile Notary Two!!');
await save();
check(results, 'a slug is normalised to letters, digits and single hyphens', slugInDb() === 'keystone-mobile-notary-two', slugInDb());
const oldUrl = await page.goto(`${BASE}/n/keystone-mobile-notary`);
check(results, 'the old address stops working once the slug changes', oldUrl?.status() === 404, `status ${oldUrl?.status()}`);
const newUrl = await page.goto(`${BASE}/n/keystone-mobile-notary-two`);
check(results, 'and the new address works', newUrl?.status() === 200);

// 3. Conflicts, reserved words, too short — and the typed text survives.
sql(`insert into "User" (id, email, "passwordHash", name, "timezone", "publicSlug", "updatedAt") values ('e2e_slug_owner','slug-owner@example.test','x','Slug Owner','America/New_York','taken-slug', now()) on conflict do nothing`);
await page.goto(`${BASE}/settings/request-link`);
await page.fill('[name=publicHeadline]', 'Typed before a conflict');
await page.fill('[name=publicSlug]', 'taken-slug');
await save();
check(results, 'an address someone else holds is refused', (await errorsText()).includes('already taken'), await errorsText());
check(results, 'the headline typed alongside it is not wiped', (await page.inputValue('[name=publicHeadline]')) === 'Typed before a conflict');
check(results, 'nothing was changed in the database', slugInDb() === 'keystone-mobile-notary-two');

await page.fill('[name=publicSlug]', 'admin');
await save();
check(results, 'a reserved word is refused', (await errorsText()).toLowerCase().includes('reserved'), await errorsText());

await page.fill('[name=publicSlug]', 'ab');
await save();
check(results, 'a too-short address is refused', (await errorsText()).includes('at least'), await errorsText());

// 4. Every problem at once: no address, no services, but "accept" ticked.
await page.fill('[name=publicSlug]', '');
for (const box of await form.locator('input[name=servicesOffered]').all()) await box.uncheck();
await form.locator('input[name=acceptingRequests]').check();
await save();
const both = await errorsText();
check(results, 'switching on with no address AND no service reports both at once', /address/i.test(both) && /at least one service/i.test(both), both);

// 5. Put things back; then expired commission blocks switching on.
await page.goto(`${BASE}/settings/request-link`);
await page.fill('[name=publicSlug]', 'keystone-mobile-notary');
await save();
check(results, 'the address can be put back', slugInDb() === 'keystone-mobile-notary', slugInDb());

sql(`update "User" set "commissionExpiresOn" = now() - interval '2 days', "acceptingRequests" = false where id='${demoId}'`);
await page.goto(`${BASE}/settings/request-link`);
check(results, 'an expired commission shows a warning on the settings page', (await page.locator('main').innerText()).includes('cannot go live'));
await form.locator('input[name=acceptingRequests]').check();
await save();
check(results, 'and refuses to switch the link on', (await errorsText()).toLowerCase().includes('expired'), await errorsText());
check(results, 'the link stays off', scalar(`select "acceptingRequests" from "User" where id='${demoId}'`) === 'f');
sql(`update "User" set "commissionExpiresOn" = now() + interval '61 days' where id='${demoId}'`);

// 6. The phone number: off by default, shown only when chosen.
await page.goto(`${BASE}/settings/request-link`);
await form.locator('input[name=acceptingRequests]').check();
await form.locator('input[name=showPhonePublicly]').check();
await save();
await page.goto(`${BASE}/n/keystone-mobile-notary`);
const withPhone = await page.locator('a[href^="tel:"]').count();
check(results, 'a ticked "show my phone" puts a tel: link on the page', withPhone === 1, `${withPhone} tel links`);
await page.goto(`${BASE}/settings/request-link`);
await form.locator('input[name=showPhonePublicly]').uncheck();
await save();
await page.goto(`${BASE}/n/keystone-mobile-notary`);
check(results, 'and unticking it removes the number again', (await page.locator('a[href^="tel:"]').count()) === 0);

// 7. Fees hidden on request.
await page.goto(`${BASE}/settings/request-link`);
await form.locator('input[name=showFeesPublicly]').uncheck();
await save();
await page.goto(`${BASE}/n/keystone-mobile-notary`);
check(results, 'hiding fees removes the fee list from the public page', !(await page.locator('body').innerText()).includes('Loan signing (full package)'));
await page.goto(`${BASE}/settings/request-link`);
await form.locator('input[name=showFeesPublicly]').check();
await form.locator('input[name=servicesOffered]').first().check();
await save();

// 8. A very long headline is refused rather than stored.
await page.goto(`${BASE}/settings/request-link`);
await page.evaluate(() => document.querySelector('[name=publicHeadline]').removeAttribute('maxlength'));
await page.fill('[name=publicHeadline]', 'x'.repeat(200));
await save();
check(results, 'an over-long headline is refused on the server', (await errorsText()).includes('too long'), await errorsText());

// Restore the demo account's settings.
sql(`update "User" set "publicHeadline"='Mobile notary and loan signing agent in Allegheny County', "publicSlug"='keystone-mobile-notary', "acceptingRequests"=true, "showFeesPublicly"=true, "showPhonePublicly"=false, "servicesOffered"='GENERAL,LOAN_SIGNING,ESTATE_PLANNING,REAL_ESTATE' where id='${demoId}'`);
sql(`delete from "User" where id='e2e_slug_owner'`);

const real = problems.filter((p) => !/Failed to load resource: the server responded with a status of 404/.test(p) && !/HTTP 404 .*\/n\/keystone-mobile-notary$/.test(p));
const ok = summarize(results, real);
await browser.close();
process.exit(ok ? 0 : 1);
