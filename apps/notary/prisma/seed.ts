/**
 * Demo data.
 *
 * Creates one Pennsylvania notary with a month of realistic work so the app can
 * be evaluated without typing anything in. Journal entries go through the same
 * hash-chaining path the application uses, so the seeded journal verifies
 * exactly like a real one.
 *
 * Safe to re-run: it deletes and recreates the demo account only.
 */

import 'dotenv/config';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { computeEntryHash } from '../src/lib/journal-chain.js';
import { defaultCertificateTemplates, defaultFeeSchedule } from '../src/lib/onboarding.js';
import { irsMileageRateCents } from '../src/lib/compliance.js';

const DEMO_EMAIL = 'demo@notarydesk.test';
const DEMO_PASSWORD = 'notary-demo-2026';

/** Matches src/lib/db.ts — relative paths resolve against the project root. */
function resolveSqliteUrl(rawUrl: string): string {
  const withoutScheme = rawUrl.replace(/^file:/, '');
  if (withoutScheme === ':memory:') return ':memory:';
  if (path.isAbsolute(withoutScheme)) return withoutScheme;
  return path.resolve(process.cwd(), withoutScheme);
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: resolveSqliteUrl(url) }),
});

/** Days before now, at a given local hour. */
function daysAgo(days: number, hour = 10, minute = 0): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function daysAhead(days: number, hour = 10, minute = 0): Date {
  return daysAgo(-days, hour, minute);
}

