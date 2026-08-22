import type { ActType } from './domain';

/**
 * Certificate wording library.
 *
 * A notarial certificate has to say specific things to be valid, and the
 * wording is set by statute. Pennsylvania's RULONA provides short forms at
 * 57 Pa.C.S. §316 which are sufficient when completed properly; other states
 * publish their own. The templates below are starting points a notary edits
 * and saves, not a substitute for the wording their commissioning authority
 * publishes — the UI says so on the page.
 *
 * Placeholders use {{double_braces}} and are filled by fillTemplate().
 */

export type CertificateTemplateSeed = {
  name: string;
  actType: ActType;
  /** Two-letter state code, or null for a generally-accepted form. */
  state: string | null;
  body: string;
};

export const PLACEHOLDERS = [
  'state',
  'county',
  'date',
  'signer_name',
  'notary_name',
  'commission_number',
  'commission_expires',
  'document_type',
  'capacity',
  'principal_name',
] as const;

export type Placeholder = (typeof PLACEHOLDERS)[number];

export const PLACEHOLDER_LABELS: Record<Placeholder, string> = {
  state: 'State / Commonwealth',
  county: 'County',
  date: 'Date of the act',
  signer_name: 'Signer’s name',
  notary_name: 'Your name',
  commission_number: 'Your commission number',
  commission_expires: 'Commission expiry date',
  document_type: 'Document type',
  capacity: 'Representative capacity',
  principal_name: 'Entity or principal represented',
};

const PA_ACKNOWLEDGMENT_INDIVIDUAL = `Commonwealth of Pennsylvania
County of {{county}}

On this, the {{date}}, before me, the undersigned notary public, personally
appeared {{signer_name}}, known to me (or satisfactorily proven) to be the
person whose name is subscribed to the within instrument, and acknowledged
that he or she executed the same for the purposes therein contained.

In witness whereof, I hereunto set my hand and official seal.


_______________________________________
{{notary_name}}, Notary Public
Commission number: {{commission_number}}
My commission expires: {{commission_expires}}

                                            [ Notary seal ]`;

const PA_ACKNOWLEDGMENT_REPRESENTATIVE = `Commonwealth of Pennsylvania
County of {{county}}

On this, the {{date}}, before me, the undersigned notary public, personally
appeared {{signer_name}}, known to me (or satisfactorily proven) to be the
person whose name is subscribed to the within instrument, who acknowledged
himself or herself to be the {{capacity}} of {{principal_name}}, and that he or
she as such {{capacity}}, being authorised to do so, executed the foregoing
instrument for the purposes therein contained by signing the name of
{{principal_name}} by himself or herself as {{capacity}}.

In witness whereof, I hereunto set my hand and official seal.


_______________________________________
{{notary_name}}, Notary Public
Commission number: {{commission_number}}
My commission expires: {{commission_expires}}

                                            [ Notary seal ]`;

const PA_JURAT = `Commonwealth of Pennsylvania
County of {{county}}

Signed and sworn to (or affirmed) before me on {{date}} by {{signer_name}}.


_______________________________________
{{notary_name}}, Notary Public
Commission number: {{commission_number}}
My commission expires: {{commission_expires}}

                                            [ Notary seal ]`;

const PA_SIGNATURE_WITNESSING = `Commonwealth of Pennsylvania
County of {{county}}

Signed before me on {{date}} by {{signer_name}}.


_______________________________________
{{notary_name}}, Notary Public
Commission number: {{commission_number}}
My commission expires: {{commission_expires}}

                                            [ Notary seal ]`;

const PA_COPY_CERTIFICATION = `Commonwealth of Pennsylvania
County of {{county}}

I certify that this is a true and correct copy of a document in the possession
of {{signer_name}}.

Dated: {{date}}


_______________________________________
{{notary_name}}, Notary Public
Commission number: {{commission_number}}
My commission expires: {{commission_expires}}

                                            [ Notary seal ]`;

const PA_OATH = `Commonwealth of Pennsylvania
County of {{county}}

On {{date}}, {{signer_name}} personally appeared before me and took an oath
(or made an affirmation) as administered by me.


_______________________________________
{{notary_name}}, Notary Public
Commission number: {{commission_number}}
My commission expires: {{commission_expires}}

                                            [ Notary seal ]`;

