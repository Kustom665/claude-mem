import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client.ts';
import type { Community, CommunityEvent, Listing } from '../api/types.ts';
import { useAuth } from '../state/auth.tsx';
import { AddressSearch } from '../components/AddressSearch.tsx';
import { ListingCard } from '../components/ListingCard.tsx';
import { EmptyState, ErrorNote, Field, Spinner } from '../components/ui.tsx';
import { dateTime, weight } from '../lib/format.ts';

export function CommunityList() {
  const { user } = useAuth();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [place, setPlace] = useState<{ lat: number; lon: number; city?: string; region?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .communities({})
      .then((data) => setCommunities(data.communities))
      .catch(() => setCommunities([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.createCommunity({
        name,
        description,
        lat: place?.lat ?? null,
        lon: place?.lon ?? null,
        city: place?.city ?? null,
        region: place?.region ?? null,
      });
      setCreating(false);
      setName('');
      setDescription('');
      load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create that group.');
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Neighborhood groups</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Streets and neighborhoods that pool their scrap so one hauler can do a single run.
          </p>
        </div>
        {user ? (
          <button type="button" className="btn-secondary" onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancel' : 'Start a group'}
          </button>
        ) : null}
      </div>

      {creating ? (
        <form className="card mt-4 space-y-3 p-4" onSubmit={create}>
          {error ? <ErrorNote message={error} /> : null}
          <Field label="Group name" required>
            <input
              className="field"
              value={name}
              maxLength={80}
              placeholder="e.g. Maple Street Cleanup Crew"
              onChange={(event) => setName(event.target.value)}
              required
            />
          </Field>
          <Field label="What is this group for?">
            <textarea
              className="field min-h-24"
              value={description}
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <Field label="Where is it centered?">
            <AddressSearch
              placeholder="Neighborhood, town, or ZIP"
              onSelect={(result) =>
                setPlace({
                  lat: result.lat,
                  lon: result.lon,
                  city: result.city ?? undefined,
                  region: result.region ?? undefined,
                })
              }
            />
          </Field>
          <button type="submit" className="btn-primary">
            Create group
          </button>
        </form>
      ) : null}

      <div className="mt-5 space-y-3">
        {loading ? <Spinner /> : null}

        {!loading && communities.length === 0 ? (
          <EmptyState
            title="No groups yet"
            body="A group is just a name and a neighborhood. Start one and invite the street — it works best when a few houses pool metal for a single pickup."
          />
        ) : null}

        {communities.map((community) => (
          <Link
            key={community.id}
            to={`/communities/${community.slug}`}
            className="card block p-4 transition-colors hover:border-copper-700"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="text-base font-semibold text-zinc-100">{community.name}</h2>
              {community.isMember ? (
                <span className="chip bg-emerald-950 text-emerald-300">member</span>
              ) : null}
            </div>
            {community.city ? (
              <p className="text-xs text-zinc-500">
                {community.city}
                {community.region ? `, ${community.region}` : ''}
              </p>
            ) : null}
            <p className="mt-2 line-clamp-2 text-sm text-zinc-400">{community.description}</p>
            <p className="mt-2 flex flex-wrap gap-x-3 text-xs text-zinc-600">
              <span>{community.memberCount} members</span>
              <span>{community.openListings} open listings</span>
              <span>{weight(community.poundsDiverted)} diverted</span>
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function CommunityDetail() {
  const { slug = '' } = useParams();
  const { user } = useAuth();

  const [community, setCommunity] = useState<Community | null>(null);
  const [members, setMembers] = useState<{ id: string; displayName: string; role: string }[]>([]);
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEventForm, setShowEventForm] = useState(false);
  const [eventTitle, setEventTitle] = useState('');
  const [eventDescription, setEventDescription] = useState('');
  const [eventStart, setEventStart] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.community(slug);
      setCommunity(data.community);
      setMembers(data.members);
      const [eventData, listingData] = await Promise.all([
        api.events(slug).catch(() => ({ events: [] })),
        api
          .browse({ communityId: data.community.id, status: 'any', limit: 30 })
          .catch(() => ({ listings: [] as Listing[] })),
      ]);
      setEvents(eventData.events);
      setListings(listingData.listings);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load that group.');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Spinner />;
  if (!community) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <ErrorNote message={error ?? 'No such group.'} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <Link to="/communities" className="text-sm text-zinc-500 hover:text-zinc-300">
        ← All groups
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">{community.name}</h1>
          {community.city ? (
            <p className="text-sm text-zinc-500">
              {community.city}
              {community.region ? `, ${community.region}` : ''}
            </p>
          ) : null}
        </div>

        {user ? (
          community.isMember ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                void api
                  .leaveCommunity(slug)
                  .then(load)
                  .catch((caught: ApiError) => setError(caught.message))
              }
            >
              Leave group
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              onClick={() => void api.joinCommunity(slug).then(load).catch(() => undefined)}
            >
              Join group
            </button>
          )
        ) : null}
      </div>

      {error ? <div className="mt-3"><ErrorNote message={error} /></div> : null}

      <p className="mt-3 whitespace-pre-line text-zinc-300">{community.description}</p>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="Members" value={String(community.memberCount)} />
        <Stat label="Open listings" value={String(community.openListings)} />
        <Stat label="Diverted" value={weight(community.poundsDiverted)} />
      </div>

      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-200">Upcoming events</h2>
          {community.isMember ? (
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setShowEventForm((value) => !value)}
            >
              {showEventForm ? 'Cancel' : '+ Schedule one'}
            </button>
          ) : null}
        </div>

        {showEventForm ? (
          <form
            className="card mt-3 space-y-3 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void api
                .createEvent(slug, {
                  title: eventTitle,
                  description: eventDescription,
                  startsAt: new Date(eventStart).toISOString(),
                })
                .then(() => {
                  setShowEventForm(false);
                  setEventTitle('');
                  setEventDescription('');
                  setEventStart('');
                  return load();
                })
                .catch((caught: ApiError) => setError(caught.message));
            }}
          >
            <Field label="What is happening?" required>
              <input
                className="field"
                value={eventTitle}
                maxLength={120}
                placeholder="Spring scrap drive"
                onChange={(event) => setEventTitle(event.target.value)}
                required
              />
            </Field>
            <Field label="Details">
              <textarea
                className="field min-h-20"
                value={eventDescription}
                maxLength={2000}
                onChange={(event) => setEventDescription(event.target.value)}
              />
            </Field>
            <Field label="When" required>
              <input
                className="field"
                type="datetime-local"
                value={eventStart}
                onChange={(event) => setEventStart(event.target.value)}
                required
              />
            </Field>
            <button type="submit" className="btn-primary">
              Schedule it
            </button>
          </form>
        ) : null}

        <div className="mt-3 space-y-2">
          {events.length === 0 ? (
            <p className="text-sm text-zinc-600">Nothing scheduled.</p>
          ) : (
            events.map((event) => (
              <div key={event.id} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">{event.title}</h3>
                    <p className="text-xs text-copper-300">{dateTime(event.startsAt)}</p>
                  </div>
                  <span className="text-xs text-zinc-500">{event.goingCount} going</span>
                </div>
                {event.description ? (
                  <p className="mt-2 whitespace-pre-line text-sm text-zinc-400">
                    {event.description}
                  </p>
                ) : null}
                {event.addressLine ? (
                  <p className="mt-1 text-xs text-zinc-500">📍 {event.addressLine}</p>
                ) : null}
                {user ? (
                  <div className="mt-3 flex gap-2">
                    {(['going', 'maybe', 'declined'] as const).map((status) => (
                      <button
                        key={status}
                        type="button"
                        className={`chip border ${
                          event.myRsvp === status
                            ? 'border-copper-600 bg-copper-950/60 text-copper-200'
                            : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'
                        }`}
                        onClick={() => void api.rsvp(event.id, status).then(load)}
                      >
                        {status === 'declined' ? "can't make it" : status}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-base font-semibold text-zinc-200">Listings from this group</h2>
        <div className="mt-3 space-y-3">
          {listings.length === 0 ? (
            <p className="text-sm text-zinc-600">Nothing posted to the group yet.</p>
          ) : (
            listings.map((listing) => <ListingCard key={listing.id} listing={listing} />)
          )}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-base font-semibold text-zinc-200">Members</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {members.map((member) => (
            <li key={member.id}>
              <Link
                to={`/profile/${member.id}`}
                className="chip border border-zinc-700 text-zinc-300 hover:border-copper-600"
              >
                {member.displayName}
                {member.role === 'organizer' ? (
                  <span className="text-copper-400"> · organizer</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3 text-center">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-zinc-100">{value}</p>
    </div>
  );
}