async function main() {
  console.log('Seeding demo data…');

  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    await prisma.user.delete({ where: { id: existing.id } });
    console.log('  Removed previous demo account.');
  }

  const commissionExpires = new Date();
  commissionExpires.setDate(commissionExpires.getDate() + 61);

  const eoExpires = new Date();
  eoExpires.setDate(eoExpires.getDate() + 210);

  const backgroundCheckExpires = new Date();
  backgroundCheckExpires.setDate(backgroundCheckExpires.getDate() + 24);

  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
      name: 'Dana Whitfield',
      businessName: 'Keystone Mobile Notary',
      phone: '(412) 555-0148',
      addressLine1: '1420 Liberty Avenue',
      city: 'Pittsburgh',
      state: 'PA',
      postalCode: '15222',

      commissionNumber: 'PA-1194832',
      commissionState: 'PA',
      commissionCounty: 'Allegheny',
      commissionIssuedOn: new Date('2022-09-15'),
      // Inside the 90-day warning window, so the dashboard alert is visible.
      commissionExpiresOn: commissionExpires,
      sealDescription: 'Round seal — Dana Whitfield, Notary Public, Commonwealth of Pennsylvania',

      isSigningAgent: true,
      // Inside 30 days, so the critical-tier warning is visible too.
      backgroundCheckExpiresOn: backgroundCheckExpires,
      eoPolicyNumber: 'EO-88213-PA',
      eoCoverageCents: 10_000_000,
      eoExpiresOn: eoExpires,

      timezone: 'America/New_York',
      mileageRateCents: Math.round(irsMileageRateCents()),
      invoicePrefix: 'KMN',
      invoiceTermsDays: 30,
      plan: 'trial',
      trialEndsOn: daysAhead(9),

      feeScheduleItems: { createMany: { data: defaultFeeSchedule('PA') } },
      certificateTemplates: { createMany: { data: defaultCertificateTemplates('PA') } },
    },
  });

  console.log(`  Notary: ${user.name} (${user.email})`);

  const [titleCo, signingService, lawFirm, individual] = await Promise.all([
    prisma.client.create({
      data: {
        userId: user.id,
        name: 'Three Rivers Title Agency',
        type: 'TITLE_COMPANY',
        contactName: 'Marisol Vega',
        email: 'mvega@threeriverstitle.example',
        phone: '(412) 555-0110',
        addressLine1: '600 Grant Street, Suite 1200',
        city: 'Pittsburgh',
        state: 'PA',
        postalCode: '15219',
        defaultFeeCents: 17500,
        paymentTermsDays: 30,
        notes: 'Pays reliably around day 21. Always wants scan-backs within two hours.',
      },
    }),
    prisma.client.create({
      data: {
        userId: user.id,
        name: 'Meridian Signing Network',
        type: 'SIGNING_SERVICE',
        contactName: 'Scheduling desk',
        email: 'orders@meridiansignings.example',
        phone: '(800) 555-0179',
        defaultFeeCents: 12500,
        paymentTermsDays: 45,
        notes: 'Net 45 and they mean it. Chase at day 50.',
      },
    }),
    prisma.client.create({
      data: {
        userId: user.id,
        name: 'Hartley & Boone LLP',
        type: 'LAW_FIRM',
        contactName: 'Priya Raghavan',
        email: 'praghavan@hartleyboone.example',
        phone: '(412) 555-0163',
        city: 'Pittsburgh',
        state: 'PA',
        defaultFeeCents: 9000,
        paymentTermsDays: 15,
        notes: 'Estate planning packages. Usually two signers plus witnesses.',
      },
    }),
    prisma.client.create({
      data: {
        userId: user.id,
        name: 'Walk-in and direct clients',
        type: 'INDIVIDUAL',
        paymentTermsDays: 0,
        notes: 'Paid at the table.',
      },
    }),
  ]);

  console.log('  Clients: 4');

  const signings = await Promise.all([
    prisma.signing.create({
      data: {
        userId: user.id,
        clientId: titleCo.id,
        title: 'Refinance — Okonkwo',
        type: 'REFINANCE',
        status: 'COMPLETED',
        scheduledAt: daysAgo(21, 17, 30),
        completedAt: daysAgo(21, 18, 40),
        signerName: 'Adaeze Okonkwo',
        coSignerName: 'Emeka Okonkwo',
        signerPhone: '(412) 555-0192',
        locationName: 'Signer residence',
        addressLine1: '318 Bellefonte Street',
        city: 'Pittsburgh',
        state: 'PA',
        postalCode: '15232',
        loanNumber: '4482190',
        escrowNumber: 'TR-99120',
        propertyAddress: '318 Bellefonte Street, Pittsburgh, PA 15232',
        documentCount: 148,
        signingFeeCents: 17500,
        printFeeCents: 2500,
        mileageMiles: 18.4,
        scanBacksRequired: true,
        shippingCarrier: 'FedEx',
        trackingNumber: '7712 8841 9930',
        docsReturnedAt: daysAgo(20, 9),
      },
    }),
    prisma.signing.create({
      data: {
        userId: user.id,
        clientId: signingService.id,
        title: 'Purchase (buyer) — Lindqvist',
        type: 'PURCHASE_BUYER',
        status: 'COMPLETED',
        scheduledAt: daysAgo(14, 12),
        completedAt: daysAgo(14, 13, 10),
        signerName: 'Karin Lindqvist',
        signerPhone: '(724) 555-0137',
        locationName: 'Panera — Robinson',
        city: 'Coraopolis',
        state: 'PA',
        postalCode: '15108',
        loanNumber: '5590277',
        documentCount: 121,
        signingFeeCents: 12500,
        travelFeeCents: 2000,
        printFeeCents: 2500,
        mileageMiles: 31.2,
        scanBacksRequired: true,
      },
    }),
    prisma.signing.create({
      data: {
        userId: user.id,
        clientId: lawFirm.id,
        title: 'Estate planning — Brennan',
        type: 'ESTATE_PLANNING',
        status: 'COMPLETED',
        scheduledAt: daysAgo(6, 15),
        completedAt: daysAgo(6, 16, 5),
        signerName: 'Thomas Brennan',
        coSignerName: 'Eileen Brennan',
        locationName: 'Hartley & Boone offices',
        city: 'Pittsburgh',
        state: 'PA',
        signingFeeCents: 9000,
        mileageMiles: 9.6,
      },
    }),
    prisma.signing.create({
      data: {
        userId: user.id,
        clientId: titleCo.id,
        title: 'Seller package — Ruiz',
        type: 'PURCHASE_SELLER',
        status: 'CONFIRMED',
        scheduledAt: daysAhead(2, 18),
        signerName: 'Camila Ruiz',
        signerPhone: '(412) 555-0154',
        locationName: 'Signer residence',
        addressLine1: '77 Shady Avenue',
        city: 'Pittsburgh',
        state: 'PA',
        postalCode: '15206',
        escrowNumber: 'TR-99388',
        signingFeeCents: 15000,
        printFeeCents: 2000,
        mileageMiles: 14.2,
      },
    }),
    prisma.signing.create({
      data: {
        userId: user.id,
        clientId: signingService.id,
        title: 'HELOC — Fairbanks',
        type: 'HELOC',
        status: 'SCHEDULED',
        scheduledAt: daysAhead(6, 11),
        signerName: 'Grant Fairbanks',
        city: 'Wexford',
        state: 'PA',
        signingFeeCents: 12500,
        travelFeeCents: 3000,
        mileageMiles: 42.8,
      },
    }),
    prisma.signing.create({
      data: {
        userId: user.id,
        clientId: individual.id,
        title: 'POA — Alvarez',
        type: 'GENERAL_NOTARY_WORK',
        status: 'COMPLETED',
        scheduledAt: daysAgo(3, 14),
        completedAt: daysAgo(3, 14, 25),
        signerName: 'Rosa Alvarez',
        locationName: 'UPMC Shadyside, room 412',
        city: 'Pittsburgh',
        state: 'PA',
        travelFeeCents: 4500,
        mileageMiles: 11.3,
      },
    }),
  ]);

  console.log(`  Signings: ${signings.length}`);

  // --- Journal ------------------------------------------------------------
  // Written through the same chaining logic the app uses, so `verifyChain`
  // treats the seeded journal exactly like a real one.

  type EntrySeed = {
    performedAt: Date;
    actType: string;
    documentType: string;
    signerName: string;
    signerAddressLine1?: string;
    signerCity?: string;
    signerState?: string;
    signerPostalCode?: string;
    identityMethod: string;
    idType?: string;
    idIssuer?: string;
    idNumberLast4?: string;
    idExpiresOn?: Date;
    feeChargedCents: number;
    travelFeeCents?: number;
    numberOfSignatures?: number;
    locationCity?: string;
    notes?: string;
    signingId?: string;
    documentDescription?: string;
  };

  const seeds: EntrySeed[] = [
    // Refinance package — several acts at one appointment, which is exactly how
    // loan signing work produces multiple journal entries.
    {
      performedAt: daysAgo(21, 17, 45),
      actType: 'ACKNOWLEDGMENT',
      documentType: 'Mortgage',
      documentDescription: 'Loan 4482190, property 318 Bellefonte Street',
      signerName: 'Adaeze Okonkwo',
      signerAddressLine1: '318 Bellefonte Street',
      signerCity: 'Pittsburgh',
      signerState: 'PA',
      signerPostalCode: '15232',
      identityMethod: 'IDENTIFICATION_DOCUMENT',
      idType: "Driver's license",
      idIssuer: 'Pennsylvania',
      idNumberLast4: '4821',
      idExpiresOn: new Date('2029-04-11'),
      feeChargedCents: 500,
      numberOfSignatures: 1,
      locationCity: 'Pittsburgh',
      signingId: signings[0].id,
    },
    {
      performedAt: daysAgo(21, 17, 50),
      actType: 'ACKNOWLEDGMENT',
      documentType: 'Mortgage',
      documentDescription: 'Loan 4482190 — co-borrower signature',
      signerName: 'Emeka Okonkwo',
      signerAddressLine1: '318 Bellefonte Street',
      signerCity: 'Pittsburgh',
      signerState: 'PA',
      identityMethod: 'IDENTIFICATION_DOCUMENT',
      idType: "Driver's license",
      idIssuer: 'Pennsylvania',
      idNumberLast4: '9067',
      idExpiresOn: new Date('2028-11-02'),
      feeChargedCents: 500,
      locationCity: 'Pittsburgh',
      signingId: signings[0].id,
    },
    {
      performedAt: daysAgo(21, 18, 5),
      actType: 'JURAT',
      documentType: 'Signature and Name Affidavit',
      signerName: 'Adaeze Okonkwo',
      signerCity: 'Pittsburgh',
      signerState: 'PA',
      identityMethod: 'IDENTIFICATION_DOCUMENT',
      idType: "Driver's license",
      idIssuer: 'Pennsylvania',
      idNumberLast4: '4821',
      feeChargedCents: 500,
      locationCity: 'Pittsburgh',
      notes: 'Oath administered and affirmed aloud.',
      signingId: signings[0].id,
    },
    {
      performedAt: daysAgo(21, 18, 12),
      actType: 'JURAT',
      documentType: 'Occupancy Affidavit',
      signerName: 'Adaeze Okonkwo',
      signerCity: 'Pittsburgh',
      signerState: 'PA',
      identityMethod: 'IDENTIFICATION_DOCUMENT',
      idType: "Driver's license",
      idIssuer: 'Pennsylvania',
      idNumberLast4: '4821',
      feeChargedCents: 500,
      locationCity: 'Pittsburgh',
      signingId: signings[0].id,
    },
    // Purchase
    {
      performedAt: daysAgo(14, 12, 20),
      actType: 'ACKNOWLEDGMENT',
      documentType: 'Mortgage',
      documentDescription: 'Loan 5590277',
      signerName: 'Karin Lindqvist',
      signerCity: 'Coraopolis',
      signerState: 'PA',
      signerPostalCode: '15108',
      identityMethod: 'IDENTIFICATION_DOCUMENT',
      idType: 'US passport',
      idIssuer: 'United States',
      idNumberLast4: '3310',
      idExpiresOn: new Date('2031-06-30'),
      feeChargedCents: 500,
      locationCity: 'Coraopolis',
      signingId: signings[1].id,
    },
    {
      performedAt: daysAgo(14, 12, 35),
      actType: 'JURAT',
      documentType: 'Compliance Agreement',
      signerName: 'Karin Lindqvist',
      signerCity: 'Coraopolis',
      signerState: 'PA',
      identityMethod: 'IDENTIFICATION_DOCUMENT',
      idType: 'US passport',
      idIssuer: 'United States',
      idNumberLast4: '3310',
      feeChargedCents: 500,
      locationCity: 'Coraopolis',
      signingId: signings[1].id,
    },
    // Estate planning
    {
      performedAt: daysAgo(6, 15, 20),
      actType: 'ACKNOWLEDGMENT',
      documentType: 'Revocable Living Trust',
      signerName: 'Thomas Brennan',
      signerCity: 'Pittsburgh',
      signerState: 'PA',
      identityMethod: 'IDENTIFICATION_DOCUMENT',
      idType: "Driver's license",
      idIssuer: 'Pennsylvania',
      idNumberLast4: '7714',
      feeChargedCents: 500,
      locationCity: 'Pittsburgh',
      signingId: signings[2].id,
    },
    {
      performedAt: daysAgo(6, 15, 30),
      actType: 'ACKNOWLEDGMENT',
      documentType: 'Revocable Living Trust',
      signerName: 'Eileen Brennan',
      signerCity: 'Pittsburgh',
      signerState: 'PA',
      identityMethod: 'IDENTIFICATION_DOCUMENT',
      idType: "Driver's license",
      idIssuer: 'Pennsylvania',
      idNumberLast4: '7715',
      feeChargedCents: 500,
      locationCity: 'Pittsburgh',
      signingId: signings[2].id,
    },
    {
      performedAt: daysAgo(6, 15, 45),
      actType: 'SIGNATURE_WITNESSING',
      documentType: 'Advance Health Care Directive',
      signerName: 'Thomas Brennan',
      signerCity: 'Pittsburgh',
      signerState: 'PA',
      identityMethod: 'IDENTIFICATION_DOCUMENT',
      idType: "Driver's license",
      idIssuer: 'Pennsylvania',
      idNumberLast4: '7714',
      feeChargedCents: 500,
      locationCity: 'Pittsburgh',
      notes: 'Two disinterested witnesses present.',
      signingId: signings[2].id,
    },
    // Hospital POA — the classic mobile-notary call-out.
    {
      performedAt: daysAgo(3, 14, 15),
      actType: 'ACKNOWLEDGMENT',
      documentType: 'Durable Power of Attorney',
      documentDescription: 'Financial POA naming daughter as agent',
      signerName: 'Rosa Alvarez',
      signerCity: 'Pittsburgh',
      signerState: 'PA',
      identityMethod: 'IDENTIFICATION_DOCUMENT',
      idType: 'State ID card',
      idIssuer: 'Pennsylvania',
      idNumberLast4: '2298',
      feeChargedCents: 500,
      travelFeeCents: 4500,
      locationCity: 'Pittsburgh',
      notes:
        'Signed at bedside. Signer alert and oriented; confirmed she understood the document and ' +
        'was signing willingly. No family member in the room during questioning.',
      signingId: signings[5].id,
    },
    // Walk-in work
    {
      performedAt: daysAgo(9, 11),
      actType: 'COPY_CERTIFICATION',
      documentType: 'Diploma',
      signerName: 'Yusuf Demir',
      identityMethod: 'IDENTIFICATION_DOCUMENT',
      idType: 'Foreign passport',
      idIssuer: 'Türkiye',
      idNumberLast4: '5502',
      feeChargedCents: 500,
      locationCity: 'Pittsburgh',
    },
    {
      performedAt: daysAgo(2, 16, 30),
      actType: 'ACKNOWLEDGMENT',
      documentType: 'Parental Consent to Travel',
      signerName: 'Mei-Ling Chao',
      identityMethod: 'PERSONAL_KNOWLEDGE',
      feeChargedCents: 500,
      locationCity: 'Pittsburgh',
      notes: 'Known to me personally for six years through the Bloomfield business association.',
    },
  ];

  let previousHash: string | null = null;
  let sequenceNumber = user.journalStartNumber;

  for (const seed of seeds) {
    const sealedAt = new Date(seed.performedAt.getTime() + 60_000);
    const payload = {
      sequenceNumber,
      performedAt: seed.performedAt,
      actType: seed.actType,
      documentType: seed.documentType,
      documentDate: null,
      documentDescription: seed.documentDescription ?? null,
      numberOfSignatures: seed.numberOfSignatures ?? 1,
      signerName: seed.signerName,
      signerAddressLine1: seed.signerAddressLine1 ?? null,
      signerCity: seed.signerCity ?? null,
      signerState: seed.signerState ?? null,
      signerPostalCode: seed.signerPostalCode ?? null,
      signerPhone: null,
      signerEmail: null,
      identityMethod: seed.identityMethod,
      idType: seed.idType ?? null,
      idIssuer: seed.idIssuer ?? null,
      idNumberLast4: seed.idNumberLast4 ?? null,
      idIssuedOn: null,
      idExpiresOn: seed.idExpiresOn ?? null,
      credibleWitnessName: null,
      credibleWitnessAddress: null,
      secondCredibleWitnessName: null,
      feeChargedCents: seed.feeChargedCents,
      travelFeeCents: seed.travelFeeCents ?? 0,
      notarizedRemotely: false,
      ronPlatform: null,
      // Pennsylvania prohibits biometrics in the journal, so the demo journal
      // correctly contains none.
      thumbprintTaken: false,
      witnessNames: null,
      locationCity: seed.locationCity ?? null,
      locationState: 'PA',
      notes: seed.notes ?? null,
      signingId: seed.signingId ?? null,
      sealedAt,
      amendsEntryId: null,
      amendmentReason: null,
    };

    const entryHash = computeEntryHash(payload, previousHash);
    await prisma.journalEntry.create({
      data: { ...payload, userId: user.id, previousHash, entryHash },
    });

    previousHash = entryHash;
    sequenceNumber += 1;
  }

  console.log(`  Journal entries: ${seeds.length} (chained)`);

  // Mileage for the completed signings, valued at the rate in force that day.
  const mileageSeeds = [
    { signing: signings[0], miles: 18.4, days: 21 },
    { signing: signings[1], miles: 31.2, days: 14 },
    { signing: signings[2], miles: 9.6, days: 6 },
    { signing: signings[5], miles: 11.3, days: 3 },
  ];

  for (const seed of mileageSeeds) {
    const date = daysAgo(seed.days, 9);
    await prisma.mileageEntry.create({
      data: {
        userId: user.id,
        signingId: seed.signing.id,
        date,
        miles: seed.miles,
        ratePerMileCents: Math.round(irsMileageRateCents(date)),
        purpose: `Signing — ${seed.signing.title}`,
      },
    });
  }

  await prisma.mileageEntry.create({
    data: {
      userId: user.id,
      date: daysAgo(8, 16),
      miles: 6.2,
      ratePerMileCents: Math.round(irsMileageRateCents(daysAgo(8))),
      purpose: 'Drop docs at FedEx Office',
      fromAddress: '1420 Liberty Avenue, Pittsburgh',
      toAddress: 'FedEx Office, Penn Avenue',
    },
  });

  console.log(`  Mileage entries: ${mileageSeeds.length + 1}`);

  // One paid invoice, one outstanding, so billing has something to show.
  const paidInvoice = await prisma.invoice.create({
    data: {
      userId: user.id,
      clientId: titleCo.id,
      number: 'KMN-0001',
      status: 'PAID',
      issueDate: daysAgo(20),
      dueDate: daysAgo(-10),
      sentAt: daysAgo(20),
      paidAt: daysAgo(4),
      subtotalCents: 22000,
      totalCents: 22000,
      amountPaidCents: 22000,
      terms: 'Net 30',
      lineItems: {
        createMany: {
          data: [
            {
              description: 'Refinance — Okonkwo — notarial acts (4)',
              quantity: 1,
              unitAmountCents: 2000,
              amountCents: 2000,
              sortOrder: 10,
            },
            {
              description: 'Refinance — Okonkwo — signing service fee',
              quantity: 1,
              unitAmountCents: 17500,
              amountCents: 17500,
              sortOrder: 20,
            },
            {
              description: 'Refinance — Okonkwo — document printing',
              quantity: 1,
              unitAmountCents: 2500,
              amountCents: 2500,
              sortOrder: 30,
            },
          ],
        },
      },
    },
  });

  const openInvoice = await prisma.invoice.create({
    data: {
      userId: user.id,
      clientId: signingService.id,
      number: 'KMN-0002',
      status: 'SENT',
      issueDate: daysAgo(13),
      dueDate: daysAhead(32),
      sentAt: daysAgo(13),
      subtotalCents: 18000,
      totalCents: 18000,
      terms: 'Net 45',
      lineItems: {
        createMany: {
          data: [
            {
              description: 'Purchase (buyer) — Lindqvist — notarial acts (2)',
              quantity: 1,
              unitAmountCents: 1000,
              amountCents: 1000,
              sortOrder: 10,
            },
            {
              description: 'Purchase (buyer) — Lindqvist — signing service fee',
              quantity: 1,
              unitAmountCents: 12500,
              amountCents: 12500,
              sortOrder: 20,
            },
            {
              description: 'Purchase (buyer) — Lindqvist — travel',
              quantity: 1,
              unitAmountCents: 2000,
              amountCents: 2000,
              sortOrder: 30,
            },
            {
              description: 'Purchase (buyer) — Lindqvist — document printing',
              quantity: 1,
              unitAmountCents: 2500,
              amountCents: 2500,
              sortOrder: 40,
            },
          ],
        },
      },
    },
  });

  await prisma.signing.update({
    where: { id: signings[0].id },
    data: { invoiceId: paidInvoice.id },
  });
  await prisma.signing.update({
    where: { id: signings[1].id },
    data: { invoiceId: openInvoice.id },
  });

  console.log('  Invoices: 2 (1 paid, 1 outstanding)');
  console.log('');
  console.log('Done. Sign in with:');
  console.log(`  Email:    ${DEMO_EMAIL}`);
  console.log(`  Password: ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
