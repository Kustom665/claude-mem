'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Card, CardHeader, FormError, Table, Td, Th } from '@/components/ui';
import { formatCents } from '@/lib/money';
import { createInvoiceFromSigningsAction, type BillingFormState } from '../../actions';

export type BillableRow = {
  id: string;
  title: string;
  type: string;
  date: string;
  notarialCents: number;
  serviceCents: number;
};

function SubmitButton({ count, total }: { count: number; total: number }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || count === 0}>
      {pending
        ? 'Creating…'
        : count === 0
          ? 'Select signings to invoice'
          : `Create invoice for ${formatCents(total)}`}
    </Button>
  );
}

export function InvoiceBuilder({
  clientId,
  clientName,
  termsDays,
  signings,
}: {
  clientId: string;
  clientName: string;
  termsDays: number;
  signings: BillableRow[];
}) {
  const [state, formAction] = useActionState<BillingFormState, FormData>(
    createInvoiceFromSigningsAction,
    null,
  );
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(signings.map((signing) => signing.id)),
  );

  const toggle = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const total = signings
    .filter((signing) => selected.has(signing.id))
    .reduce((sum, signing) => sum + signing.notarialCents + signing.serviceCents, 0);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="clientId" value={clientId} />
      <FormError message={state?.errors._form} />

      <Card>
        <CardHeader
          title={`Unbilled signings for ${clientName}`}
          description={`Payment terms: net ${termsDays}`}
          actions={
            <button
              type="button"
              onClick={() =>
                setSelected((previous) =>
                  previous.size === signings.length
                    ? new Set()
                    : new Set(signings.map((signing) => signing.id)),
                )
              }
              className="focus-ring rounded-lg px-2 py-1 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]"
            >
              {selected.size === signings.length ? 'Clear all' : 'Select all'}
            </button>
          }
        />
        <Table>
          <thead>
            <tr>
              <Th />
              <Th>Signing</Th>
              <Th align="right">Notarial</Th>
              <Th align="right">Service</Th>
              <Th align="right">Total</Th>
            </tr>
          </thead>
          <tbody>
            {signings.map((signing) => (
              <tr key={signing.id}>
                <Td>
                  <input
                    type="checkbox"
                    name="signingIds"
                    value={signing.id}
                    checked={selected.has(signing.id)}
                    onChange={() => toggle(signing.id)}
                    aria-label={`Include ${signing.title}`}
                    className="focus-ring h-4 w-4 rounded border-[var(--border-strong)] accent-seal-600"
                  />
                </Td>
                <Td>
                  <span className="font-medium text-[var(--text)]">{signing.title}</span>
                  <span className="block text-xs text-[var(--text-subtle)]">
                    {signing.type} · {signing.date}
                  </span>
                </Td>
                <Td align="right" className="tabular text-emerald-700">
                  {signing.notarialCents > 0 ? formatCents(signing.notarialCents) : '—'}
                </Td>
                <Td align="right" className="tabular">
                  {signing.serviceCents > 0 ? formatCents(signing.serviceCents) : '—'}
                </Td>
                <Td align="right" className="tabular font-medium">
                  {formatCents(signing.notarialCents + signing.serviceCents)}
                </Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <Td colSpan={4} align="right" className="font-semibold">
                Invoice total
              </Td>
              <Td align="right" className="tabular text-base font-semibold">
                {formatCents(total)}
              </Td>
            </tr>
          </tfoot>
        </Table>
      </Card>

      <SubmitButton count={selected.size} total={total} />
    </form>
  );
}
