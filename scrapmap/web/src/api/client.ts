import type {
  AppNotification,
  Claim,
  Community,
  CommunityEvent,
  EstimateResponse,
  GeocodeResult,
  Listing,
  MaterialsResponse,
  Message,
  PriceSnapshot,
  ScrapYard,
  StatsResponse,
  Thread,
  User,
  WeatherResponse,
} from './types.ts';

const TOKEN_KEY = 'scrapmap.token';

/** Vite proxies /api in dev, so a relative base works in both modes. */
const BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Field-level messages from a 422, keyed by field name. */
  readonly fields: Record<string, string[]> | null;
  readonly details: unknown;

  constructor(
    status: number,
    message: string,
    code: string,
    fields: Record<string, string[]> | null,
    details: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.details = details;
  }
}

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string | null): void => {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
};

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Raw binary payload, used for photo uploads. */
  raw?: Blob;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (options.raw) {
    body = options.raw;
    headers['Content-Type'] = options.raw.type || 'application/octet-stream';
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers['Content-Type'] = 'application/json';
  }

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body,
      credentials: 'include',
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, 'Cannot reach the server. Check your connection.', 'offline', null, null);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = (payload as { error?: Record<string, unknown> } | null)?.error ?? {};
    throw new ApiError(
      response.status,
      typeof error.message === 'string' ? error.message : `Request failed (${response.status})`,
      typeof error.code === 'string' ? error.code : 'error',
      (error.fields as Record<string, string[]> | undefined) ?? null,
      error.details ?? null,
    );
  }

  return payload as T;
}

const qs = (params: Record<string, string | number | boolean | undefined | null>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
};

export interface BrowseParams {
  lat?: number;
  lon?: number;
  radiusMiles?: number;
  status?: 'open' | 'claimed' | 'completed' | 'any';
  category?: string;
  materialKey?: string;
  priceType?: string;
  curbside?: boolean;
  minValueCents?: number;
  search?: string;
  communityId?: string;
  ownerId?: string;
  claimedBy?: string;
  sort?: 'newest' | 'closest' | 'value' | 'weight';
  limit?: number;
  offset?: number;
}

export interface ListingInput {
  title: string;
  description?: string;
  priceType?: string;
  priceCents?: number;
  lat: number;
  lon: number;
  addressLine?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  pickupNotes?: string;
  curbside?: boolean;
  helpNeeded?: boolean;
  communityId?: string | null;
  materials: { materialKey: string; weightLbs: number; quantity?: number; notes?: string }[];
}

