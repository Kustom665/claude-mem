# Where notarization work comes from

The *Find work* directory in the app (`/find-work`) is built from
[`src/lib/work-sources.ts`](../src/lib/work-sources.ts). That file is the single
source of truth: the app, the readiness scoring and this document all read from
it, and `tests/work-sources.vitest.ts` fails if an entry is missing a source, a
caveat where its evidence is only anecdotal, or if this document stops
mentioning an entry.

**Captured 13 October 2026. Pennsylvania first.**

## Read this first: how it was compiled, and what that means

- Two research passes ran on 13 October 2026, and the tools they had could not
  open a web page: the fetch tool failed on every host and the sandbox's egress
  policy refused the rest. **Every fact here comes from search-result summaries
  that named the URLs listed, not from the pages themselves.** Where a summary quoted a string, it is
  quoted as the summary reproduced it.
- Because of that, nothing is rated above "company or agency page". The in-app
  evidence labels are:
  - **Company or agency page** — the source's own page, seen through a summary;
  - **Third-party report** — law-firm, county or industry-body pages describing
    the practice;
  - **Community reports** — forum threads and blog comments. Anecdotes, often
    years old, useful as colour and never as a basis for a decision.
- Several pages were 700+ days old when seen. Requirements, fees and pay change.
  Each card in the app says "confirm on the source's own site before you apply or
  pay for anything", and each entry carries its capture date.
- Nothing here promises income. No source publishes pay rates for signing work,
  and the National Notary Association will not recommend fee amounts, citing
  antitrust risk. Pay figures appear only where a source states them, labelled by
  who said it. A test fails if an entry's text promises or guarantees earnings.

## The channels

| Channel | How work arrives | Barrier to entry | Pay evidence | Pennsylvania |
|---|---|---|---|---|
| Signing platforms and services | Offers by text, email or portal from title firms, lenders, signing services | Commission, E&O, background check; some panels want experience | No platform publishes rates; anecdotes $40–$200 | High |
| Title, escrow, closing attorneys | Direct vendor lists, or through the platforms | The same; sponsor-style approval for some underwriters (anecdotal) | None official | High |
| Lenders, banks, credit unions | Indirectly, through the two rows above | n/a | None found | Medium |
| Law firms | Referral. A Pennsylvania general power of attorney needs a notary *and* two witnesses | Commission | None found | High |
| Healthcare and senior living | Families and facilities | Commission; judgement about capacity and access | A non-PA blog says $100–$250 | Medium |
| Auto and PennDOT | Consumers, dealers; PennDOT Agent Services | Notary only; Agent Services needs a $30,000 bond, State Police checks and a contract | Agents may add a "market" fee, no cap seen | High |
| Apostille, international | Consumers, schools, translators, attorneys | Commission | Notarial fee capped at $5 per act; the $15 apostille is the Department of State's own fee | High |
| Agents, property managers | Referral | Commission | None found | Medium, unverified |
| Directories and lead sites | Inbound calls and leads | Free to about $99 a year; Thumbtack charges per lead | See the entries | High |
| Remote online platforms | On-demand queue, or your own clients | PA e-notary notice, approved vendor, E&O, NNA certification (Proof) | Proof: $5 for the first stamp, $25 per closing | High |

## What is in the directory

20 entries. The how-to-join steps, requirements, pay notes, caveats and source
URLs for each are in the data file and on each card in the app.

