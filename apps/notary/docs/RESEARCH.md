# Domain research

Every rule this app enforces traces back to something in here. The point of the
file is that you can sell and defend the product without being a notary — and
that when a rule changes, you know exactly which line of code to change.

**Captured 10 August 2026.** Notary law moves every legislative session. Treat
this as a snapshot with sources, not as settled fact, and re-check anything you
are about to put in marketing copy.

---

## 1. The journal is the product

A notarial journal is the notary's only evidence of what happened if a
notarisation is later challenged — in a fraud claim, a deposition, or a
commissioning-authority audit. Roughly 42 states either require one or strongly
recommend it.

**Pennsylvania (the default jurisdiction in this build)**

Under RULONA, a journal is **mandatory** for every PA notary. It may be
tangible (bound, consecutively numbered pages) or **electronic, provided the
electronic journal is tamper-evident**. Each entry records:

- date and time of the act
- type of act and a description of the document
- signer's name and address
- method of identification
- fee charged

→ Implemented in `prisma/schema.prisma` (`JournalEntry`) and
`src/lib/journal-chain.ts`. "Tamper-evident" is the requirement the SHA-256 hash
chain exists to satisfy — it is not decoration, it is the statutory hook that
lets this app be the journal of record in PA rather than merely a business copy.

Source: <https://www.pa.gov/agencies/dos/programs/notaries/notary-regulations-changes>

**California, for contrast**

Gov. Code §8206 requires a *sequential, bound* journal with numbered pages, only
one active at a time, kept in a locked area under the notary's direct and
exclusive control. An electronic journal is not clearly permitted as the record.

→ `journalRuleFor('CA').electronicJournalPermitted === false`, and the app warns
a Californian user to keep their paper book as the official record.

Source: <https://notary.cdn.sos.ca.gov/forms/notary-handbook-current.pdf>

---

## 2. The rule most notary software gets wrong

State rules on **what may be recorded** run in opposite directions.

| | California | Pennsylvania |
|---|---|---|
| Thumbprint for deeds / DOT / POA | **Required** (§8206) | **Prohibited** |
| Full ID number | Not required | **Prohibited** |
| Date of birth | Not required | **Prohibited** |
| Public inspection right | No general right | **Yes — any person, on request** |

Pennsylvania's implementing regulations, **effective 28 March 2026**, bar
personal identifiers from the journal entirely: no Social Security number, no
full driver's licence or ID number, no date or place of birth, no mother's
maiden name, and **no biometrics**. Only the **last four digits** of an ID may
be recorded.

California §8206(a) does the reverse: it *requires* the signer's right
thumbprint for a power of attorney, deed, quitclaim deed, deed of trust, or any
other document affecting real property. Deeds of reconveyance and trustees'
deeds arising from foreclosure are exempt.

→ `assessThumbprint()` in `src/lib/compliance.ts` returns `required`,
`prohibited`, `exempt` or `recommended`, and the journal form renders a
thumbprint field **only** where it is lawful. A PA notary is never shown one, so
a non-compliant entry cannot be made by accident. Covered by
`tests/compliance.test.ts`.

**Why this matters commercially:** a generic "notary app" built without this
research either omits thumbprints (breaking California) or offers them
everywhere (breaking Pennsylvania). Getting it right in both directions is a
defensible feature, and it is the thing to demo first.

PA also grants **any person** the right to inspect the journal, orally or in
writing, in the notary's presence. Handing over the whole book would expose
every other signer's details — hence the redacted, search-first inspection view
at `/journal/inspect`.

---

## 3. Fees are capped, and the cap is low

**Pennsylvania**, since 28 March 2026, under 4 Pa. Code §167.3: a table of
maximums from **$2 to $5 per act**, with **$5** the ceiling for acknowledgments,
oaths, verifications, witnessing signatures and certifying copies. Protests are
$3.00/page. Electronic and remote notaries may add **up to $20 per act**
performed with communication technology.

Anything beyond that table — travel, copies, postage, RON platform fees — must
be **itemised, disclosed before the appointment, and labelled non-notarial**.

Pennsylvania is one of only three states (**PA, MI, NC**) that require a notary
to disclose fees to the client in advance.

| State | Acknowledgment max | Basis | Remote |
|---|---|---|---|
| PA | $5.00 | per act | +$20 surcharge |
| CA | $15.00 | per signature | — |
| TX | $6.00 | per signature | $25 cap |
| FL | $10.00 | per act | $25 cap |

→ `STATE_FEE_REFERENCE` in `src/lib/compliance.ts`. Note `ronIsSurcharge`, which
distinguishes PA's additive $20 from Florida's absolute $25 — getting that wrong
would under- or over-warn by a factor of five.

The table is **deliberately partial**. States without an entry return `null`, and
the UI says "verify with your commissioning authority" rather than guessing. A
wrong cap is worse than no cap, because a notary who overcharges commits a
violation.

