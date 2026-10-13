import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOURCE_CATEGORIES } from '@/lib/domain';
import { REQUIREMENTS } from '@/lib/requirements';
import {
  compareSourcesForPa,
  WORK_SOURCES,
  workSourceByKey,
  workSourcesCapturedOn,
  type WorkSource,
} from '@/lib/work-sources';

/**
 * The directory is reference data that notaries act on, so these tests guard
 * the properties that make it trustworthy: every claim has a source, weak
 * evidence says so, and nothing can point a user at a non-https address.
 */

function textFields(source: WorkSource): string[] {
  return [
    source.name,
    source.howWorkArrives,
    ...source.howToJoin,
    source.payNote ?? '',
    source.paNote ?? '',
    source.caveat ?? '',
  ];
}

describe('work source directory', () => {
  it('is not empty', () => {
    expect(WORK_SOURCES.length).toBeGreaterThanOrEqual(15);
  });

  it('has unique, stable, url-safe keys', () => {
    const keys = WORK_SOURCES.map((source) => source.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it('only uses categories the app knows how to label', () => {
    for (const source of WORK_SOURCES) {
      expect(SOURCE_CATEGORIES, source.key).toContain(source.category);
    }
  });

  it('only lists requirements that exist, without repeats', () => {
    for (const source of WORK_SOURCES) {
      for (const key of source.requirements) expect(REQUIREMENTS[key], `${source.key}:${key}`).toBeDefined();
      expect(new Set(source.requirements).size, source.key).toBe(source.requirements.length);
    }
  });

  it('requires an active commission of every source', () => {
    // A notarial act on an expired commission is void, so no source can
    // sensibly be "ready" for a notary who has none.
    for (const source of WORK_SOURCES) {
      expect(source.requirements, source.key).toContain('COMMISSION_ACTIVE');
    }
  });

  it('cites at least one source, and every address is https', () => {
    for (const source of WORK_SOURCES) {
      expect(source.sources.length, source.key).toBeGreaterThan(0);
      expect(new Set(source.sources).size, `${source.key} repeats a source`).toBe(source.sources.length);

      for (const address of [...source.sources, ...(source.applyUrl ? [source.applyUrl] : [])]) {
        const url = new URL(address);
        expect(url.protocol, `${source.key}: ${address}`).toBe('https:');
        expect(url.hostname, `${source.key}: ${address}`).toContain('.');
      }
    }
  });

  it('dates every entry with a real calendar date that is not in the future', () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const source of WORK_SOURCES) {
      expect(source.capturedOn, source.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(new Date(source.capturedOn).getTime()), source.key).toBe(false);
      expect(source.capturedOn <= today, source.key).toBe(true);
    }
  });

  it('gives every entry something to do and something to read', () => {
    for (const source of WORK_SOURCES) {
      expect(source.howToJoin.length, source.key).toBeGreaterThan(0);
      expect(source.howWorkArrives.length, source.key).toBeGreaterThan(20);
    }
  });

  it('never presents community reports without saying how far they can be trusted', () => {
    for (const source of WORK_SOURCES.filter((entry) => entry.evidence === 'ANECDOTAL')) {
      expect(source.caveat, `${source.key} is anecdotal but carries no caveat`).toBeTruthy();
    }
  });

  it('keeps text clean enough to render without surprises', () => {
    for (const source of WORK_SOURCES) {
      for (const field of textFields(source)) {
        expect(field, source.key).toBe(field.trim());
        expect(field, source.key).not.toMatch(/ {2,}/);
        // Rendered as text, never as markup.
        expect(field, source.key).not.toMatch(/[<>]/);
      }
    }
  });

  it('does not promise income', () => {
    // Pay notes may report what a source says it pays. None may imply what a
    // notary will earn.
    for (const source of WORK_SOURCES) {
      for (const field of textFields(source)) {
        expect(field.toLowerCase(), source.key).not.toMatch(/guarantee|six[- ]figure|you will earn|earn up to/);
      }
    }
  });

  it('covers the channels a Pennsylvania notary actually asks about', () => {
    const categories = new Set(WORK_SOURCES.map((source) => source.category));
    for (const category of [
      'SIGNING_SERVICE',
      'TITLE_ESCROW',
      'LAW_FIRM',
      'HEALTHCARE_SENIOR',
      'APOSTILLE_INTL',
      'DIRECTORY',
      'RON_PLATFORM',
    ] as const) {
      expect(categories.has(category), category).toBe(true);
    }
  });
});

describe('directory helpers', () => {
  it('finds a source by key and returns null for anything else', () => {
    expect(workSourceByKey('snapdocs')?.name).toContain('Snapdocs');
    expect(workSourceByKey('nope')).toBeNull();
    expect(workSourceByKey(null)).toBeNull();
    expect(workSourceByKey('')).toBeNull();
  });

  it('reports the most recent capture date', () => {
    const latest = workSourcesCapturedOn();
    expect(latest).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(WORK_SOURCES.every((source) => source.capturedOn <= (latest as string))).toBe(true);
  });

  it('orders Pennsylvania-relevant sources first, then alphabetically', () => {
    const sorted = [...WORK_SOURCES].sort(compareSourcesForPa);
    const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      expect(rank[previous.paRelevance]).toBeLessThanOrEqual(rank[current.paRelevance]);
      if (previous.paRelevance === current.paRelevance) {
        expect(previous.name.localeCompare(current.name)).toBeLessThanOrEqual(0);
      }
    }
  });
});

describe('the readiness-aware ordering', () => {
  it('puts the sources the notary is closest to joining first within a tier', () => {
    // Same relevance tier: higher readiness first, then alphabetical.
    const high = WORK_SOURCES.filter((source) => source.paRelevance === 'HIGH').slice(0, 3);
    const percent = new Map([
      [high[0].key, 20],
      [high[1].key, 100],
      [high[2].key, 100],
    ]);
    const sorted = [...high].sort((a, b) =>
      compareSourcesForPa(a, b, (source) => percent.get(source.key) ?? 0),
    );
    expect(sorted[sorted.length - 1].key).toBe(high[0].key);
    expect(sorted[0].name.localeCompare(sorted[1].name)).toBeLessThanOrEqual(0);
  });

  it('still puts a high-relevance source ahead of a more ready low-relevance one', () => {
    const high = WORK_SOURCES.find((source) => source.paRelevance === 'HIGH') as WorkSource;
    const medium = WORK_SOURCES.find((source) => source.paRelevance === 'MEDIUM') as WorkSource;
    expect(compareSourcesForPa(high, medium, (source) => (source === medium ? 100 : 0))).toBeLessThan(0);
  });
});

describe('docs/WORK-SOURCES.md', () => {
  const doc = readFileSync(path.join(__dirname, '..', 'docs', 'WORK-SOURCES.md'), 'utf8');

  it('mentions every entry in the directory, so the document cannot drift from the data', () => {
    for (const source of WORK_SOURCES) {
      expect(doc, `${source.name} is missing from docs/WORK-SOURCES.md`).toContain(source.name);
    }
  });

  it('states the capture date and that no page was opened', () => {
    expect(doc).toContain('13 October 2026');
    expect(doc).toMatch(/could not\s+open a web page/i);
  });
});
