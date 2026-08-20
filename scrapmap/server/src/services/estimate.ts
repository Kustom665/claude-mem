import {
  MATERIALS_BY_KEY,
  STATIC_BASE_PRICES,
  type Material,
} from '../data/materials.ts';
import type { PriceSnapshot } from './prices.ts';

export interface MaterialLineInput {
  materialKey: string;
  weightLbs: number;
  quantity?: number;
  notes?: string;
}

export interface MaterialLineEstimate {
  materialKey: string;
  materialName: string;
  category: Material['category'];
  weightLbs: number;
  /** Estimated yard payout per pound, in dollars. */
  usdPerLb: number;
  /** Estimated payout for this line, in cents. */
  valueCents: number;
  basis: Material['basis'];
  /** True when the underlying metal price came from a live quote. */
  isLive: boolean;
}

export interface EstimateResult {
  lines: MaterialLineEstimate[];
  totalWeightLbs: number;
  totalValueCents: number;
  /** Yard payout is the floor; scrappers factor fuel and time against it. */
  currency: 'USD';
  pricedAt: string;
  disclaimer: string;
}

/** Per-pound rate for a material given the current metal price snapshot. */
export function ratePerLb(material: Material, prices: PriceSnapshot): {
  usdPerLb: number;
  isLive: boolean;
} {
  switch (material.basis) {
    case 'copper':
      return {
        usdPerLb: prices.copper.usdPerLb * material.yardPct,
        isLive: prices.copper.isLive,
      };
    case 'aluminum':
      return {
        usdPerLb: prices.aluminum.usdPerLb * material.yardPct,
        isLive: prices.aluminum.isLive,
      };
    case 'steel':
      return {
        usdPerLb: prices.steel.usdPerLb * material.yardPct,
        isLive: prices.steel.isLive,
      };
    case 'flat':
      return { usdPerLb: material.flatPerLb ?? 0, isLive: false };
    default:
      return { usdPerLb: 0, isLive: false };
  }
}

/**
 * Values a pile of scrap at estimated yard payout. Unknown material keys are
 * skipped rather than rejected so a catalog change never orphans an old listing.
 */
export function estimateValue(
  lines: MaterialLineInput[],
  prices: PriceSnapshot,
): EstimateResult {
  const estimated: MaterialLineEstimate[] = [];
  let totalWeightLbs = 0;
  let totalValueCents = 0;

  for (const line of lines) {
    const material = MATERIALS_BY_KEY.get(line.materialKey);
    if (!material) continue;

    const weightLbs = Math.max(0, Number(line.weightLbs) || 0);
    const { usdPerLb, isLive } = ratePerLb(material, prices);
    const valueCents = Math.round(weightLbs * usdPerLb * 100);

    totalWeightLbs += weightLbs;
    totalValueCents += valueCents;

    estimated.push({
      materialKey: material.key,
      materialName: material.name,
      category: material.category,
      weightLbs,
      usdPerLb: Number(usdPerLb.toFixed(4)),
      valueCents,
      basis: material.basis,
      isLive,
    });
  }

  return {
    lines: estimated,
    totalWeightLbs: Number(totalWeightLbs.toFixed(2)),
    totalValueCents,
    currency: 'USD',
    pricedAt: prices.fetchedAt,
    disclaimer: prices.disclaimer,
  };
}

/**
 * Rough weight guidance for homeowners who have no scale. Deliberately coarse:
 * the point is to get a listing posted, not to settle a transaction.
 */
export const WEIGHT_HINTS: { label: string; lbs: number; materialKey: string }[] = [
  { label: 'Bathroom faucet', lbs: 2.5, materialKey: 'yellow-brass' },
  { label: 'Kitchen faucet', lbs: 4, materialKey: 'yellow-brass' },
  { label: '10 ft of 1/2" copper pipe', lbs: 3, materialKey: 'copper-2' },
  { label: '50 ft roll of 12-2 Romex', lbs: 9, materialKey: 'icw-romex' },
  { label: 'Standard extension cord', lbs: 1.5, materialKey: 'icw-extension-cord' },
  { label: 'Window AC unit (whole)', lbs: 60, materialKey: 'sealed-unit' },
  { label: 'Washing machine motor', lbs: 20, materialKey: 'electric-motor' },
  { label: 'Water heater (40 gal, empty)', lbs: 120, materialKey: 'appliance-steel' },
  { label: 'Clothes dryer', lbs: 110, materialKey: 'appliance-steel' },
  { label: 'Car battery', lbs: 40, materialKey: 'lead-acid-battery' },
  { label: 'Aluminum storm window', lbs: 8, materialKey: 'aluminum-extrusion' },
  { label: 'Kitchen sink (stainless)', lbs: 18, materialKey: 'stainless-304' },
  { label: 'Bag of ~150 cans', lbs: 5, materialKey: 'aluminum-cans' },
  { label: 'Car AC condenser', lbs: 12, materialKey: 'clean-copper-alum-radiator' },
];

/** Static baselines exposed so the client can show what is estimated vs. quoted. */
export const staticBasePrices = STATIC_BASE_PRICES;
