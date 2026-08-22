import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { computeEntryHash, shortHash } from '@/lib/journal-chain';
import { formatCents } from '@/lib/money';
import { formatDate, formatDateTime } from '@/lib/dates';
import {
  ACT_TYPE_LABELS,
  IDENTITY_METHOD_LABELS,
  labelFor,
} from '@/lib/domain';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  DescriptionItem,
  DescriptionList,
  LinkButton,
  PageHeader,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Journal entry' };

export default async function JournalEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { created } = await searchParams;

  const entry = await prisma.journalEntry.findFirst({
    where: { id, userId: user.id },
    include: {
      signing: { select: { id: true, title: true } },
      amends: { select: { id: true, sequenceNumber: true, signerName: true } },
      amendedBy: {
        select: { id: true, sequenceNumber: true, amendmentReason: true, sealedAt: true },
        orderBy: { sequenceNumber: 'asc' },
      },
    },
  });

  if (!entry) notFound();

  // Recompute the digest from the stored fields. If it no longer matches, this
  // row was changed outside the application.
  const recomputed = computeEntryHash(entry, entry.previousHash);
  const intact = recomputed === entry.entryHash;

  return (
    <>
      <PageHeader
        title={`Journal entry #${entry.sequenceNumber}`}
        description={`Sealed ${formatDateTime(entry.sealedAt, user.timezone)}`}
        actions={
          <>
            <LinkButton href={`/journal/${entry.id}/amend`}>Add amendment</LinkButton>
            <LinkButton href="/journal">Back to journal</LinkButton>
          </>
        }
      />

      {created ? (
        <Alert tone="success" title="Entry sealed" className="mb-5">
          Entry #{entry.sequenceNumber} is now part of your journal chain.
        </Alert>
      ) : null}

      {!intact ? (
        <Alert tone="danger" title="This entry has been altered" className="mb-5">
          The stored digest does not match the entry's current contents. The record was changed
          outside this application — treat it as unreliable and preserve a copy of the database
          before doing anything else.
        </Alert>
      ) : null}

      {entry.amends ? (
        <Alert tone="warning" title="This entry amends an earlier one" className="mb-5">
          It corrects entry{' '}
          <Link
            href={`/journal/${entry.amends.id}`}
            className="font-medium text-seal-700 underline"
          >
            #{entry.amends.sequenceNumber}
          </Link>
          {entry.amendmentReason ? <> — {entry.amendmentReason}</> : null}
        </Alert>
      ) : null}

      {entry.amendedBy.length > 0 ? (
        <Alert tone="warning" title="This entry has been amended" className="mb-5">
          <ul className="mt-1 space-y-1">
            {entry.amendedBy.map((amendment) => (
              <li key={amendment.id}>
                <Link
                  href={`/journal/${amendment.id}`}
                  className="font-medium text-seal-700 underline"
                >
                  Entry #{amendment.sequenceNumber}
                </Link>
                {amendment.amendmentReason ? <> — {amendment.amendmentReason}</> : null}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="The act" />
            <CardBody>
              <DescriptionList>
                <DescriptionItem term="Performed">
                  {formatDateTime(entry.performedAt, user.timezone)}
                </DescriptionItem>
                <DescriptionItem term="Type of act">
                  {labelFor(ACT_TYPE_LABELS, entry.actType)}
                  {entry.notarizedRemotely ? (
                    <Badge tone="info" className="ml-2">
                      Remote — {entry.ronPlatform ?? 'platform not recorded'}
                    </Badge>
                  ) : null}
                </DescriptionItem>
                <DescriptionItem term="Document">{entry.documentType}</DescriptionItem>
                <DescriptionItem term="Document date">
                  {entry.documentDate ? formatDate(entry.documentDate, user.timezone) : '—'}
                </DescriptionItem>
                <DescriptionItem term="Signatures notarised">
                  {entry.numberOfSignatures}
                </DescriptionItem>
                <DescriptionItem term="Where performed">
                  {[entry.locationCity, entry.locationState].filter(Boolean).join(', ') || '—'}
                </DescriptionItem>
                {entry.documentDescription ? (
                  <DescriptionItem term="Description" wide>
                    {entry.documentDescription}
                  </DescriptionItem>
                ) : null}
                {entry.signing ? (
                  <DescriptionItem term="Signing" wide>
                    <Link
                      href={`/signings/${entry.signing.id}`}
                      className="text-seal-600 hover:underline"
                    >
                      {entry.signing.title}
                    </Link>
                  </DescriptionItem>
                ) : null}
              </DescriptionList>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Signer" />
            <CardBody>
              <DescriptionList>
                <DescriptionItem term="Name">{entry.signerName}</DescriptionItem>
                <DescriptionItem term="Phone">{entry.signerPhone ?? '—'}</DescriptionItem>
                <DescriptionItem term="Address" wide>
                  {[
                    entry.signerAddressLine1,
                    entry.signerCity,
                    entry.signerState,
                    entry.signerPostalCode,
                  ]
                    .filter(Boolean)
                    .join(', ') || '—'}
                </DescriptionItem>
                <DescriptionItem term="Email">{entry.signerEmail ?? '—'}</DescriptionItem>
                {entry.witnessNames ? (
                  <DescriptionItem term="Witnesses">{entry.witnessNames}</DescriptionItem>
                ) : null}
              </DescriptionList>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Identification" />
            <CardBody>
              <DescriptionList>
                <DescriptionItem term="Method" wide>
                  {labelFor(IDENTITY_METHOD_LABELS, entry.identityMethod)}
                </DescriptionItem>
                {entry.identityMethod === 'IDENTIFICATION_DOCUMENT' ? (
                  <>
                    <DescriptionItem term="Document">{entry.idType ?? '—'}</DescriptionItem>
                    <DescriptionItem term="Issued by">{entry.idIssuer ?? '—'}</DescriptionItem>
                    <DescriptionItem term="Last four digits">
                      {entry.idNumberLast4 ? `••••${entry.idNumberLast4}` : '—'}
                    </DescriptionItem>
                    <DescriptionItem term="Expires">
                      {entry.idExpiresOn ? formatDate(entry.idExpiresOn, user.timezone) : '—'}
                    </DescriptionItem>
                  </>
                ) : null}
                {entry.credibleWitnessName ? (
                  <DescriptionItem term="Credible witness" wide>
                    {entry.credibleWitnessName}
                    {entry.credibleWitnessAddress ? ` — ${entry.credibleWitnessAddress}` : ''}
                    {entry.secondCredibleWitnessName
                      ? `; second witness: ${entry.secondCredibleWitnessName}`
                      : ''}
                  </DescriptionItem>
                ) : null}
                <DescriptionItem term="Thumbprint">
                  {entry.thumbprintTaken ? 'Recorded' : 'Not recorded'}
                </DescriptionItem>
              </DescriptionList>
            </CardBody>
          </Card>

          {entry.notes ? (
            <Card>
              <CardHeader title="Notes" />
              <CardBody>
                <p className="text-sm whitespace-pre-wrap text-[var(--text)]">{entry.notes}</p>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Fees" />
            <CardBody>
              <DescriptionList>
                <DescriptionItem term="Notarial fee">
                  <span className="tabular">{formatCents(entry.feeChargedCents)}</span>
                  <span className="block text-xs text-[var(--text-subtle)]">
                    Exempt from self-employment tax
                  </span>
                </DescriptionItem>
                <DescriptionItem term="Travel fee">
                  <span className="tabular">{formatCents(entry.travelFeeCents)}</span>
                  <span className="block text-xs text-[var(--text-subtle)]">
                    Subject to self-employment tax
                  </span>
                </DescriptionItem>
              </DescriptionList>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Chain" />
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--text-muted)]">Integrity</span>
                {intact ? <Badge tone="success">Intact</Badge> : <Badge tone="danger">Altered</Badge>}
              </div>
              <div>
                <p className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
                  This entry
                </p>
                <p className="mt-0.5 font-mono text-xs break-all text-[var(--text)]">
                  {entry.entryHash}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
                  Links to previous
                </p>
                <p className="mt-0.5 font-mono text-xs break-all text-[var(--text-muted)]">
                  {entry.previousHash ?? 'GENESIS — first entry in the journal'}
                </p>
              </div>
              <p className="text-xs leading-relaxed text-[var(--text-subtle)]">
                Each entry's digest covers its own contents plus the digest before it. Changing any
                historical entry breaks every digest after it, which is what makes tampering
                visible rather than merely disallowed.
              </p>
              <LinkButton href="/journal/verify" className="w-full">
                Verify whole chain
              </LinkButton>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Fingerprint" />
            <CardBody>
              <p className="font-mono text-sm text-[var(--text)]">{shortHash(entry.entryHash)}</p>
              <p className="mt-1 text-xs text-[var(--text-subtle)]">
                Short form for reading aloud or citing in correspondence.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
