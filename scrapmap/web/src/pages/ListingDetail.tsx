import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client.ts';
import type { Claim, Listing, Message, WeatherResponse } from '../api/types.ts';
import { useAuth } from '../state/auth.tsx';
import { MapView } from '../components/MapView.tsx';
import { CategoryBadge, EstimateNote, ErrorNote, Spinner, StatusBadge, Stars } from '../components/ui.tsx';
import { dateOnly, miles, money, priceLabel, timeAgo, weight } from '../lib/format.ts';

export function ListingDetail() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [listing, setListing] = useState<Listing | null>(null);
  const [myClaim, setMyClaim] = useState<{ id: string; status: string } | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [claimMessage, setClaimMessage] = useState('');
  const [draft, setDraft] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewDone, setReviewDone] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.getListing(id);
      setListing(data.listing);
      setMyClaim(data.myClaim);

      if (data.listing.isOwner) {
        const claimData = await api.listClaims(id).catch(() => null);
        if (claimData) setClaims(claimData.claims);
      }

      // Weather only matters to whoever is actually driving out there.
      if (data.listing.isOwner || data.listing.isClaimant) {
        api
          .weather(data.listing.lat, data.listing.lon, 5)
          .then(setWeather)
          .catch(() => setWeather(null));
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load that listing.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // The conversation is only meaningful once two parties exist.
  const loadMessages = useCallback(
    async (withUserId?: string) => {
      try {
        const data = await api.messages(id, withUserId);
        setMessages(data.messages);
      } catch {
        setMessages([]);
      }
    },
    [id],
  );

  useEffect(() => {
    if (!user || !listing) return;
    if (listing.isOwner) {
      const accepted = claims.find((claim) => claim.status === 'accepted') ?? claims[0];
      if (accepted) void loadMessages(accepted.scrapperId);
    } else {
      void loadMessages();
    }
  }, [user, listing, claims, loadMessages]);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Loading listing" />;
  if (!listing) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <ErrorNote message={error ?? 'That listing does not exist.'} />
        <Link to="/" className="btn-secondary mt-4">
          Back to the map
        </Link>
      </div>
    );
  }

  const acceptedClaim = claims.find((claim) => claim.status === 'accepted');
  const counterpartyId = listing.isOwner ? acceptedClaim?.scrapperId : undefined;
  const canMessage =
    Boolean(user) && !listing.isOwner
      ? true
      : Boolean(user) && listing.isOwner && Boolean(counterpartyId);
  const canReview =
    Boolean(user) && listing.status === 'completed' && (listing.isOwner || listing.isClaimant);

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1fr_22rem]">
      <div className="min-w-0">
        <Link to="/" className="text-sm text-zinc-500 hover:text-zinc-300">
          ← Back to the map
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-bold text-zinc-100">{listing.title}</h1>
          <StatusBadge status={listing.status} />
        </div>

        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500">
          <span className="text-lg font-bold text-copper-300">
            {priceLabel(listing.priceType, listing.priceCents)}
          </span>
          <span aria-hidden>·</span>
          <span>{weight(listing.totalWeightLbs)}</span>
          <span aria-hidden>·</span>
          <span>posted {timeAgo(listing.createdAt)}</span>
          {listing.distanceMiles !== null ? (
            <>
              <span aria-hidden>·</span>
              <span>{miles(listing.distanceMiles)} away</span>
            </>
          ) : null}
          <span aria-hidden>·</span>
          <span>{listing.viewCount} views</span>
        </p>

        {error ? <div className="mt-4"><ErrorNote message={error} /></div> : null}

        {listing.photos.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {listing.photos.map((photo) => (
              <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer noopener">
                <img
                  src={photo.url}
                  alt=""
                  loading="lazy"
                  className="aspect-square w-full rounded-lg object-cover"
                />
              </a>
            ))}
          </div>
        ) : null}

        {listing.description ? (
          <p className="mt-4 leading-relaxed whitespace-pre-line text-zinc-300">
            {listing.description}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {listing.curbside ? (
            <span className="chip bg-emerald-950 text-emerald-300 ring-1 ring-emerald-800/60">
              Curbside — no contact needed
            </span>
          ) : null}
          {listing.helpNeeded ? (
            <span className="chip bg-amber-950 text-amber-300 ring-1 ring-amber-900">
              Heavy — bring help
            </span>
          ) : null}
        </div>

        <section className="card mt-5 p-4">
          <h2 className="text-sm font-semibold text-zinc-300">What is in it</h2>
          <ul className="mt-3 divide-y divide-zinc-800">
            {listing.materials.map((material) => (
              <li
                key={material.materialKey + material.weightLbs}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-200">{material.materialName}</p>
                  {material.notes ? (
                    <p className="text-xs text-zinc-500">{material.notes}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <CategoryBadge category={material.category} />
                  <span className="text-sm text-zinc-400">{material.weightLbs} lbs</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-baseline justify-between border-t border-zinc-800 pt-3">
            <span className="text-sm text-zinc-400">Estimated yard payout</span>
            <span className="text-lg font-bold text-copper-300">
              {money(listing.estimatedValueCents)}
            </span>
          </div>
          <EstimateNote className="mt-2" />
        </section>

        <section className="card mt-4 overflow-hidden">
          <div className="h-64">
            <MapView
              center={[listing.lat, listing.lon]}
              zoom={listing.approximateLocation ? 13 : 16}
              listings={[listing]}
            />
          </div>
          <div className="p-4 text-sm">
            {listing.approximateLocation ? (
              <p className="text-zinc-500">
                Approximate location in {listing.city ?? 'this area'}. The exact address is shared
                as soon as the poster accepts a pickup.
              </p>
            ) : (
              <>
                <p className="font-medium text-zinc-200">
                  {listing.addressLine}
                  {listing.city ? `, ${listing.city}` : ''}
                  {listing.region ? `, ${listing.region}` : ''}
                </p>
                {listing.pickupNotes ? (
                  <p className="mt-1.5 whitespace-pre-line text-zinc-400">{listing.pickupNotes}</p>
                ) : null}
                <a
                  className="mt-2 inline-block text-copper-300 hover:underline"
                  href={`https://www.openstreetmap.org/directions?to=${listing.lat},${listing.lon}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Get directions →
                </a>
              </>
            )}
          </div>
        </section>

        {weather ? (
          <section className="card mt-4 p-4">
            <h2 className="text-sm font-semibold text-zinc-300">Best day to haul</h2>
            <div className="mt-3 grid grid-cols-5 gap-2 text-center text-xs">
              {weather.daily.slice(0, 5).map((day) => (
                <div
                  key={day.date}
                  className={`rounded-lg p-2 ${
                    day.haulScore === 'good'
                      ? 'bg-emerald-950/60 text-emerald-300'
                      : day.haulScore === 'fair'
                        ? 'bg-amber-950/50 text-amber-300'
                        : 'bg-red-950/40 text-red-300'
                  }`}
                >
                  <p className="font-medium">{dateOnly(day.date).split(',')[0]}</p>
                  <p className="mt-1 text-zinc-400">{day.highF !== null ? `${Math.round(day.highF)}°` : '—'}</p>
                  <p className="mt-0.5 text-[10px] opacity-80">{day.summary}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-zinc-600">{weather.attribution}</p>
          </section>
        ) : null}

        {canMessage ? (
          <section className="card mt-4 p-4">
            <h2 className="text-sm font-semibold text-zinc-300">
              {listing.isOwner ? `Messages with ${acceptedClaim?.scrapperName ?? 'the scrapper'}` : `Messages with ${listing.ownerName}`}
            </h2>

            <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
              {messages.length === 0 ? (
                <p className="py-4 text-center text-sm text-zinc-600">No messages yet.</p>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                      message.isMine
                        ? 'ml-auto bg-copper-900/50 text-copper-50'
                        : 'bg-ink-850 text-zinc-300'
                    }`}
                  >
                    <p className="whitespace-pre-line">{message.body}</p>
                    <p className="mt-1 text-[10px] text-zinc-500">{timeAgo(message.createdAt)}</p>
                  </div>
                ))
              )}
            </div>

            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!draft.trim()) return;
                const body = draft.trim();
                setDraft('');
                void act(async () => {
                  await api.sendMessage(id, body, counterpartyId);
                  await loadMessages(counterpartyId);
                });
              }}
            >
              <input
                className="field"
                value={draft}
                placeholder="Send a message…"
                maxLength={2000}
                onChange={(event) => setDraft(event.target.value)}
              />
              <button type="submit" className="btn-primary" disabled={busy || !draft.trim()}>
                Send
              </button>
            </form>
          </section>
        ) : null}

        {listing.isOwner && claims.length > 0 ? (
          <section className="card mt-4 p-4">
            <h2 className="text-sm font-semibold text-zinc-300">
              {claims.filter((claim) => claim.status === 'pending').length} scrapper
              {claims.filter((claim) => claim.status === 'pending').length === 1 ? '' : 's'} want this
            </h2>

            <ul className="mt-3 divide-y divide-zinc-800">
              {claims.map((claim) => (
                <li key={claim.id} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        to={`/profile/${claim.scrapperId}`}
                        className="text-sm font-medium text-zinc-200 hover:text-copper-300"
                      >
                        {claim.scrapperName}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2">
                        <Stars rating={claim.scrapperRating} />
                        <span className="text-xs text-zinc-600">
                          {claim.scrapperPickups} completed pickups
                        </span>
                      </div>
                      {claim.message ? (
                        <p className="mt-1.5 text-sm text-zinc-400">{claim.message}</p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 gap-2">
                      {claim.status === 'pending' ? (
                        <>
                          <button
                            type="button"
                            className="btn-primary py-1.5 text-xs"
                            disabled={busy}
                            onClick={() => void act(() => api.updateClaim(claim.id, 'accept'))}
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            className="btn-secondary py-1.5 text-xs"
                            disabled={busy}
                            onClick={() => void act(() => api.updateClaim(claim.id, 'decline'))}
                          >
                            Decline
                          </button>
                        </>
                      ) : (
                        <span className="chip bg-ink-850 text-zinc-500">{claim.status}</span>
                      )}
                      {claim.status === 'accepted' ? (
                        <button
                          type="button"
                          className="btn-primary py-1.5 text-xs"
                          disabled={busy}
                          onClick={() => void act(() => api.updateClaim(claim.id, 'complete'))}
                        >
                          Mark picked up
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {canReview && !reviewDone ? (
          <section className="card mt-4 p-4">
            <h2 className="text-sm font-semibold text-zinc-300">How did it go?</h2>
            <div className="mt-3 flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setReviewRating(value)}
                  className={`text-2xl ${value <= reviewRating ? 'text-amber-400' : 'text-zinc-700'}`}
                  aria-label={`${value} stars`}
                >
                  ★
                </button>
              ))}
            </div>
            <textarea
              className="field mt-3 min-h-20"
              placeholder="Anything worth telling the next person?"
              value={reviewComment}
              maxLength={1000}
              onChange={(event) => setReviewComment(event.target.value)}
            />
            <button
              type="button"
              className="btn-primary mt-3"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await api.review(id, reviewRating, reviewComment.trim());
                  setReviewDone(true);
                })
              }
            >
              Leave rating
            </button>
          </section>
        ) : null}
      </div>

      <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start">
        <div className="card p-4">
          <p className="text-xs tracking-wide text-zinc-500 uppercase">Posted by</p>
          <Link
            to={`/profile/${listing.ownerId}`}
            className="mt-1 block text-base font-semibold text-zinc-100 hover:text-copper-300"
          >
            {listing.ownerName}
          </Link>

          {!user ? (
            <div className="mt-4">
              <p className="text-sm text-zinc-400">
                Sign in to claim this pickup and message the poster.
              </p>
              <Link to="/register" className="btn-primary mt-3 w-full">
                Join free
              </Link>
              <Link to="/login" className="btn-secondary mt-2 w-full">
                Sign in
              </Link>
            </div>
          ) : listing.isOwner ? (
            <div className="mt-4 space-y-2">
              <p className="text-sm text-zinc-400">This is your listing.</p>
              {listing.status === 'open' || listing.status === 'claimed' ? (
                <button
                  type="button"
                  className="btn-secondary w-full"
                  disabled={busy}
                  onClick={() => void act(() => api.updateListing(id, { status: 'cancelled' }))}
                >
                  Cancel listing
                </button>
              ) : null}
              {listing.status !== 'completed' ? (
                <button
                  type="button"
                  className="btn-danger w-full"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm('Delete this listing for good?')) return;
                    void act(async () => {
                      await api.deleteListing(id);
                      navigate('/dashboard');
                    });
                  }}
                >
                  Delete
                </button>
              ) : null}
            </div>
          ) : myClaim && (myClaim.status === 'pending' || myClaim.status === 'accepted') ? (
            <div className="mt-4 space-y-2">
              <p
                className={`rounded-lg px-3 py-2 text-sm ${
                  myClaim.status === 'accepted'
                    ? 'bg-emerald-950/60 text-emerald-300'
                    : 'bg-amber-950/50 text-amber-300'
                }`}
              >
                {myClaim.status === 'accepted'
                  ? 'You are on for this pickup. The full address is above.'
                  : 'Your claim is waiting on the poster.'}
              </p>
              {myClaim.status === 'accepted' ? (
                <button
                  type="button"
                  className="btn-primary w-full"
                  disabled={busy}
                  onClick={() => void act(() => api.updateClaim(myClaim.id, 'complete'))}
                >
                  I picked it up
                </button>
              ) : null}
              <button
                type="button"
                className="btn-secondary w-full"
                disabled={busy}
                onClick={() => void act(() => api.updateClaim(myClaim.id, 'withdraw'))}
              >
                Withdraw
              </button>
            </div>
          ) : listing.status === 'open' ? (
            <div className="mt-4">
              <textarea
                className="field min-h-20"
                placeholder="Optional: when can you come by?"
                value={claimMessage}
                maxLength={1000}
                onChange={(event) => setClaimMessage(event.target.value)}
              />
              <button
                type="button"
                className="btn-primary mt-2 w-full"
                disabled={busy}
                onClick={() => void act(() => api.claim(id, claimMessage.trim()))}
              >
                I'll take it
              </button>
              <p className="mt-2 text-[11px] text-zinc-600">
                The poster gets notified and picks who comes. Nothing is shared until they accept.
              </p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-zinc-500">
              This one is {listing.status}. Check the map for what is still open.
            </p>
          )}
        </div>

        {listing.expiresAt && listing.status === 'open' ? (
          <p className="px-1 text-xs text-zinc-600">
            Expires {dateOnly(listing.expiresAt)} unless it gets claimed.
          </p>
        ) : null}
      </aside>
    </div>
  );
}
