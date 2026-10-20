import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.ts';
import type { Claim, Listing } from '../api/types.ts';
import { useAuth } from '../state/auth.tsx';
import { ListingCard } from '../components/ListingCard.tsx';
import { EmptyState, Spinner, Stars } from '../components/ui.tsx';
import { money, timeAgo, weight } from '../lib/format.ts';

type Tab = 'posted' | 'claims' | 'hauled';

export function Dashboard() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('posted');
  const [posted, setPosted] = useState<Listing[]>([]);
  const [hauled, setHauled] = useState<Listing[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([
      api.browse({ ownerId: user.id, status: 'any', sort: 'newest', limit: 100 }),
      api.browse({ claimedBy: user.id, status: 'any', sort: 'newest', limit: 100 }),
      api.myClaims(),
    ])
      .then(([mine, taken, myClaims]) => {
        setPosted(mine.listings);
        setHauled(taken.listings);
        setClaims(myClaims.claims);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) return null;

  const openPosted = posted.filter((listing) => listing.status === 'open').length;
  const pendingClaims = claims.filter((claim) => claim.status === 'pending').length;

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: 'posted', label: 'My listings', count: posted.length },
    { key: 'claims', label: 'My claims', count: claims.length },
    { key: 'hauled', label: 'Picked up', count: hauled.length },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">{user.displayName}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-zinc-500">
            <Stars rating={user.rating} count={user.reviewCount} />
            <span>·</span>
            <span>{user.completedPickups} completed</span>
            <span>·</span>
            <span>{weight(user.poundsDiverted)} kept out of the landfill</span>
          </div>
        </div>
        <Link to="/post" className="btn-primary">
          Post scrap
        </Link>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Open listings" value={String(openPosted)} />
        <StatCard label="Claims waiting on you" value={String(pendingClaims)} />
        <StatCard label="Metal moved" value={weight(user.poundsDiverted)} />
      </div>

      <div className="mt-6 flex gap-1 border-b border-zinc-800">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === item.key
                ? 'border-copper-500 text-copper-300'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {item.label}
            <span className="ml-1.5 text-xs text-zinc-600">{item.count}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {loading ? <Spinner /> : null}

        {!loading && tab === 'posted' ? (
          posted.length === 0 ? (
            <EmptyState
              title="You have not posted anything yet"
              body="Copper pipe, old wire, a dead appliance — if it is metal, somebody nearby wants it."
              action={
                <Link to="/post" className="btn-primary mt-1">
                  Post your first pile
                </Link>
              }
            />
          ) : (
            posted.map((listing) => <ListingCard key={listing.id} listing={listing} />)
          )
        ) : null}

        {!loading && tab === 'claims' ? (
          claims.length === 0 ? (
            <EmptyState
              title="No claims yet"
              body="Find scrap near you on the map and hit “I'll take it”. The poster gets notified and picks who comes."
              action={
                <Link to="/" className="btn-primary mt-1">
                  Browse the map
                </Link>
              }
            />
          ) : (
            claims.map((claim) => (
              <Link
                key={claim.id}
                to={`/listing/${claim.listingId}`}
                className="card block p-3 transition-colors hover:border-copper-700"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-zinc-200">{claim.listingTitle}</p>
                  <span
                    className={`chip ${
                      claim.status === 'accepted'
                        ? 'bg-emerald-950 text-emerald-300'
                        : claim.status === 'pending'
                          ? 'bg-amber-950 text-amber-300'
                          : 'bg-ink-850 text-zinc-500'
                    }`}
                  >
                    {claim.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">Claimed {timeAgo(claim.createdAt)}</p>
              </Link>
            ))
          )
        ) : null}

        {!loading && tab === 'hauled' ? (
          hauled.length === 0 ? (
            <EmptyState
              title="Nothing hauled yet"
              body="Pickups you complete show up here, along with what they were worth."
            />
          ) : (
            <>
              <p className="text-sm text-zinc-500">
                {weight(hauled.reduce((sum, listing) => sum + listing.totalWeightLbs, 0))} total,
                estimated{' '}
                {money(hauled.reduce((sum, listing) => sum + listing.estimatedValueCents, 0))} in
                yard value.
              </p>
              {hauled.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </>
          )
        ) : null}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs tracking-wide text-zinc-500 uppercase">{label}</p>
      <p className="mt-1 text-2xl font-bold text-zinc-100">{value}</p>
    </div>
  );
}
