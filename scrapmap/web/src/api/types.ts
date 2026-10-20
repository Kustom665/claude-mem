/** Response shapes returned by the ScrapMap API. */

export type UserRole = 'homeowner' | 'scrapper' | 'both';
export type ListingStatus = 'open' | 'claimed' | 'completed' | 'cancelled' | 'expired';
export type PriceType = 'free' | 'obo' | 'firm';
export type ClaimStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'completed';

export interface User {
  id: string;
  displayName: string;
  role: UserRole;
  bio: string;
  city: string | null;
  region: string | null;
  memberSince: string;
  rating: number | null;
  reviewCount: number;
  completedPickups: number;
  poundsDiverted: number;
  email?: string;
  phone?: string | null;
  homeLat?: number | null;
  homeLon?: number | null;
  postalCode?: string | null;
  searchRadiusMiles?: number;
  unreadNotifications?: number;
}

export interface MaterialLine {
  materialKey: string;
  materialName: string;
  category: string;
  weightLbs: number;
  quantity: number;
  notes: string;
}

export interface Listing {
  id: string;
  title: string;
  description: string;
  status: ListingStatus;
  priceType: PriceType;
  priceCents: number;
  lat: number;
  lon: number;
  /** True when coordinates are deliberately fuzzed for privacy. */
  approximateLocation: boolean;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  pickupNotes: string;
  availableFrom: string | null;
  availableUntil: string | null;
  curbside: boolean;
  helpNeeded: boolean;
  estimatedValueCents: number;
  totalWeightLbs: number;
  viewCount: number;
  communityId: string | null;
  ownerId: string;
  ownerName: string | null;
  claimedBy: string | null;
  isOwner: boolean;
  isClaimant: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  completedAt: string | null;
  distanceMiles: number | null;
  materials: MaterialLine[];
  photos: { id: string; url: string }[];
}

export interface Material {
  key: string;
  name: string;
  category: string;
  categoryLabel: string;
  basis: 'copper' | 'aluminum' | 'steel' | 'flat';
  yardPct: number;
  unit: string;
  description: string;
  foundIn: string[];
  upgradeTip: string | null;
  magnetic: boolean;
  estimatedUsdPerLb: number;
  priceIsLive: boolean;
}

export interface MetalPrice {
  metal: string;
  usdPerLb: number;
  source: string;
  isLive: boolean;
  changePct: number | null;
  asOf: string;
}

export interface PriceSnapshot {
  copper: MetalPrice;
  aluminum: MetalPrice;
  steel: MetalPrice;
  fetchedAt: string;
  freshness: 'live' | 'cache' | 'stale' | 'fallback';
  disclaimer: string;
}

export interface MaterialsResponse {
  categories: { key: string; label: string }[];
  materials: Material[];
  weightHints: { label: string; lbs: number; materialKey: string }[];
  prohibitedItems: string[];
  prices: PriceSnapshot;
}

export interface EstimateResponse {
  lines: {
    materialKey: string;
    materialName: string;
    category: string;
    weightLbs: number;
    usdPerLb: number;
    valueCents: number;
    basis: string;
    isLive: boolean;
  }[];
  totalWeightLbs: number;
  totalValueCents: number;
  currency: string;
  pricedAt: string;
  disclaimer: string;
}

export interface Claim {
  id: string;
  listingId: string;
  listingTitle: string | null;
  listingStatus: string | null;
  scrapperId: string;
  scrapperName: string | null;
  scrapperRating: number | null;
  scrapperPickups: number;
  status: ClaimStatus;
  message: string;
  eta: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  listingId: string;
  senderId: string;
  senderName: string | null;
  recipientId: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  isMine: boolean;
}

export interface Thread {
  listingId: string;
  listingTitle: string;
  listingStatus: string;
  withUserId: string;
  withUserName: string;
  lastMessage: string;
  lastMessageAt: string;
  unread: number;
}

export interface Community {
  id: string;
  slug: string;
  name: string;
  description: string;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  lat: number | null;
  lon: number | null;
  radiusMiles: number;
  createdBy: string;
  createdAt: string;
  memberCount: number;
  openListings: number;
  poundsDiverted: number;
  isMember?: boolean;
}

export interface CommunityEvent {
  id: string;
  communityId: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string | null;
  lat: number | null;
  lon: number | null;
  addressLine: string | null;
  createdBy: string;
  creatorName: string | null;
  createdAt: string;
  goingCount: number;
  myRsvp: string | null;
}

export interface ScrapYard {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distanceMiles: number;
  kind: 'scrap-yard' | 'recycling-centre' | 'metal-recycling';
  address: string | null;
  phone: string | null;
  website: string | null;
  openingHours: string | null;
  acceptsScrapMetal: boolean;
  osmUrl: string;
}

export interface GeocodeResult {
  displayName: string;
  lat: number;
  lon: number;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  rank: number;
}

export interface DailyForecast {
  date: string;
  highF: number | null;
  lowF: number | null;
  precipitationChance: number | null;
  precipitationInches: number | null;
  windMph: number | null;
  weatherCode: number | null;
  summary: string;
  haulScore: 'good' | 'fair' | 'poor';
}

export interface WeatherResponse {
  currentTempF: number | null;
  currentSummary: string;
  daily: DailyForecast[];
  freshness: string;
  attribution: string;
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface StatsResponse {
  totals: {
    completedPickups: number;
    poundsDiverted: number;
    tonsDiverted: number;
    estimatedValueCents: number;
    openListings: number;
    members: number;
    communities: number;
  };
  leaderboard: {
    scrappers: { id: string; displayName: string; pickups: number; poundsDiverted: number }[];
    posters: { id: string; displayName: string; posts: number; poundsDiverted: number }[];
  };
  byMaterial: { materialKey: string; materialName: string; poundsDiverted: number }[];
}
