import { BASE, check, launch, login, summarize, watch } from './lib.mjs';

/**
 * Walk every page a signed-in notary can reach and confirm each renders with
 * its heading, with nothing red in the console and no failed requests.
 */
const { browser, context } = await launch();
const page = await context.newPage();
const problems = [];
const results = [];
watch(page, problems);

await login(page);

const PAGES = [
  ['/dashboard', /Good day, Dana/],
  ['/journal', /Journal/],
  ['/journal/new', /Record a notarial act|New journal entry|notarial act/i],
  ['/journal/verify', /integrity|Verify|chain/i],
  ['/journal/inspect', /inspection|Inspect/i],
  ['/signings', /Signings/],
  ['/signings/new', /Schedule|signing/i],
  ['/clients', /Clients/],
  ['/clients/new', /client/i],
  ['/find-work', /Find work/],
  ['/find-work/pipeline', /My pipeline/],
  ['/find-work/pipeline/new', /Add a prospect/],
  ['/find-work/requests', /Requests/],
  ['/billing', /Billing|Invoices/],
  ['/billing/fees', /Fee schedule|fees/i],
  ['/billing/mileage', /Mileage/],
  ['/billing/invoices/new', /invoice/i],
  ['/reports', /Reports|Schedule C|Tax/i],
  ['/certificates', /Certificate/i],
  ['/settings', /Settings|Profile/i],
  ['/settings/commission', /Commission/],
  ['/settings/request-link', /Request link/],
  ['/settings/integrations', /Integrations/],
];

for (const [path, heading] of PAGES) {
  const response = await page.goto(`${BASE}${path}`);
  const text = await page.locator('main').innerText().catch(() => '');
  check(
    results,
    `${path} renders`,
    response?.status() === 200 && heading.test(text),
    `status=${response?.status()} text=${text.slice(0, 120).replace(/\n/g, ' | ')}`,
  );
}

console.log('');
const ok = summarize(results, problems);
await browser.close();
process.exit(ok ? 0 : 1);
