import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client.ts';
import type { Listing, User } from '../api/types.ts';
import { ListingCard } from '../components/ListingCard.tsx';
import { EmptyState, Spinner, Stars } from '../components/ui.tsx';
import { dateOnly, timeAgo, weight } from '../lib/format.ts';

const ROLE_LABELS: Record<string, string> = {
  homeowner: 'Posts scrap',
  scrapper: 'Collects scrap',
  both: 'Posts and collects',
};

export function Profile() {
  const { id = '' } = useParams();
  const [user, setUser] = useState<User | null>(null);
  const [reviews, setReviews] = useState<
    { rating: number; comment: string; createdAt: string; raterName: string }[]
  >([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .getUser(id)
      .then((data) => {
        setUser(data.user);
        setReviews(data.reviews);
        return api.browse({ ownerId: id, status: 'open', limit: 20 });
      })
      .then((data) => setListings(data.listings))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Spinner />;
  if (!user) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <EmptyState title="No such member" body="That profile does not exist or was deactivated." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="card p-5">
        <h1 className="text-2xl font-bold text-zinc-100">{user.displayName}</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          {ROLE_LABELS[user.role] ?? user.role}
          {user.city ? ` · ${user.city}${user.region ? `, ${user.region}` : ''}` : ''}
          {' · joined '}
          {dateOnly(user.memberSince)}
        </p>

        <div className="mt-3">
          <Stars rating={user.rating} count={user.reviewCount} />
        </div>

        {user.bio ? <p className="mt-3 text-sm text-zinc-300">{user.bio}</p> : null}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-ink-850 p-3">
            <p className="text-xs text-zinc-500">Completed pickups</p>
            <p className="mt-0.5 text-xl font-bold text-zinc-100">{user.completedPickups}</p>
          </div>
          <div className="rounded-lg bg-ink-850 p-3">
            <p className="text-xs text-zinc-500">Metal moved</p>
            <p className="mt-0.5 text-xl font-bold text-copper-300">
              {weight(user.poundsDiverted)}
            </p>
          </div>
        </div>
      </div>

      {listings.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-base font-semibold text-zinc-200">Open listings</h2>
          <div className="mt-3 space-y-3">
            {listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="text-base font-semibold text-zinc-200">Ratings</h2>
        {reviews.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600">No ratings yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {reviews.map((review, index) => (
              <li key={index} className="card p-3">
                <div className="flex items-center justify-between">
                  <span className="text-amber-400" aria-label={`${review.rating} of 5`}>
                    {'★'.repeat(review.rating)}
                    <span className="text-zinc-700">{'★'.repeat(5 - review.rating)}</span>
                  </span>
                  <span className="text-xs text-zinc-600">{timeAgo(review.createdAt)}</span>
                </div>
                {review.comment ? (
                  <p className="mt-1.5 text-sm text-zinc-300">{review.comment}</p>
                ) : null}
                <p className="mt-1 text-xs text-zinc-600">— {review.raterName}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
