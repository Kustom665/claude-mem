import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.ts';
import type { StatsResponse } from '../api/types.ts';
import { Spinner } from '../components/ui.tsx';
import { money, weight } from '../lib/format.ts';

export function Impact() {
  const [stats, setStats] = useState<StatsResponse | null>(null);

  useEffect(() => {
    api.stats().then(setStats).catch(() => setStats(null));
  }, []);

  if (!stats) return <Spinner label="Adding it up" />;

  const { totals, leaderboard, byMaterial } = stats;
  const maxPounds = Math.max(1, ...byMaterial.map((row) => row.poundsDiverted));

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-2xl font-bold text-zinc-100">What this community has moved</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Every completed pickup is metal that got recycled instead of buried, and money that stayed
        in the neighborhood.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Big label="Metal diverted" value={weight(totals.poundsDiverted)} accent />
        <Big label="Completed pickups" value={totals.completedPickups.toLocaleString()} />
        <Big label="Estimated value" value={money(totals.estimatedValueCents)} />
        <Big label="Open right now" value={totals.openListings.toLocaleString()} />
      </div>

      <p className="mt-3 text-xs text-zinc-600">
        {totals.members.toLocaleString()} members across {totals.communities} groups
        {totals.tonsDiverted >= 0.01 ? ` · that is ${totals.tonsDiverted} tons` : ''}.
      </p>

      {byMaterial.length > 0 ? (
        <section className="card mt-6 p-4">
          <h2 className="text-sm font-semibold text-zinc-300">By material</h2>
          <ul className="mt-3 space-y-2">
            {byMaterial.map((row) => (
              <li key={row.materialKey}>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-zinc-400">{row.materialName}</span>
                  <span className="text-zinc-500">{weight(row.poundsDiverted)}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-850">
                  <div
                    className="h-full rounded-full bg-copper-500"
                    style={{ width: `${(row.poundsDiverted / maxPounds) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Board
          title="Top haulers"
          empty="Nobody has completed a pickup yet."
          rows={leaderboard.scrappers.map((row) => ({
            id: row.id,
            name: row.displayName,
            primary: weight(row.poundsDiverted),
            secondary: `${row.pickups} pickups`,
          }))}
        />
        <Board
          title="Top posters"
          empty="No completed listings yet."
          rows={leaderboard.posters.map((row) => ({
            id: row.id,
            name: row.displayName,
            primary: weight(row.poundsDiverted),
            secondary: `${row.posts} listings`,
          }))}
        />
      </div>
    </div>
  );
}

function Big({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="card p-4">
      <p className="text-xs tracking-wide text-zinc-500 uppercase">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accent ? 'text-copper-300' : 'text-zinc-100'}`}>
        {value}
      </p>
    </div>
  );
}

function Board({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: { id: string; name: string; primary: string; secondary: string }[];
  empty: string;
}) {
  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold text-zinc-300">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-600">{empty}</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {rows.map((row, index) => (
            <li key={row.id} className="flex items-center gap-3">
              <span className="w-5 shrink-0 text-sm font-bold text-zinc-600">{index + 1}</span>
              <Link
                to={`/profile/${row.id}`}
                className="min-w-0 flex-1 truncate text-sm text-zinc-200 hover:text-copper-300"
              >
                {row.name}
              </Link>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-medium text-copper-300">{row.primary}</span>
                <span className="block text-[11px] text-zinc-600">{row.secondary}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
