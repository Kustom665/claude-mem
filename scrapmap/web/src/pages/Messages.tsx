import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.ts';
import type { Thread } from '../api/types.ts';
import { EmptyState, Spinner } from '../components/ui.tsx';
import { timeAgo } from '../lib/format.ts';

export function Messages() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .threads()
      .then((data) => setThreads(data.threads))
      .catch(() => setThreads([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-bold text-zinc-100">Messages</h1>

      <div className="mt-5 space-y-2">
        {loading ? <Spinner /> : null}

        {!loading && threads.length === 0 ? (
          <EmptyState
            title="No conversations yet"
            body="When you claim a pickup or someone claims yours, the conversation shows up here."
            action={
              <Link to="/" className="btn-primary mt-1">
                Find scrap nearby
              </Link>
            }
          />
        ) : null}

        {threads.map((thread) => (
          <Link
            key={`${thread.listingId}:${thread.withUserId}`}
            to={`/listing/${thread.listingId}`}
            className="card block p-3 transition-colors hover:border-copper-700"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-100">
                  {thread.withUserName}
                </p>
                <p className="truncate text-xs text-zinc-500">{thread.listingTitle}</p>
                <p className="mt-1.5 truncate text-sm text-zinc-400">{thread.lastMessage}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[11px] text-zinc-600">{timeAgo(thread.lastMessageAt)}</p>
                {thread.unread > 0 ? (
                  <span className="mt-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-copper-500 px-1.5 text-[11px] font-bold text-white">
                    {thread.unread}
                  </span>
                ) : null}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
