import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyJournal } from '@/lib/journal';
import { shortHash } from '@/lib/journal-chain';
import { formatDateTime } from '@/lib/dates';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  LinkButton,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Verify journal chain' };

const BREAK_EXPLANATIONS: Record<string, string> = {
  HASH_MISMATCH:
    'The entry’s contents no longer match the digest recorded when it was sealed. Someone edited the row directly in the database.',
  BROKEN_LINK:
    'The entry does not link to the digest of the entry before it. An entry was inserted or replaced.',
  SEQUENCE_GAP: 'A journal number is missing. An entry was deleted.',
  DUPLICATE_SEQUENCE: 'Two entries claim the same journal number.',
};

export default async function VerifyJournalPage() {
  const user = await requireUser();
  const [result, latest] = await Promise.all([
    verifyJournal(user.id),
    prisma.journalEntry.findFirst({
      where: { userId: user.id },
      orderBy: { sequenceNumber: 'desc' },
      select: { sequenceNumber: true, entryHash: true, sealedAt: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Journal integrity"
        description="Recomputes every digest in your journal and confirms each entry still links to the one before it."
        actions={<LinkButton href="/journal">Back to journal</LinkButton>}
      />

      <section className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Entries checked"
          value={result.entriesChecked.toLocaleString('en-US')}
        />
        <StatTile
          label="Status"
          value={result.ok ? 'Verified' : `${result.breaks.length} problems`}
          tone={result.ok ? 'success' : 'danger'}
        />
        <StatTile
          label="Head digest"
          value={<span className="font-mono text-base">{shortHash(result.headHash)}</span>}
          sublabel={latest ? `Entry #${latest.sequenceNumber}` : 'No entries yet'}
        />
      </section>

      {result.ok ? (
        <Alert tone="success" title="Chain verified" className="mb-5">
          Every entry’s digest matches its contents and links correctly to its predecessor. Nothing
          in this journal has been altered since it was sealed.
        </Alert>
      ) : (
        <Alert tone="danger" title="Chain verification failed" className="mb-5">
          The journal does not match its own digests. Preserve a copy of the database now, before
          any further writes, and treat the affected entries as unreliable evidence.
        </Alert>
      )}

      {result.breaks.length > 0 ? (
        <Card className="mb-5">
          <CardHeader title="What failed" />
          <Table>
            <thead>
              <tr>
                <Th>Entry</Th>
                <Th>Problem</Th>
                <Th>What it means</Th>
              </tr>
            </thead>
            <tbody>
              {result.breaks.map((issue, index) => (
                <tr key={`${issue.sequenceNumber}-${issue.kind}-${index}`}>
                  <Td className="tabular whitespace-nowrap">#{issue.sequenceNumber}</Td>
                  <Td>
                    <Badge tone="danger">{issue.kind.replace(/_/g, ' ').toLowerCase()}</Badge>
                    <span className="mt-1 block text-xs text-[var(--text-muted)]">
                      {issue.detail}
                    </span>
                  </Td>
                  <Td className="text-[var(--text-muted)]">
                    {BREAK_EXPLANATIONS[issue.kind] ?? '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="What this proves, and what it does not" />
        <CardBody className="space-y-3 text-sm leading-relaxed text-[var(--text-muted)]">
          <p>
            Every sealed entry carries a SHA-256 digest computed over its own contents together
            with the digest of the entry before it. Editing a historical entry changes its digest,
            which breaks the link to the entry after it, and so on to the end of the journal. A
            single silent edit is therefore not possible — the damage is visible.
          </p>
          <p>
            What this does <strong>not</strong> prove is that nobody with database access rewrote
            the whole chain. An attacker who can edit rows can also recompute every digest. The
            defence against that is external: record your head digest somewhere outside this
            system — email it to yourself monthly, or write it in a paper notebook. A digest held
            elsewhere on a known date turns "internally consistent" into "provably unchanged since
            then".
          </p>
          {latest ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
              <p className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
                Current head digest — entry #{latest.sequenceNumber}, sealed{' '}
                {formatDateTime(latest.sealedAt, user.timezone)}
              </p>
              <p className="mt-1 font-mono text-xs break-all text-[var(--text)]">
                {latest.entryHash}
              </p>
            </div>
          ) : null}
        </CardBody>
      </Card>
    </>
  );
}