| Entry | Channel | Pennsylvania | Evidence |
|---|---|---|---|
| Snapdocs Notary Connect | Signing services & dispatch platforms | Works in Pennsylvania | Company or agency page |
| SigningOrder / NotaryResume | Signing services & dispatch platforms | Works in Pennsylvania | Company or agency page |
| Rocket Close (formerly Amrock) | Signing services & dispatch platforms | Works in Pennsylvania | Company or agency page |
| ServiceLink (Fidelity National Financial) | Signing services & dispatch platforms | Works in Pennsylvania | Company or agency page |
| Title-underwriter “approved notary” status | Title, escrow & closing attorneys | Some Pennsylvania demand | Community reports |
| Pennsylvania title and settlement companies | Title, escrow & closing attorneys | Works in Pennsylvania | Third-party report |
| Estate-planning and elder-law practices | Law firms | Works in Pennsylvania | Third-party report |
| Hospitals, hospice, nursing homes and assisted living | Healthcare & senior living | Some Pennsylvania demand | Community reports |
| Apostille and documents for international use | Apostille & international documents | Works in Pennsylvania | Company or agency page |
| Vehicle title transfers (PennDOT) | Other | Works in Pennsylvania | Company or agency page |
| NNA Notary Signing Agent certification and SigningAgent.com | Directories & lead marketplaces | Works in Pennsylvania | Company or agency page |
| Google Business Profile | Directories & lead marketplaces | Works in Pennsylvania | Company or agency page |
| Notary Rotary | Directories & lead marketplaces | Works in Pennsylvania | Company or agency page |
| 123notary | Directories & lead marketplaces | Works in Pennsylvania | Company or agency page |
| Thumbtack | Directories & lead marketplaces | Some Pennsylvania demand | Community reports |
| Yelp and Nextdoor business pages | Directories & lead marketplaces | Some Pennsylvania demand | Company or agency page |
| Pennsylvania Association of Notaries — Find a Notary | Directories & lead marketplaces | Works in Pennsylvania | Company or agency page |
| Proof (formerly Notarize) — On-Demand Notary | Remote online notarization platforms | Works in Pennsylvania | Company or agency page |
| NotaryCam | Remote online notarization platforms | Works in Pennsylvania | Company or agency page |
| BlueNotary | Remote online notarization platforms | Works in Pennsylvania | Company or agency page |

Found nothing usable for: banks and credit unions, real-estate and
property-management firms, courts, jails, schools and franchise networks. Those
are deliberately absent rather than guessed at. The pipeline lets a notary add
their own prospects for anywhere the directory does not reach.

## How the app uses it

- **Readiness.** Each entry lists what it asks of a notary. Some requirements the
  app can read for itself — an active commission, E&O insurance (and whether it is
  at least $100,000), a current background check — and those cannot be ticked by
  hand. Others it cannot see (an NNA certification, a W-9 in a folder, a
  headshot), so the notary ticks them once and they count everywhere. The score
  says "1 of 2", never a bare percentage, and counts ticked items as "taken on
  trust".
- **Fastest next moves.** Counts, across every entry, which missing requirement
  would open the most sources and which is the *only* thing missing for some.
- **Pipeline.** Applying and hearing nothing back is normal, so the pipeline's
  whole job is to remember to ask again: a follow-up date is suggested when an
  entry moves to Applied (a week), Onboarding (five days) or Approved (two
  weeks), and a closed entry carries none. A source that starts sending work
  converts to a client in one click.
- **The request link** is the other half: people who find the notary, rather than
  sources the notary approaches. See the README and `docs/INSIGHTS.md`.

## Pennsylvania rules that shape sourcing and advertising

Seen through summaries, not opened. The statute is 57 Pa.C.S. Chapter 3 (RULONA);
the regulations are 4 Pa. Code Chapter 167, effective 28 March 2026.

- **Advertising.** An advertisement for notarial services — a Google Business
  Profile and this app's public page both count — must prominently state "I am
  not an attorney licensed to practice law in this Commonwealth". The Department
  of State's guidance adds that the notary is not allowed to draft legal records,
  give advice on legal matters (including immigration) or charge a fee for those.
  Misusing "notario" is a disciplinary ground, and the Department can fine up to
  $1,000 per violating act. The public page prints this wording automatically and
  never uses the word. **The exact required text must be confirmed with the
  Department of State.**
- **Unauthorized practice.** Do not choose the notarial act for a customer. The
  public form asks for a service and a description; it never asks "acknowledgment
  or jurat?".
- **Fees.** Maximums are set by 4 Pa. Code § 167.3: $5 for an acknowledgment
  (first name) and $2 for each further name, $5 for an oath, verification, copy
  certification, or each signature witnessed, and up to $20 more for an
  electronic or remote act. Travel, copies and similar charges are not set by the
  Department, must be reasonable, itemized, and — per the Department's guidance —
  disclosed before the notarization. An itemized receipt is required.
