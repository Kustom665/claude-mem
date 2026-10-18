import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import type { Prisma } from '@/generated/prisma';
import { journalFieldRulesFor } from '@/lib/compliance';
import { formatCents } from '@/lib/money';
import { formatDateTime } from '@/lib/dates';
import { ACT_TYPE_LABELS, IDENTITY_METHOD_LABELS, labelFor } from '@/lib/domain';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Table,
  Td,
  Th,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Journal inspection' };

/**
 * Public inspection view.
 *
 * Pennsylvania requires a notary to permit any person who asks — orally or in
 * writing — to inspect the journal in the notary's presence. Handing over the
 * whole journal would expose every other signer's address, phone number and
 * identification details, so this view is deliberately narrow: it requires a
 * search term, returns only matching entries, and shows only the facts of the
 * act itself.
 *
 * Nothing here is a legal determination of what a given requester is entitled
 * to see. It is a safer default than turning the book around.
 */
export default async function InspectJournalPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const query = (params.q ?? '').trim();

  const fieldRules = journalFieldRulesFor(user.commissionState);

  let entries: Array<{
    id: string;
    sequenceNumber: number;
    performedAt: Date;
    actType: string;
    documentType: string;
    signerName: string;
    identityMethod: string;
    feeChargedCents: number;
    locationCity: string | null;
    locationState: string | null;
  }> = [];

  if (query) {
    const where: Prisma.JournalEntryWhereInput = {
      userId: user.id,
      OR: [{ signerName: { contains: query } }, { documentType: { contains: query } }],
    };
    const asNumber = Number(query);
    if (Number.isInteger(asNumber) && asNumber > 0) {
      (where.OR as Prisma.JournalEntryWhereInput[]).push({ sequenceNumber: asNumber });
    }

    entries = await prisma.journalEntry.findMany({
      where,
      orderBy: { sequenceNumber: 'asc' },
      take: 100,
      select: {
        id: true,
        sequenceNumber: true,
        performedAt: true,
        actType: true,
        documentType: true,
        signerName: true,
        identityMethod: true,
        feeChargedCents: true,
        locationCity: true,
        locationState: true,
      },
    });
  }

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="Journal inspection"
          description="A redacted view to show someone who has asked to inspect your journal."
          actions={<LinkButton href="/journal">Back to journal</LinkButton>}
        />

        {fieldRules.publicInspectionRight ? (
          <Alert tone="info" title="Inspection is a right in your state" className="mb-5">
            A notary in {user.commissionState} must permit any person who asks — orally or in
            writing — to inspect the journal, and the inspection must take place in your presence.
            Ask the requester which record they want and search for it here. Showing the whole book
            would expose unrelated signers’ personal information.
          </Alert>
        ) : (
          <Alert tone="neutral" className="mb-5">
            Your state does not appear to grant a general inspection right, but this view is a safe
            way to show a specific record to a signer, a title company or an investigator without
            revealing anyone else’s details.
          </Alert>
        )}

        <Card className="mb-5">
          <CardBody>
            <form method="get" className="flex flex-wrap items-end gap-3">
              <Field
                label="Which record are you looking for?"
                htmlFor="q"
                className="min-w-64 flex-1"
                hint="Signer name, document type, or entry number."
              >
                <Input id="q" name="q" defaultValue={query} autoFocus />
              </Field>
              <Button type="submit" variant="secondary">
                Search
              </Button>
              {query ? <LinkButton href="/journal/inspect">Clear</LinkButton> : null}
            </form>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Inspection record"
          description={
            query
              ? `${entries.length} matching ${entries.length === 1 ? 'entry' : 'entries'} for “${query}”`
              : 'Search above to display a record.'
          }
          actions={
            entries.length > 0 ? (
              <span className="no-print text-xs text-[var(--text-subtle)]">
                Use your browser’s print command for a paper copy.
              </span>
            ) : null
          }
        />

        {!query ? (
          <EmptyState
            title="Nothing displayed"
            description="This view intentionally shows nothing until you search, so the journal is never left open on screen."
          />
        ) : entries.length === 0 ? (
          <EmptyState
            title="No matching entries"
            description="No record in this journal matches that search."
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>No.</Th>
                  <Th>Date and time</Th>
                  <Th>Act</Th>
                  <Th>Document</Th>
                  <Th>Signer</Th>
                  <Th>Identified by</Th>
                  <Th>Where</Th>
                  <Th align="right">Fee</Th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <Td className="tabular">#{entry.sequenceNumber}</Td>
                    <Td className="whitespace-nowrap">
                      {formatDateTime(entry.performedAt, user.timezone)}
                    </Td>
                    <Td>{labelFor(ACT_TYPE_LABELS, entry.actType)}</Td>
                    <Td>{entry.documentType}</Td>
                    <Td>{entry.signerName}</Td>
                    <Td className="text-[var(--text-muted)]">
                      {labelFor(IDENTITY_METHOD_LABELS, entry.identityMethod)}
                    </Td>
                    <Td className="text-[var(--text-muted)]">
                      {[entry.locationCity, entry.locationState].filter(Boolean).join(', ') || '—'}
                    </Td>
                    <Td align="right" className="tabular">
                      {formatCents(entry.feeChargedCents)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <CardBody className="border-t border-[var(--border)]">
              <p className="text-xs leading-relaxed text-[var(--text-subtle)]">
                Withheld from this view: signer addresses, telephone numbers, email addresses,
                identification details, and the notary’s private notes. Journal number, date, act
                type, document, signer name, identification method and fee are shown, which is the
                substance of the record.
              </p>
            </CardBody>
          </>
        )}
      </Card>
    </>
  );
}