export const api = {
  // --- auth
  register: (input: {
    email: string;
    password: string;
    displayName: string;
    role?: string;
    homeLat?: number;
    homeLon?: number;
    city?: string;
    region?: string;
    postalCode?: string;
  }) => request<{ token: string; user: User }>('/api/auth/register', { method: 'POST', body: input }),

  login: (email: string, password: string) =>
    request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    }),

  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  me: () => request<{ user: User }>('/api/auth/me'),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ token: string }>('/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    }),

  updateProfile: (input: Record<string, unknown>) =>
    request<{ user: User }>('/api/users/me', { method: 'PATCH', body: input }),

  getUser: (id: string) =>
    request<{
      user: User;
      reviews: { rating: number; comment: string; createdAt: string; raterName: string }[];
    }>(`/api/users/${id}`),

  // --- listings
  browse: (params: BrowseParams, signal?: AbortSignal) =>
    request<{
      listings: Listing[];
      total: number;
      hasMore: boolean;
      origin: { lat: number; lon: number; radiusMiles: number } | null;
    }>(`/api/listings${qs(params as Record<string, string | number | boolean | undefined>)}`, {
      signal,
    }),

  getListing: (id: string) =>
    request<{
      listing: Listing;
      pendingClaims: number;
      myClaim: { id: string; status: string } | null;
    }>(`/api/listings/${id}`),

  createListing: (input: ListingInput) =>
    request<{ listing: Listing; estimate: EstimateResponse; scrappersNotified: number }>(
      '/api/listings',
      { method: 'POST', body: input },
    ),

  updateListing: (id: string, input: Partial<ListingInput> & { status?: string }) =>
    request<{ listing: Listing }>(`/api/listings/${id}`, { method: 'PATCH', body: input }),

  deleteListing: (id: string) =>
    request<{ ok: boolean }>(`/api/listings/${id}`, { method: 'DELETE' }),

  uploadPhoto: (listingId: string, file: File) =>
    request<{ photo: { id: string; url: string } }>(`/api/listings/${listingId}/photos`, {
      method: 'POST',
      raw: file,
    }),

  deletePhoto: (photoId: string) =>
    request<{ ok: boolean }>(`/api/photos/${photoId}`, { method: 'DELETE' }),

  // --- claims
  claim: (listingId: string, message: string, eta?: string) =>
    request<{ claim: Claim }>(`/api/listings/${listingId}/claims`, {
      method: 'POST',
      body: { message, eta },
    }),

  listClaims: (listingId: string) =>
    request<{ claims: Claim[]; isOwner: boolean }>(`/api/listings/${listingId}/claims`),

  myClaims: () => request<{ claims: Claim[] }>('/api/claims/mine'),

  updateClaim: (claimId: string, action: 'accept' | 'decline' | 'withdraw' | 'complete') =>
    request<{ claim: Claim }>(`/api/claims/${claimId}`, { method: 'PATCH', body: { action } }),

  // --- messaging
  threads: () => request<{ threads: Thread[] }>('/api/threads'),

  messages: (listingId: string, withUserId?: string) =>
    request<{ messages: Message[]; withUserId: string }>(
      `/api/listings/${listingId}/messages${qs({ with: withUserId })}`,
    ),

  sendMessage: (listingId: string, body: string, to?: string) =>
    request<{ message: Message }>(`/api/listings/${listingId}/messages`, {
      method: 'POST',
      body: { body, to },
    }),

  // --- reviews
  review: (listingId: string, rating: number, comment: string) =>
    request<{ ok: boolean }>('/api/reviews', {
      method: 'POST',
      body: { listingId, rating, comment },
    }),

  // --- communities
  communities: (params: { lat?: number; lon?: number; radiusMiles?: number; search?: string; mine?: '1' }) =>
    request<{ communities: Community[] }>(`/api/communities${qs(params)}`),

  community: (idOrSlug: string) =>
    request<{
      community: Community;
      myRole: string | null;
      members: { id: string; displayName: string; role: string; joinedAt: string }[];
    }>(`/api/communities/${idOrSlug}`),

  createCommunity: (input: Record<string, unknown>) =>
    request<{ community: Community }>('/api/communities', { method: 'POST', body: input }),

  joinCommunity: (idOrSlug: string) =>
    request<{ ok: boolean }>(`/api/communities/${idOrSlug}/join`, { method: 'POST' }),

  leaveCommunity: (idOrSlug: string) =>
    request<{ ok: boolean }>(`/api/communities/${idOrSlug}/leave`, { method: 'POST' }),

  events: (idOrSlug: string) =>
    request<{ events: CommunityEvent[] }>(`/api/communities/${idOrSlug}/events`),

  createEvent: (idOrSlug: string, input: Record<string, unknown>) =>
    request<{ event: CommunityEvent }>(`/api/communities/${idOrSlug}/events`, {
      method: 'POST',
      body: input,
    }),

  rsvp: (eventId: string, status: 'going' | 'maybe' | 'declined') =>
    request<{ ok: boolean }>(`/api/communities/events/${eventId}/rsvp`, {
      method: 'POST',
      body: { status },
    }),

  // --- reference & third-party data
  materials: () => request<MaterialsResponse>('/api/materials'),

  prices: () => request<PriceSnapshot>('/api/prices'),

  estimate: (materials: { materialKey: string; weightLbs: number }[]) =>
    request<EstimateResponse>('/api/prices/estimate', { method: 'POST', body: { materials } }),

  geoSearch: (q: string, signal?: AbortSignal) =>
    request<{ results: GeocodeResult[]; attribution: string }>(`/api/geo/search${qs({ q })}`, {
      signal,
    }),

  geoReverse: (lat: number, lon: number) =>
    request<{ result: GeocodeResult | null; attribution: string }>(
      `/api/geo/reverse${qs({ lat, lon })}`,
    ),

  yards: (lat: number, lon: number, radiusMiles = 25) =>
    request<{ yards: ScrapYard[]; freshness: string; attribution: string; note: string }>(
      `/api/yards${qs({ lat, lon, radiusMiles })}`,
    ),

  weather: (lat: number, lon: number, days = 7) =>
    request<WeatherResponse>(`/api/weather${qs({ lat, lon, days })}`),

  stats: () => request<StatsResponse>('/api/stats'),

  // --- notifications
  notifications: () =>
    request<{ notifications: AppNotification[]; unread: number }>('/api/notifications'),

  markNotificationsRead: (ids?: string[]) =>
    request<{ ok: boolean }>('/api/notifications/read', { method: 'POST', body: { ids } }),
};