- **Remote and electronic.** Allowed since 2020 (Act 97). The notary must be
  physically in Pennsylvania, notify the Department before the first act,
  naming each technology, and use a vendor on the Department's list (updated 30
  April 2026, at least 32 vendors including Proof, NotaryCam, BlueNotary,
  Snapdocs, Pavaso and DocuSign).
- **After the appointment.** The bond, oath and commission must be recorded with
  the county Recorder of Deeds within 45 days or the commission is void.

## Conflicts between sources that are *not* resolved

The app shows these as a "Double-check this" note on the entry rather than
picking a side.

1. **Whether Pennsylvania loan signings need an attorney present.** NNA's
   Pennsylvania certification page says so, without citation. NNA's own
   state-restrictions page lists CT, DE, GA, MA, SC, VT and WV and omits
   Pennsylvania, and Pennsylvania law-firm pages say none is needed. Ask the
   title company.
2. **The Pennsylvania bond.** The statute says $10,000 or the amount set by
   regulation; 4 Pa. Code § 167.16 sets $25,000 for appointments and
   reappointments on or after 28 March 2026, and existing commissions may keep
   the old bond until they expire. Two research passes agree on $25,000; neither
   read the regulation.
3. **NNA prices.** The Standard signing-agent package is $199 on one page and
   $294 or $299 on older ones; the Complete package $394 or $294; standalone
   screening $89 or $199. Confirm at checkout.
4. **ServiceLink's panel entry bar.** Company blog posts say 200+ completed
   mortgage signings and two years as a notary; forum threads say six months and
   fifty closings.
5. **PennDOT's wording.** One page says a transfer is effective before a notary,
   another before an "authorized agent". PennDOT has also moved several forms to
   unsworn declarations, so demand is shrinking.
6. **The $20 electronic-notarization fee.** One guide called it unfinalized in
   early 2026; the final regulation took effect 28 March 2026.
7. **Advance disclosure of separate fees.** A 2016 draft required it; the
   final § 167.3 text seen has only the schedule and the receipt rule. Treated as
   guidance — and followed anyway, because it is what the Department tells
   notaries to do.
8. **Proof's Pennsylvania page.** One Proof compliance page carries Tennessee
   template text and a $75 fee; the Department says no added fee or training.
   Do not rely on that page for Pennsylvania.
9. **Notary Rotary Premier.** $99, then $89, then $79 a year on the membership
   page; "$79 to $139" on the homepage.

## What could not be verified, and decides product choices

1. The exact wording of 57 Pa.C.S. § 325(d), § 329.1 and 4 Pa. Code §§ 167.3 and
   167.16 as codified, and the type-size rule one summary cited with a garbled
   section number.
2. Whether advance disclosure of travel, clerical, "convenience" or
   signing-service fees is legally mandatory in Pennsylvania, and whether a
   bundled signing fee is allowed beyond the statutory caps.
3. Whether Pennsylvania loan signings require an attorney (above).
4. Current notary-side terms and pay for SigningOrder, Rocket Close, ServiceLink
   and title-underwriter approval, and any standard payment or cancellation terms.
   Only Snapdocs' VendorPay timing and forum anecdotes exist.
5. Any onboarding route or pay evidence for law firms, hospitals, hospice and
   nursing homes, banks, real-estate firms, courts and jails; and which of the
   Department's 32+ listed vendors are approved for remote notarization rather
   than electronic notarization only.

## Keeping it current

- Each entry has a `capturedOn` date and the app shows the newest one on the
  page. Re-check an entry before changing it, change `capturedOn`, and keep the
  caveat if sources still disagree.
- Prefer re-reading the source itself. If a page cannot be opened, say so in the
  entry's `caveat` rather than quoting a summary as fact.
- Quarterly is a sensible cadence for the platforms (pay terms and requirements
  move), annually for statute and regulation, and the Department of State's
  vendor list whenever it is re-issued.
