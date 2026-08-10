import { cached, readCache } from '../db/cache.ts';
import { env } from '../env.ts';
import { fetchText } from '../lib/http.ts';
import { STATIC_BASE_PRICES } from '../data/materials.ts';

/**
 * Copper pricing from Stooq's free CSV quote endpoint — no key, no signup,
 * no per-call quota to manage. HG.F is the COMEX copper future, already quoted
 * in US dollars per pound, which is the unit every scrap yard works in.
 */

export type MetalKey = 'copper' | 'aluminum' | 'steel';

export interface MetalPrice {
  metal: MetalKey;
  usdPerLb: number;
  /** Where the number came from, e.g. 'stooq:hg.f' or 'baseline'. */
  source: string;
  /** False means this is a built-in baseline, not a market quote. */
  isLive: boolean;
  /** Session change as a percentage, when the feed provides open and close. */
  changePct: number | null;
  asOf: string;
}

export interface PriceSnapshot {
  copper: MetalPrice;
  aluminum: MetalPrice;
  steel: MetalPrice;
  fetchedAt: string;
  /** 'live' fetched now, 'cache'/'stale' served from SQLite, 'fallback' is built-in. */
  freshness: 'live' | 'cache' | 'stale' | 'fallback';
  disclaimer: string;
}

const CACHE_KEY = 'prices:metals:v1';
const CACHE_TTL_SECONDS = 30 * 60;

const DISCLAIMER =
  'Estimates only. Scrap yards quote their own buy prices, which vary by region, volume, ' +
  'grade, and day. Always call ahead before hauling a load.';

/**
 * Offline fallback, refreshed whenever this file is touched. Deliberately on
 * the conservative side so an estimate shown without a live feed under-promises
 * rather than over-promises.
 */
const BASELINE_COPPER_PER_LB = 4.3;
const BASELINE_AS_OF = '2026-01-01';

// Plausibility windows. A feed that returns a bad symbol, an HTML error page,
// or a value in the wrong unit gets rejected instead of poisoning every estimate.
const SANITY_BOUNDS: Record<MetalKey, { min: number; max: number }> = {
  copper: { min: 1, max: 15 },
  aluminum: { min: 0.2, max: 5 },
  steel: { min: 0.01, max: 1 },
};

interface StooqQuote {
  symbol: string;
  date: string;
  open: number | null;
  close: number | null;
}

/**
 * Stooq returns a two-line CSV:
 *   Symbol,Date,Time,Open,High,Low,Close,Volume
 *   HG.F,2026-08-10,21:00:00,4.4185,4.4600,4.4010,4.4520,1234
 * Missing data comes back as the literal 'N/D'.
 */
