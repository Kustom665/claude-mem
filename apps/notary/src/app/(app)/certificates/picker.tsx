'use client';

import { useMemo, useState } from 'react';
import {
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
  cx,
} from '@/components/ui';
import {
  PLACEHOLDER_LABELS,
  fillTemplate,
  placeholdersIn,
  type CertificateValues,
  type Placeholder,
} from '@/lib/certificates';
import { ACT_TYPE_LABELS, labelFor } from '@/lib/domain';

export type TemplateOption = {
  id: string;
  name: string;
  actType: string;
  state: string | null;
  body: string;
};

export function CertificatePicker({
  templates,
  defaults,
}: {
  templates: TemplateOption[];
  defaults: CertificateValues;
}) {
  const [selectedId, setSelectedId] = useState(templates[0]?.id ?? '');
  const [values, setValues] = useState<CertificateValues>(defaults);

  const selected = templates.find((template) => template.id === selectedId) ?? templates[0];
  const fields = useMemo(() => (selected ? placeholdersIn(selected.body) : []), [selected]);
  const filled = useMemo(
    () => (selected ? fillTemplate(selected.body, values) : ''),
    [selected, values],
  );

  if (!selected) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-[var(--text-muted)]">No certificate templates available.</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <div className="no-print space-y-5 lg:col-span-2">
        <Card>
          <CardHeader title="Choose a certificate" />
          <CardBody className="space-y-4">
            <Field label="Template" htmlFor="template">
              <Select
                id="template"
                value={selectedId}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-xs text-[var(--text-subtle)]">
              {labelFor(ACT_TYPE_LABELS, selected.actType)}
              {selected.state ? ` · ${selected.state} form` : ' · general form'}
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Fill in" description="Blanks print as a rule to complete by hand." />
          <CardBody className="space-y-3">
            {fields.map((field) => (
              <Field key={field} label={PLACEHOLDER_LABELS[field]} htmlFor={`field-${field}`}>
                <Input
                  id={`field-${field}`}
                  value={values[field] ?? ''}
                  onChange={(event) =>
                    setValues((previous) => ({ ...previous, [field]: event.target.value }))
                  }
                />
              </Field>
            ))}
            {fields.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">
                This template has no placeholders.
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <div className="lg:col-span-3">
        <Card>
          <CardHeader
            title="Preview"
            description="Print this page to produce the loose certificate."
            actions={
              <button
                type="button"
                onClick={() => window.print()}
                className="focus-ring no-print rounded-lg bg-seal-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-seal-700"
              >
                Print
              </button>
            }
          />
          <CardBody>
            <pre
              className={cx(
                'font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-[var(--text)]',
              )}
            >
              {filled}
            </pre>
          </CardBody>
        </Card>

        <p className="no-print mt-3 text-xs leading-relaxed text-[var(--text-subtle)]">
          A loose certificate must be stapled to the document it belongs to, and you must never
          send one to be attached to a document you did not personally notarise — that is how a
          notary ends up attached to a fraud they never saw.
        </p>
      </div>
    </div>
  );
}
