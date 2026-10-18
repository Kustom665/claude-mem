import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { PIPELINE_STATUS_LABELS, SOURCE_CATEGORY_LABELS, labelFor } from '@/lib/domain';
import { formatDate, toDateInputValue } from '@/lib/dates';
import { followUpState } from '@/lib/pipeline';
import { assessReadiness } from '@/lib/readiness';
import { parseRequirementList } from '@/lib/requirements';
import { EVIDENCE_LABELS, workSourceByKey } from '@/lib/work-sources';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  LinkButton,
  PageHeader,
} from '@/components/ui';
import { ConfirmSubmitButton } from '../../confirm-button';
import { ReadinessMeter, RequirementList } from '../../readiness-ui';
import { pipelineTone } from '../../status';
import { ApplicationForm } from '../application-form';
import {
  convertToClientAction,
  deleteApplicationAction,
  updateApplicationAction,
} from '../../actions';

export const metadata: Metadata = { title: 'Pipeline entry' };

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const application = await prisma.sourceApplication.findFirst({
    where: { id, userId: user.id },
  });
  if (!application) notFound();

  const now = new Date();
  const source = workSourceByKey(application.sourceKey);
  const readiness = source
    ? assessReadiness(source, user, parseRequirementList(user.readinessChecklist), now)
    : null;
  const followUp = followUpState(application.nextFollowUpOn, application.status, user.timezone, now);

  const toInput = (value: Date | null) => toDateInputValue(value, user.timezone);

  return (
    <>
      <PageHeader
        title={application.name}
        description={
          <>
            {labelFor(SOURCE_CATEGORY_LABELS, application.category)} ·{' '}
            <Badge tone={pipelineTone(application.status)}>
              {labelFor(PIPELINE_STATUS_LABELS, application.status)}
            </Badge>
          </>
        }
        actions={<LinkButton href="/find-work/pipeline">All pipeline entries</LinkButton>}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {followUp === 'OVERDUE' || followUp === 'DUE_SOON' ? (
            <Alert
              tone={followUp === 'OVERDUE' ? 'warning' : 'info'}
              title={
                followUp === 'OVERDUE'
                  ? 'Your follow-up is overdue'
                  : 'Your follow-up is coming up'
              }
            >
              {application.nextFollowUpOn
                ? `Planned for ${formatDate(application.nextFollowUpOn, user.timezone)}. `
                : ''}
              Send a short, specific message: who you are, that you applied, and one line on what
              you can offer in their area.
            </Alert>
          ) : null}

          <ApplicationForm
            action={updateApplicationAction.bind(null, application.id)}
            submitLabel="Save changes"
            values={{
              name: application.name,
              category: application.category,
              status: application.status,
              website: application.website,
              contactName: application.contactName,
              contactEmail: application.contactEmail,
              contactPhone: application.contactPhone,
              appliedOn: toInput(application.appliedOn),
              lastContactOn: toInput(application.lastContactOn),
              nextFollowUpOn: toInput(application.nextFollowUpOn),
              notes: application.notes,
            }}
          />
        </div>

        <div className="space-y-5">
          {source && readiness ? (
            <Card>
              <CardHeader
                title="Am I ready?"
                description="Checked against your own commission, insurance and checklist."
              />
              <CardBody className="space-y-4">
                <ReadinessMeter
                  percent={readiness.percent}
                  satisfied={readiness.satisfied}
                  total={readiness.total}
                />
                <RequirementList results={readiness.results} />
                <details className="rounded-lg border border-[var(--border)] px-3 py-2">
                  <summary className="cursor-pointer text-sm font-medium text-seal-700">
                    How to join ({source.howToJoin.length} steps)
                  </summary>
                  <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-[var(--text-muted)]">
                    {source.howToJoin.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </details>
                {source.caveat ? (
                  <Alert tone="warning" title="Double-check this">
                    {source.caveat}
                  </Alert>
                ) : null}
                <p className="text-xs text-[var(--text-subtle)]">
                  {EVIDENCE_LABELS[source.evidence]} · checked {formatDate(source.capturedOn, 'UTC')} ·{' '}
                  <Link href={`/find-work#${source.key}`} className="text-seal-600 hover:underline">
                    See it in the directory
                  </Link>
                </p>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="When it starts paying" />
            <CardBody className="space-y-3">
              {application.clientId ? (
                <>
                  <p className="text-sm text-[var(--text-muted)]">
                    This source is one of your clients, so signings and invoices can be linked to it.
                  </p>
                  <LinkButton href={`/clients/${application.clientId}`}>Open the client</LinkButton>
                </>
              ) : (
                <>
                  <p className="text-sm text-[var(--text-muted)]">
                    Once they start sending work, turn this into a client. Contact details carry
                    over and the entry moves to “Receiving work”.
                  </p>
                  <form action={convertToClientAction.bind(null, application.id)}>
                    <Button type="submit" variant="secondary">
                      Convert to a client
                    </Button>
                  </form>
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Remove" />
            <CardBody className="space-y-3">
              <p className="text-sm text-[var(--text-muted)]">
                Takes this entry out of your pipeline. A client created from it stays.
              </p>
              <form action={deleteApplicationAction.bind(null, application.id)}>
                <ConfirmSubmitButton
                  label="Remove from pipeline"
                  pendingLabel="Removing…"
                  confirmMessage="Remove this from your pipeline? This cannot be undone."
                />
              </form>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
