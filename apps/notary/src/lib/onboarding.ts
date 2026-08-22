import type { Prisma } from '@/generated/prisma';
import { feeReferenceFor, irsMileageRateCents } from './compliance';
import { certificateTemplatesFor } from './certificates';

/**
 * Defaults applied when a notary account is created.
 *
 * A new user should be able to record their first journal entry without
 * visiting settings, so the fee schedule is pre-loaded from their state's
 * statutory maximums and the certificate library from the wording their state
 * accepts.
 */

export function defaultFeeSchedule(state: string): Prisma.FeeScheduleItemCreateManyUserInput[] {
  const reference = feeReferenceFor(state);
  const notarialMax = reference?.acknowledgmentMaxCents ?? null;
  const basis = reference?.basis === 'PER_SIGNATURE' ? 'PER_SIGNATURE' : 'PER_ACT';

  const items: Prisma.FeeScheduleItemCreateManyUserInput[] = [
    {
      name: 'Acknowledgment',
      actType: 'ACKNOWLEDGMENT',
      amountCents: notarialMax ?? 500,
      unit: basis,
      stateMaxCents: notarialMax,
      notes: 'Statutory notarial fee — exempt from self-employment tax.',
      sortOrder: 10,
    },
    {
      name: 'Jurat',
      actType: 'JURAT',
      amountCents: reference?.juratMaxCents ?? notarialMax ?? 500,
      unit: basis,
      stateMaxCents: reference?.juratMaxCents ?? notarialMax,
      notes: 'Statutory notarial fee — exempt from self-employment tax.',
      sortOrder: 20,
    },
    {
      name: 'Oath or affirmation',
      actType: 'OATH_OR_AFFIRMATION',
      amountCents: notarialMax ?? 500,
      unit: basis,
      stateMaxCents: notarialMax,
      notes: 'Statutory notarial fee — exempt from self-employment tax.',
      sortOrder: 30,
    },
    {
      name: 'Copy certification',
      actType: 'COPY_CERTIFICATION',
      amountCents: notarialMax ?? 500,
      unit: 'PER_ACT',
      stateMaxCents: notarialMax,
      notes: 'Statutory notarial fee — exempt from self-employment tax.',
      sortOrder: 40,
    },
    {
      name: 'Signature witnessing',
      actType: 'SIGNATURE_WITNESSING',
      amountCents: notarialMax ?? 500,
      unit: basis,
      stateMaxCents: notarialMax,
      notes: 'Statutory notarial fee — exempt from self-employment tax.',
      sortOrder: 50,
    },
    // Non-notarial services. These are SE-taxable and, in Pennsylvania, must be
    // itemised and agreed before the appointment.
    {
      name: 'Loan signing (full package)',
      actType: null,
      amountCents: 15000,
      unit: 'FLAT',
      stateMaxCents: null,
      notes: 'Non-notarial service fee — subject to self-employment tax. Not capped by the state.',
      sortOrder: 60,
    },
    {
      name: 'Travel fee',
      actType: null,
      amountCents: 3500,
      unit: 'FLAT',
      stateMaxCents: null,
      notes: 'Non-notarial. Must be disclosed and agreed before the appointment.',
      sortOrder: 70,
    },
    {
      name: 'Document printing',
      actType: null,
      amountCents: 2500,
      unit: 'FLAT',
      stateMaxCents: null,
      notes: 'Non-notarial. Covers printing a dual-tray loan package.',
      sortOrder: 80,
    },
    {
      name: 'Scan-backs',
      actType: null,
      amountCents: 2500,
      unit: 'FLAT',
      stateMaxCents: null,
      notes: 'Non-notarial handling charge.',
      sortOrder: 90,
    },
  ];

  if (reference?.ronMaxCents) {
    items.push({
      name: reference.ronIsSurcharge
        ? 'Remote online notarization surcharge'
        : 'Remote online notarization',
      actType: null,
      amountCents: reference.ronMaxCents,
      unit: 'PER_ACT',
      stateMaxCents: reference.ronMaxCents,
      notes: reference.ronIsSurcharge
        ? 'Added on top of the base notarial fee for acts using communication technology.'
        : 'Maximum for a remote online notarization.',
      sortOrder: 55,
    });
  }

  return items;
}

export function defaultCertificateTemplates(
  state: string,
): Prisma.CertificateTemplateCreateManyUserInput[] {
  return certificateTemplatesFor(state).map((template, index) => ({
    name: template.name,
    actType: template.actType,
    state: template.state,
    body: template.body,
    isSystem: true,
    sortOrder: (index + 1) * 10,
  }));
}

/** Everything a fresh account needs, ready to hand to a nested create. */
export function onboardingDefaults(state: string) {
  return {
    mileageRateCents: Math.round(irsMileageRateCents()),
    feeScheduleItems: { createMany: { data: defaultFeeSchedule(state) } },
    certificateTemplates: { createMany: { data: defaultCertificateTemplates(state) } },
  };
}
