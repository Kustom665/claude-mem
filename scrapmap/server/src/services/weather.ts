import { cached } from '../db/cache.ts';
import { env } from '../env.ts';
import { fetchJson } from '../lib/http.ts';

/**
 * Pickup-window weather from Open-Meteo: free, keyless, no attribution burden.
 *
 * Scrapping is outdoor work with an open trailer, so rain and wind decide
 * whether a haul happens today. This turns "when should I grab it" from a guess
 * into a glance.
 */

const CACHE_TTL_SECONDS = 30 * 60;

export interface DailyForecast {
  date: string;
  highF: number | null;
  lowF: number | null;
  precipitationChance: number | null;
  precipitationInches: number | null;
  windMph: number | null;
  weatherCode: number | null;
  summary: string;
  /** Our own call on whether it is a reasonable day to haul metal. */
  haulScore: 'good' | 'fair' | 'poor';
}

export interface WeatherResult {
  currentTempF: number | null;
  currentSummary: string;
  daily: DailyForecast[];
  freshness: 'live' | 'cache' | 'stale';
  attribution: string;
}

interface OpenMeteoResponse {
  current?: {
    temperature_2m?: number;
    weather_code?: number;
  };
  daily?: {
    time?: string[];
    weather_code?: (number | null)[];
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
    precipitation_probability_max?: (number | null)[];
    precipitation_sum?: (number | null)[];
    wind_speed_10m_max?: (number | null)[];
  };
}

/** WMO weather interpretation codes used by Open-Meteo. */
const WEATHER_CODES: Record<number, string> = {
  0: 'Clear',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Rain showers',
  81: 'Rain showers',
  82: 'Violent rain showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with hail',
};

const describe = (code: number | null | undefined): string =>
  code === null || code === undefined ? 'Unknown' : (WEATHER_CODES[code] ?? 'Unsettled');

function scoreHaulDay(
  precipChance: number | null,
  windMph: number | null,
  highF: number | null,
  code: number | null,
): DailyForecast['haulScore'] {
  const stormy = code !== null && code >= 95;
  const frozen = code !== null && ((code >= 71 && code <= 77) || (code >= 85 && code <= 86));
  if (stormy || frozen) return 'poor';
  if ((precipChance ?? 0) >= 60 || (windMph ?? 0) >= 30) return 'poor';
  if ((precipChance ?? 0) >= 30 || (windMph ?? 0) >= 20) return 'fair';
  if (highF !== null && (highF <= 20 || highF >= 100)) return 'fair';
  return 'good';
}

export async function getWeather(lat: number, lon: number, days = 7): Promise<WeatherResult> {
  const roundedLat = Number(lat.toFixed(2));
  const roundedLon = Number(lon.toFixed(2));
  const forecastDays = Math.min(Math.max(days, 1), 14);

  const params = new URLSearchParams({
    latitude: String(roundedLat),
    longitude: String(roundedLon),
    current: 'temperature_2m,weather_code',
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: 'auto',
    forecast_days: String(forecastDays),
  });

  const url = `${env.openMeteoBaseUrl}?${params.toString()}`;
  const key = `weather:${roundedLat},${roundedLon}:${forecastDays}`;

  const result = await cached(key, CACHE_TTL_SECONDS, async () => {
    const payload = await fetchJson<OpenMeteoResponse>(url, {
      label: 'open-meteo',
      timeoutMs: 9000,
    });

    const dates = payload.daily?.time ?? [];
    const daily: DailyForecast[] = dates.map((date, index) => {
      const code = payload.daily?.weather_code?.[index] ?? null;
      const highF = payload.daily?.temperature_2m_max?.[index] ?? null;
      const precipitationChance = payload.daily?.precipitation_probability_max?.[index] ?? null;
      const windMph = payload.daily?.wind_speed_10m_max?.[index] ?? null;

      return {
        date,
        highF,
        lowF: payload.daily?.temperature_2m_min?.[index] ?? null,
        precipitationChance,
        precipitationInches: payload.daily?.precipitation_sum?.[index] ?? null,
        windMph,
        weatherCode: code,
        summary: describe(code),
        haulScore: scoreHaulDay(precipitationChance, windMph, highF, code),
      };
    });

    return {
      currentTempF: payload.current?.temperature_2m ?? null,
      currentSummary: describe(payload.current?.weather_code),
      daily,
    };
  });

  return {
    ...result.value,
    freshness: result.source,
    attribution: 'Weather data by Open-Meteo.com (CC BY 4.0)',
  };
}
