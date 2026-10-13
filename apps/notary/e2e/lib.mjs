import { chromium } from 'playwright-core';

/**
 * Shared helpers for the browser flows.
 *
 * Configuration comes from the environment so the same scripts run on a
 * laptop and in CI:
 *
 *   E2E_BASE_URL   where the built app is listening (default http://127.0.0.1:3100)
 *   CHROMIUM_PATH  a Chromium to use instead of the one Playwright manages
 */

export const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100';
export const DEMO = { email: 'demo@notarydesk.test', password: 'notary-demo-2026' };

export async function launch(options = {}) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...options,
  });
  return { browser, context };
}

/** Collect everything that would show up red in a real user's console. */
export function watch(page, problems, label = '') {
  const tag = (message) => `${label ? `[${label}] ` : ''}${message}`;
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(tag(`console.error: ${message.text()}`));
  });
  page.on('pageerror', (error) => problems.push(tag(`pageerror: ${error.message}`)));
  page.on('response', (response) => {
    const status = response.status();
    // 3xx are redirects the app issues on purpose.
    if (status >= 400) problems.push(tag(`HTTP ${status} ${response.url()}`));
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? '';
    // Navigations that Next aborts while redirecting are not failures.
    if (!failure.includes('ERR_ABORTED')) {
      problems.push(tag(`requestfailed: ${request.url()} ${failure}`));
    }
  });
}

export async function login(page, credentials = DEMO) {
  await page.goto(`${BASE}/sign-in`);
  await page.fill('input[name=email]', credentials.email);
  await page.fill('input[name=password]', credentials.password);
  await Promise.all([page.waitForURL(`${BASE}/dashboard`), page.click('button[type=submit]')]);
}

export function check(results, name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition || !detail ? '' : `\n        ${detail}`}`);
}

export function summarize(results, problems) {
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (problems.length) {
    console.log(`\n${problems.length} problem(s) seen by the browser:`);
    for (const problem of [...new Set(problems)]) console.log(`  - ${problem}`);
  }
  return failed.length === 0 && problems.length === 0;
}