function parseStooqCsv(csv: string): StooqQuote | null {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return null;

  const header = (lines[0] ?? '').toLowerCase().split(',');
  const values = (lines[1] ?? '').split(',');
  if (values.length < 2) return null;

  const at = (name: string): string | null => {
    const index = header.indexOf(name);
    if (index === -1) return null;
    const value = values[index]?.trim();
    return !value || value === 'N/D' ? null : value;
  };

  const toNumber = (value: string | null): number | null => {
    if (value === null) return null;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const symbol = at('symbol');
  if (!symbol) return null;

  return {
    symbol,
    date: at('date') ?? new Date().toISOString().slice(0, 10),
    open: toNumber(at('open')),
    close: toNumber(at('close')),
  };
}

async function fetchStooq(symbol: string): Promise<StooqQuote | null> {
  const url = `${env.stooqBaseUrl}?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`;
  const csv = await fetchText(url, { label: `stooq:${symbol}`, timeoutMs: 7000, retries: 1 });
  return parseStooqCsv(csv);
}

const withinBounds = (metal: MetalKey, value: number): boolean => {
  const bounds = SANITY_BOUNDS[metal];
  return Number.isFinite(value) && value >= bounds.min && value <= bounds.max;
};

const changePct = (quote: StooqQuote): number | null =>
  quote.open && quote.close && quote.open !== 0
    ? Number((((quote.close - quote.open) / quote.open) * 100).toFixed(2))
    : null;

async function loadCopper(): Promise<MetalPrice> {
  const quote = await fetchStooq('hg.f');
  const close = quote?.close;
  if (quote && close !== null && close !== undefined && withinBounds('copper', close)) {
    return {
      metal: 'copper',
      usdPerLb: Number(close.toFixed(4)),
      source: `stooq:${quote.symbol.toLowerCase()}`,
      isLive: true,
      changePct: changePct(quote),
      asOf: quote.date,
    };
  }
  throw new Error('Copper quote failed sanity check');
}

/**
 * Aluminum futures are quoted per tonne rather than per pound. Rather than
 * hard-coding an assumption about which, convert only when the magnitude makes
 * the per-tonne reading the plausible one.
 */
const POUNDS_PER_TONNE = 2204.62;

async function loadAluminum(): Promise<MetalPrice> {
  const quote = await fetchStooq('ali.f');
  let close = quote?.close ?? null;
  if (quote && close !== null) {
    if (close > 100) close = close / POUNDS_PER_TONNE;
    if (withinBounds('aluminum', close)) {
      return {
        metal: 'aluminum',
        usdPerLb: Number(close.toFixed(4)),
        source: `stooq:${quote.symbol.toLowerCase()}`,
        isLive: true,
        changePct: changePct(quote),
        asOf: quote.date,
      };
    }
  }
  throw new Error('Aluminum quote failed sanity check');
}

const baseline = (metal: MetalKey, usdPerLb: number): MetalPrice => ({
  metal,
  usdPerLb,
  source: 'baseline',
  isLive: false,
  changePct: null,
  asOf: BASELINE_AS_OF,
});

/** Fetches every metal, letting each fall back independently. */
async function loadSnapshot(): Promise<Omit<PriceSnapshot, 'freshness' | 'disclaimer'>> {
  const [copper, aluminum] = await Promise.all([
    loadCopper().catch(() => baseline('copper', BASELINE_COPPER_PER_LB)),
    loadAluminum().catch(() => baseline('aluminum', STATIC_BASE_PRICES.aluminum)),
  ]);

  // No free per-pound feed exists for shred steel; yards post it monthly anyway,
  // so a baseline is honest here rather than a limitation.
  const steel = baseline('steel', STATIC_BASE_PRICES.steel);

  if (!copper.isLive && !aluminum.isLive) {
    throw new Error('No live metal quotes available');
  }
  return { copper, aluminum, steel, fetchedAt: new Date().toISOString() };
}

const fallbackSnapshot = (): PriceSnapshot => ({
  copper: baseline('copper', BASELINE_COPPER_PER_LB),
  aluminum: baseline('aluminum', STATIC_BASE_PRICES.aluminum),
  steel: baseline('steel', STATIC_BASE_PRICES.steel),
  fetchedAt: new Date().toISOString(),
  freshness: 'fallback',
  disclaimer: DISCLAIMER,
});

/**
 * Current metal prices. Never throws: a dead upstream degrades to cached data,
 * then to built-in baselines, because an estimate is the app's core loop and
 * failing it outright would break posting and browsing alike.
 */
export async function getPrices(): Promise<PriceSnapshot> {
  try {
    const result = await cached(CACHE_KEY, CACHE_TTL_SECONDS, loadSnapshot);
    return { ...result.value, freshness: result.source, disclaimer: DISCLAIMER };
  } catch {
    const stale = readCache<Omit<PriceSnapshot, 'freshness' | 'disclaimer'>>(CACHE_KEY);
    if (stale) {
      return { ...stale.value, freshness: 'stale', disclaimer: DISCLAIMER };
    }
    return fallbackSnapshot();
  }
}

/** Synchronous read for code paths that cannot await, e.g. inside a transaction. */
export function getCachedPrices(): PriceSnapshot {
  const entry = readCache<Omit<PriceSnapshot, 'freshness' | 'disclaimer'>>(CACHE_KEY);
  if (!entry) return fallbackSnapshot();
  return {
    ...entry.value,
    freshness: entry.stale ? 'stale' : 'cache',
    disclaimer: DISCLAIMER,
  };
}

export const priceDisclaimer = DISCLAIMER;
