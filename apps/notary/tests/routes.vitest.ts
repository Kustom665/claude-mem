import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every internal link must lead somewhere.
 *
 * This exists because it once did not: the repository's root .gitignore excludes
 * any directory called `reports/`, so the /reports page was never committed.
 * Nothing failed — the build passes without it, typechecking cannot see a route
 * nobody imports — and the app shipped with a "Reports" tab in its navigation
 * that 404ed. The page existed only on the machine that wrote it.
 *
 * Reading the route tree from disk catches that on any clean checkout, which is
 * exactly where CI runs.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APP_DIR = path.join(ROOT, 'src', 'app');
const SRC_DIR = path.join(ROOT, 'src');

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'generated' || name === 'node_modules') continue;
      files.push(...walk(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

/** `/billing/invoices/[id]` — route groups like `(app)` do not appear in a URL. */
function routeFor(file: string): string | null {
  const base = path.basename(file);
  if (!/^(page|route)\.(tsx|ts)$/.test(base)) return null;

  const segments = path
    .relative(APP_DIR, path.dirname(file))
    .split(path.sep)
    .filter((segment) => segment !== '' && !(segment.startsWith('(') && segment.endsWith(')')));
  return `/${segments.join('/')}`;
}

function matcherFor(route: string): RegExp {
  const pattern = route
    .split('/')
    .map((segment) =>
      /^\[.+\]$/.test(segment) ? '[^/]+' : segment.replace(/[.*+?^${}()|\\]/g, '\\$&'),
    )
    .join('/');
  return new RegExp(`^${pattern}/?$`);
}

const sourceFiles = walk(SRC_DIR);
const routes = sourceFiles.map(routeFor).filter((route): route is string => route !== null);

/**
 * Static internal targets in the source: href="/x", href: '/x', redirect('/x'),
 * revalidatePath('/x'). Template strings with interpolation are skipped; they
 * are checked below by their static prefix.
 */
const LINK = /(?:href\s*[=:]\s*\{?\s*|redirect\(\s*|revalidatePath\(\s*)(['"])(\/[^'"`$]*)\1/g;

function staticLinks(): Array<{ file: string; target: string }> {
  const found: Array<{ file: string; target: string }> = [];
  for (const file of sourceFiles.filter((name) => /\.(ts|tsx)$/.test(name))) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(LINK)) {
      const target = match[2].split(/[?#]/)[0];
      // `//host` is protocol-relative, `[id]` is a revalidatePath pattern.
      if (target === '' || target.startsWith('//') || target.includes('[')) continue;
      found.push({ file: path.relative(ROOT, file), target });
    }
  }
  return found;
}

describe('route tree', () => {
  it('finds the routes it is meant to check', () => {
    // If this fails the walker is broken, and every other test here is vacuous.
    expect(routes).toContain('/dashboard');
    expect(routes).toContain('/journal');
    expect(routes).toContain('/sign-in');
    expect(routes.length).toBeGreaterThan(20);
  });

  it('has a page for every link in the main navigation', () => {
    const nav = readFileSync(path.join(SRC_DIR, 'components', 'nav.tsx'), 'utf8');
    const hrefs = [...nav.matchAll(/href:\s*'(\/[^']*)'/g)].map((match) => match[1]);
    expect(hrefs.length).toBeGreaterThanOrEqual(8);

    for (const href of hrefs) {
      expect(
        routes.some((route) => matcherFor(route).test(href)),
        `the navigation links to ${href} but no page serves it — is the directory git-ignored?`,
      ).toBe(true);
    }
  });

  it('has a page for every static internal link in the source', () => {
    const links = staticLinks();
    expect(links.length).toBeGreaterThan(30);

    const dead = links.filter(
      ({ target }) => !routes.some((route) => matcherFor(route).test(target)),
    );
    expect(
      dead,
      `links with no matching page:\n${dead.map((link) => `  ${link.target}  (${link.file})`).join('\n')}`,
    ).toEqual([]);
  });

  it('serves the reports page, which a repository-level ignore rule once swallowed', () => {
    expect(routes).toContain('/reports');
  });

  it('serves the Find Work pages and the public request page', () => {
    for (const route of [
      '/find-work',
      '/find-work/pipeline',
      '/find-work/pipeline/new',
      '/find-work/pipeline/[id]',
      '/find-work/requests',
      '/settings/request-link',
      '/n/[slug]',
      '/n/[slug]/thanks',
    ]) {
      expect(routes, route).toContain(route);
    }
  });
});