Sources:
<https://www.pa.gov/agencies/dos/programs/notaries/notary-public-fees> ·
<https://legalcostcalculator.org/notary-fees-by-state/>

---

## 4. The money feature: self-employment tax

This is the single most valuable number the software produces.

**Fees earned for performing notarial acts are reported as income on Schedule C
but are not subject to self-employment tax.** The notary enters an adjustment on
Schedule SE. At the 2026 combined SE rate of **15.3%** (applied to 92.35% of net
earnings), that is real money.

Critically, the exemption is narrow. It covers **only** the fee for the notarial
act itself. It does **not** cover:

- travel fees
- printing and document handling
- loan-signing service fees
- administrative work

Most notaries bill one lump "signing fee" and lose the distinction entirely,
because the split has to be recorded **per act, as the work happens** — which is
to say, in the journal. That is the structural reason this app captures a fee on
every journal entry rather than only on the invoice.

→ `src/lib/tax.ts`. `splitIncome()` draws notarial fees from `JournalEntry` and
everything else from `Signing`. `/reports` renders a Schedule C and Schedule SE
view and shows the estimated saving versus not separating fees.

Source: IRS Taxpayer Advocate, "Notarial Fees and Self-Employment Tax: Know What
Is Exempt" —
<https://www.taxpayeradvocate.irs.gov/news/tax-tips/notarial-fees-and-self-employment-tax-know-what-is-exempt/2026/07/>

**Mileage.** 2026 has *two* IRS business standard rates: **72.5¢/mi** from
1 January and **76¢/mi** from 1 July, raised in response to fuel costs. A trip
must be valued at the rate in force on the day it was driven. Getting this wrong
is a common way to have a deduction disallowed.

→ `irsMileageRateCents(date)` and `summarizeMileage()`, which buckets by rate so
a two-rate year stays auditable. Source:
<https://www.irs.gov/newsroom/irs-sets-2026-business-standard-mileage-rate-at-725-cents-per-mile-up-25-cents>

---

## 5. Certificate wording

A notarial certificate must say specific things to be valid, and the wording is
statutory. Pennsylvania's RULONA provides short forms at **57 Pa.C.S. §316**
covering acknowledgment (individual and representative capacity), verification
on oath or affirmation, signature witnessing, and copy certification.

→ `src/lib/certificates.ts` seeds the PA short forms first for a PA notary, with
generic RULONA forms as a fallback for out-of-state work. The UI carries a
standing disclaimer to verify against the forms the commissioning authority
publishes, and warns against attaching a loose certificate to a document the
notary did not personally notarise.

---

## 6. Competitive landscape

| Product | Price | Position |
|---|---|---|
| NotaryAssist | ~$8.99/mo | Bookkeeping, receipt scanning, auto-import of confirmation emails |
| NotaryGadget | low $/mo | Income/expense and mileage tracking for signing agents; tax reports |
| CloseWise | mid-market | Broader business management, scheduling |
| Loan Signing System | **~$1,000/yr** | Training + community + software bundled |

The spread is the whole story. The pure-software tools cluster around
**$9–20/month** because software alone is a commodity in this niche. Loan
Signing System charges roughly **fifty times more** for a bundle whose software
component is thinner — because it sells training, a community, and a credible
instructor, with software as the retention mechanism.

**Implication for positioning:** competing on features against a $9/month tool
is a race to the bottom. The two things in this build that those tools do *not*
have are (a) a tamper-evident journal that satisfies PA's electronic-journal
standard, and (b) state-aware compliance rules that actively prevent violations.
Those justify a premium; a nicer mileage log does not.

Sources:
<https://www.closewise.com/notarygadget-vs-notaryassist-vs-closewise-a-fair-notary-software-comparison/> ·
<https://www.notarycentral.org/notary-app-comparison>

---

## 7. What is deliberately not built

Honest gaps, so nothing here oversells:

- **RON (remote online notarization).** The journal records that an act was
  performed remotely and on which platform, but this app does not perform RON.
  Doing so needs identity-proofing/KBA, an AV platform, a PKI signing authority
  and encrypted recording retention — all paid third-party vendors.
- **Payments.** `User.plan`, `subscriptionStatus` and `trialEndsOn` exist as a
  seam; nothing is wired to Stripe and nothing is gated.
- **E-signature / document storage.** No documents are stored. That is a
  deliberate risk decision: storing signer documents raises the breach blast
  radius sharply, and the journal is the legally required artefact, not the
  documents.
- **CRM, SMS, email nurture.** Pushed to GoHighLevel over webhooks. See the
  README.
- **Fee data for 46 states.** Four states carry verified maximums. The rest
  degrade honestly to "verify with your commissioning authority".

---

## Maintaining this

When a rule changes, the edit is almost always in `src/lib/compliance.ts`, and
`REFERENCE_CAPTURED_ON` at the top of that file should be bumped — the date is
displayed in the UI beside every reference figure, so users can see how fresh
the data is. `tests/compliance.test.ts` pins the current behaviour; a rule change
should change a test.