const PENNSYLVANIA_TEMPLATES: readonly CertificateTemplateSeed[] = [
  {
    name: 'Acknowledgment — individual (PA short form)',
    actType: 'ACKNOWLEDGMENT',
    state: 'PA',
    body: PA_ACKNOWLEDGMENT_INDIVIDUAL,
  },
  {
    name: 'Acknowledgment — representative capacity (PA short form)',
    actType: 'ACKNOWLEDGMENT',
    state: 'PA',
    body: PA_ACKNOWLEDGMENT_REPRESENTATIVE,
  },
  {
    name: 'Verification on oath or affirmation / jurat (PA short form)',
    actType: 'JURAT',
    state: 'PA',
    body: PA_JURAT,
  },
  {
    name: 'Signature witnessing (PA short form)',
    actType: 'SIGNATURE_WITNESSING',
    state: 'PA',
    body: PA_SIGNATURE_WITNESSING,
  },
  {
    name: 'Copy certification (PA short form)',
    actType: 'COPY_CERTIFICATION',
    state: 'PA',
    body: PA_COPY_CERTIFICATION,
  },
  {
    name: 'Oath or affirmation (PA)',
    actType: 'OATH_OR_AFFIRMATION',
    state: 'PA',
    body: PA_OATH,
  },
];

/**
 * Generic RULONA-style forms for the ~35 states that have adopted the Revised
 * Uniform Law on Notarial Acts. Still requires the notary to confirm their own
 * jurisdiction's published wording.
 */
const GENERIC_TEMPLATES: readonly CertificateTemplateSeed[] = [
  {
    name: 'Acknowledgment — individual',
    actType: 'ACKNOWLEDGMENT',
    state: null,
    body: `State of {{state}}
County of {{county}}

This record was acknowledged before me on {{date}} by {{signer_name}}.


_______________________________________
{{notary_name}}, Notary Public
Commission number: {{commission_number}}
My commission expires: {{commission_expires}}

                                            [ Notary seal ]`,
  },
  {
    name: 'Acknowledgment — representative capacity',
    actType: 'ACKNOWLEDGMENT',
    state: null,
    body: `State of {{state}}
County of {{county}}

This record was acknowledged before me on {{date}} by {{signer_name}} as
{{capacity}} of {{principal_name}}.


_______________________________________
{{notary_name}}, Notary Public
Commission number: {{commission_number}}
My commission expires: {{commission_expires}}

                                            [ Notary seal ]`,
  },
  {
    name: 'Verification on oath or affirmation (jurat)',
    actType: 'JURAT',
    state: null,
    body: `State of {{state}}
County of {{county}}

Signed and sworn to (or affirmed) before me on {{date}} by {{signer_name}}.


_______________________________________
{{notary_name}}, Notary Public
Commission number: {{commission_number}}
My commission expires: {{commission_expires}}

                                            [ Notary seal ]`,
  },
  {
    name: 'Signature witnessing',
    actType: 'SIGNATURE_WITNESSING',
    state: null,
    body: `State of {{state}}
County of {{county}}

Signed before me on {{date}} by {{signer_name}}.


_______________________________________
{{notary_name}}, Notary Public
Commission number: {{commission_number}}
My commission expires: {{commission_expires}}

                                            [ Notary seal ]`,
  },
  {
    name: 'Copy certification',
    actType: 'COPY_CERTIFICATION',
    state: null,
    body: `State of {{state}}
County of {{county}}

I certify that this is a true and correct copy of a {{document_type}} in the
possession of {{signer_name}}.

Dated: {{date}}


_______________________________________
{{notary_name}}, Notary Public
Commission number: {{commission_number}}
My commission expires: {{commission_expires}}

                                            [ Notary seal ]`,
  },
];

/**
 * Templates to seed for a notary in `state`.
 *
 * State-specific forms come first so they are the default selection; the
 * generic RULONA forms follow as a fallback for out-of-state work.
 */
export function certificateTemplatesFor(state: string): CertificateTemplateSeed[] {
  const normalized = (state ?? '').toUpperCase();
  const stateSpecific = normalized === 'PA' ? PENNSYLVANIA_TEMPLATES : [];
  return [...stateSpecific, ...GENERIC_TEMPLATES];
}

export type CertificateValues = Partial<Record<Placeholder, string>>;

/**
 * Substitute placeholder values.
 *
 * Unfilled placeholders become a blank rule rather than disappearing, so a
 * printed certificate has a line to complete by hand instead of a silent gap
 * that reads as finished.
 */
export function fillTemplate(body: string, values: CertificateValues): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key as Placeholder];
    if (value && value.trim() !== '') return value;
    return '________________';
  });
}

/** Placeholders actually present in a template, in first-appearance order. */
export function placeholdersIn(body: string): Placeholder[] {
  const found: Placeholder[] = [];
  for (const match of body.matchAll(/\{\{(\w+)\}\}/g)) {
    const key = match[1] as Placeholder;
    if (PLACEHOLDERS.includes(key) && !found.includes(key)) found.push(key);
  }
  return found;
}

export const CERTIFICATE_DISCLAIMER =
  'These are starting points, not legal advice. Confirm the wording against the certificate forms ' +
  'your commissioning authority publishes, and never attach a certificate to a document you did ' +
  'not personally notarise.';
