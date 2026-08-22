import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import type { Prisma } from '@/generated/prisma';
import { verifyJournal } from '@/lib/journal';
import { formatCents } from '@/lib/money';
import { formatDate, formatDateTime } from '@/lib/dates';
import { ACT_TYPE_LABELS, IDENTITY_METHOD_LABELS, labelFor } from '@/lib/domain';
import { LinkButton } from '@/components/ui';

export const metadata: Metadata = { title: 'Printable journal' };

/**
 * Printable journal.
 *
 * Produced for a commissioning-authority audit or a subpoena. Includes the
 * integrity statement and per-entry digests, because a printout without them is
 * just a list — the digests are what let a recipient verify the export against
 * the electronic original.
 */
export default async function PrintJournalPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const where: Prisma.JournalEntryWhereInput = { userId: user.id };
  if (params.from || params.to) {
    where.performedAt = {};
    if (params.from) where.performedAt.gte = new Date(params.from);
    if (params.to) {
      const end = new Date(params.to);
      end.setHours(23, 59, 59, 999);
      where.performedAt.lte = end;
    }
  }

  const [entries, chain] = await Promise.all([
    prisma.journalEntry.findMany({ where, orderBy: { sequenceNumber: 'asc' } }),
    verifyJournal(user.id),
  ]);

  const rangeLabel =
    params.from || params.to
      ? `${params.from ? formatDate(params.from, user.timezone) : 'the beginning'} to ${
          params.to ? formatDate(params.to, user.timezone) : 'today'
        }`
      : 'complete journal';

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-5 flex flex-wrap gap-2">
        <LinkButton href="/journal">Back to journal</LinkButton>
        <span className="self-center text-sm text-[var(--text-muted)]">
          Use your browser’s print command (Ctrl/Cmd + P) to print or save as PDF.
        </span>
      </div>

      <header className="print-avoid-break mb-6 border-b-2 border-[var(--border-strong)] pb-4">
        <h1 className="text-xl font-bold text-[var(--text)]">Notarial Journal</h1>
        <p className="mt-1 text-sm text-[var(--text)]">
          {user.name}
          {user.businessName ? ` — ${user.businessName}` : ''}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-[var(--text-muted)] sm:grid-cols-4">
          <div>
            <dt className="font-semibold">Commission</dt>
            <dd>{user.commissionNumber ?? '—'}</dd>
          </div>
          <div>
            <dt className="font-semibold">Jurisdiction</dt>
            <dd>
              {[user.commissionCounty, user.commissionState].filter(Boolean).join(', ') || '—'}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Commission expires</dt>
            <dd>
              {user.commissionExpiresOn
                ? formatDate(user.commissionExpiresOn, user.timezone)
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Records</dt>
            <dd>
              {entries.length} ({rangeLabel})
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-[var(--text-muted)]">
          <strong>Integrity statement.</strong> Each entry below carries a SHA-256 digest computed
          over its contents together with the digest of the preceding entry. At the time this
          document was produced the chain was{' '}
          <strong>{chain.ok ? 'verified intact' : `BROKEN (${chain.breaks.length} problems)`}</strong>{' '}
          across {chain.entriesChecked} entries. Head digest:{' '}
          <span className="font-mono break-all">{chain.headHash ?? '—'}</span>. Produced{' '}
          {formatDateTime(new Date(), user.timezone)}.
        </p>
      </header>

      {entries.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No entries in this range.</p>
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => (
            <article
              key={entry.id}
              className="print-avoid-break rounded-lg border border-[var(--border)] p-4"
            >
              <div className="mb-2 flex items-baseline justify-between gap-4 border-b border-[var(--border)] pb-2">
                <h2 className="text-sm font-bold text-[var(--text)]">
                  Entry #{entry.sequenceNumber}
                </h2>
                <span className="text-xs text-[var(--text-muted)]">
                  {formatDateTime(entry.performedAt, user.timezone)}
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
                <Row term="Act" value={labelFor(ACT_TYPE_LABELS, entry.actType)} />
                <Row term="Document" value={entry.documentType} />
                <Row
                  term="Document date"
                  value={entry.documentDate ? formatDate(entry.documentDate, user.timezone) : '—'}
                />
                <Row term="Signatures" value={String(entry.numberOfSignatures)} />
                <Row term="Signer" value={entry.signerName} />
                <Row
                  term="Signer address"
                  value={
                    [
                      entry.signerAddressLine1,
                      entry.signerCity,
                      entry.signerState,
                      entry.signerPostalCode,
                    ]
                      .filter(Boolean)
                      .join(', ') || '—'
                  }
                />
                <Row
                  term="Identified by"
                  value={labelFor(IDENTITY_METHOD_LABELS, entry.identityMethod)}
                />
                <Row
                  term="Identification"
                  value={
                    entry.idType
                      ? `${entry.idType}${entry.idIssuer ? ` (${entry.idIssuer})` : ''}${
                          entry.idNumberLast4 ? ` ••••${entry.idNumberLast4}` : ''
                        }`
                      : (entry.credibleWitnessName ?? '—')
                  }
                />
                <Row term="Fee" value={formatCents(entry.feeChargedCents)} />
                {entry.travelFeeCents > 0 ? (
                  <Row term="Travel fee" value={formatCents(entry.travelFeeCents)} />
                ) : null}
                <Row
                  term="Where performed"
                  value={
                    [entry.locationCity, entry.locationState].filter(Boolean).join(', ') || '—'
                  }
                />
                <Row term="Thumbprint" value={entry.thumbprintTaken ? 'Recorded' : 'No'} />
                {entry.notarizedRemotely ? (
                  <Row term="Remote platform" value={entry.ronPlatform ?? 'Yes'} />
                ) : null}
                {entry.witnessNames ? <Row term="Witnesses" value={entry.witnessNames} /> : null}
                {entry.documentDescription ? (
                  <Row term="Description" value={entry.documentDescription} span />
                ) : null}
                {entry.notes ? <Row term="Notes" value={entry.notes} span /> : null}
                {entry.amendmentReason ? (
                  <Row term="Amendment" value={entry.amendmentReason} span />
                ) : null}
              </dl>

              <p className="mt-2 border-t border-[var(--border)] pt-2 font-mono text-[10px] leading-tight break-all text-[var(--text-subtle)]">
                digest {entry.entryHash}
                <br />
                prev {entry.previousHash ?? 'GENESIS'}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ term, value, span }: { term: string; value: string; span?: boolean }) {
  return (
    <div className={span ? 'col-span-2 sm:col-span-3' : undefined}>
      <dt className="font-semibold text-[var(--text-muted)]">{term}</dt>
      <dd className="break-words text-[var(--text)]">{value}</dd>
    </div>
  );
}
