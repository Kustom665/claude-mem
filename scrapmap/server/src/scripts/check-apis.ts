/**
 * Connectivity check for every third-party service ScrapMap uses.
 *
 * All of them are free and keyless, but they are also public infrastructure
 * that can be down, rate-limiting, or blocked by a corporate network. Run
 * `npm run check:apis` to find out which ones this machine can actually reach
 * before assuming the app is broken.
 */
import { env } from '../env.ts';
import { getPrices } from '../services/prices.ts';
import { searchAddress, reverseGeocode } from '../services/geocode.ts';
import { findNearbyYards } from '../services/yards.ts';
import { getWeather } from '../services/weather.ts';

const PROBE = { lat: 39.9612, lon: -82.9988, label: 'Columbus, Ohio' };

interface CheckResult {
  name: string;
  endpoint: string;
  ok: boolean;
  detail: string;
  ms: number;
}

async function check(
  name: string,
  endpoint: string,
  run: () => Promise<string>,
): Promise<CheckResult> {
  const started = Date.now();
  try {
    const detail = await run();
    return { name, endpoint, ok: true, detail, ms: Date.now() - started };
  } catch (error) {
    return {
      name,
      endpoint,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      ms: Date.now() - started,
    };
  }
}

const results: CheckResult[] = [];

console.log('Checking ScrapMap\'s free data sources...\n');

if (env.offlineMode) {
  console.log('OFFLINE_MODE is set — unset it to actually reach the network.\n');
}

results.push(
  await check('Copper index', 'stooq.com (CSV quote)', async () => {
    const prices = await getPrices();
    if (!prices.copper.isLive) {
      throw new Error(
        `served a ${prices.freshness} value of $${prices.copper.usdPerLb}/lb instead of a live quote`,
      );
    }
    return `copper $${prices.copper.usdPerLb}/lb as of ${prices.copper.asOf}`;
  }),
);

results.push(
  await check('Geocoding', 'nominatim.openstreetmap.org', async () => {
    const found = await searchAddress(PROBE.label, { limit: 1 });
    if (found.length === 0) throw new Error('no results returned');
    return `"${PROBE.label}" resolved to ${found[0]!.lat}, ${found[0]!.lon}`;
  }),
);

results.push(
  await check('Reverse geocoding', 'nominatim.openstreetmap.org', async () => {
    const place = await reverseGeocode(PROBE.lat, PROBE.lon);
    if (!place) throw new Error('no address returned');
    return place.displayName.slice(0, 70);
  }),
);

results.push(
  await check('Scrap yard search', 'overpass-api.de', async () => {
    const { yards } = await findNearbyYards(PROBE.lat, PROBE.lon, 25);
    return `${yards.length} yards or recyclers within 25 mi of ${PROBE.label}`;
  }),
);

results.push(
  await check('Weather', 'api.open-meteo.com', async () => {
    const weather = await getWeather(PROBE.lat, PROBE.lon, 3);
    const today = weather.daily[0];
    if (!today) throw new Error('no forecast days returned');
    return `today: ${today.summary}, high ${today.highF}F, haul score "${today.haulScore}"`;
  }),
);

results.push(
  await check('Map tiles', 'tile.openstreetmap.org', async () => {
    const response = await fetch('https://tile.openstreetmap.org/10/282/391.png', {
      headers: { 'User-Agent': env.osmUserAgent },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = (await response.arrayBuffer()).byteLength;
    return `tile fetched (${(bytes / 1024).toFixed(1)} kB)`;
  }),
);

const width = Math.max(...results.map((result) => result.name.length));
for (const result of results) {
  const status = result.ok ? 'OK  ' : 'FAIL';
  console.log(
    `${status} ${result.name.padEnd(width)}  ${String(result.ms).padStart(5)}ms  ${result.detail}`,
  );
  if (!result.ok) console.log(`     ${' '.repeat(width)}         via ${result.endpoint}`);
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} reachable.`);

if (failed.length > 0) {
  console.log(
    '\nScrapMap keeps working when these are down: prices fall back to built-in baselines,\n' +
      'and map, yard, and weather panels degrade rather than break. Address autocomplete is\n' +
      'the one feature that needs Nominatim — without it, users drop a pin on the map instead.',
  );
}

process.exit(failed.length > 0 ? 1 : 0);
