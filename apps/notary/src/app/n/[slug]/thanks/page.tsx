import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { displayNameFor, loadPublicNotary } from '@/lib/public-notary';
import { requestPath } from '@/lib/request-link';
import { telHref } from '@/lib/requests';
import { Card, CardBody } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { absolute: 'Request sent' },
  // A confirmation page has no business in a search index.
  robots: { index: false, follow: false },
};

export default async function ThanksPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = await params;

  const found = await loadPublicNotary(rawSlug);
  if (!found) notFound();

  const { slug, notary } = found;
  const name = displayNameFor(notary);
  const phone = notary.showPhonePublicly ? notary.phone : null;
  const tel = telHref(phone);

  return (
    <Card>
      <CardBody className="space-y-4 py-8">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">
            Request sent
          </h1>
          <p className="text-sm text-[var(--text-muted)]">
            Thank you. {name} has your request and will contact you using the details you gave.
          </p>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-[var(--text)]">What happens next</h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-[var(--text-muted)]">
            <li>The notary reads your request and checks the date and place you suggested.</li>
            <li>They get in touch to confirm the time and the price.</li>
            <li>Nothing is booked, and nothing is owed, until you both agree.</li>
          </ol>
        </div>

        {phone ? (
          <p className="text-sm text-[var(--text-muted)]">
            Is it urgent?{' '}
            {tel ? (
              <a href={tel} className="font-medium text-seal-600 hover:underline">
                Call {phone}
              </a>
            ) : (
              phone
            )}
            .
          </p>
        ) : null}

        <Link
          href={requestPath(slug)}
          className="inline-block text-sm font-medium text-seal-600 hover:underline"
        >
          Back to {name}
        </Link>
      </CardBody>
    </Card>
  );
}
