import type { SourceCategory } from './domain';
import type { RequirementKey } from './requirements';

/**
 * Where notarization work comes from, and what it takes to get on the list.
 *
 * This is reference data with a capture date, in the same spirit as
 * compliance.ts: a wrong requirement or a dead application link costs a notary
 * a week, so every entry names where the claim came from, how strong that
 * evidence is, and when it was checked. Nothing here is an endorsement — it is
 * a map of channels, and the UI says so.
 *
 * HOW THIS WAS COMPILED. On 13 October 2026, from the public pages named in each
 * entry's `sources`, read through search-result summaries rather than by opening
 * every page (the environment it was compiled in could not fetch them). Some of
 * those pages are two to five years old. docs/WORK-SOURCES.md records the method,
 * every conflict between sources, and the facts that could not be confirmed.
 * Treat each entry as a lead to confirm on the source's own site, not as the
 * source's current terms.
 *
 * Pay figures are included only where a source states them, and are labeled by
 * who said it: a company describing its own program is not the same as an
 * industry body surveying its members, and neither is a forum anecdote.
 */

/** How much weight a claim can bear. */
export type Evidence =
  /** The company or agency's own page. */
  | 'OFFICIAL'
  /** A reputable third party reporting on it. */
  | 'SECONDARY'
  /** Community reports. Useful color, not a basis for a decision. */
  | 'ANECDOTAL';

export const EVIDENCE_LABELS: Record<Evidence, string> = {
  OFFICIAL: 'Company or agency page',
  SECONDARY: 'Third-party report',
  ANECDOTAL: 'Community reports',
};

export type PaRelevance = 'HIGH' | 'MEDIUM' | 'LOW';

export const PA_RELEVANCE_LABELS: Record<PaRelevance, string> = {
  HIGH: 'Works in Pennsylvania',
  MEDIUM: 'Some Pennsylvania demand',
  LOW: 'Limited in Pennsylvania',
};

export type WorkSource = {
  /** Stable identifier; stored on a pipeline entry, so never reuse or rename. */
  key: string;
  name: string;
  category: SourceCategory;
  /** One or two sentences: how work actually reaches a notary through this channel. */
  howWorkArrives: string;
  /** What joining involves, in order. */
  howToJoin: readonly string[];
  /** The official page to apply or learn more. */
  applyUrl: string | null;
  /**
   * What the source is documented to ask for, or what is near-universal. Advice
   * about what merely helps belongs in `howToJoin`, not here, so a requirement
   * is never something the notary could not have been told no for.
   */
  requirements: readonly RequirementKey[];
  /** Documented pay or fees, with who said so. Null where nothing reliable is published. */
  payNote: string | null;
  paRelevance: PaRelevance;
  paNote: string | null;
  /** Known disagreements, age of the pages, or other reasons to double-check. */
  caveat: string | null;
  evidence: Evidence;
  /** Every page the claims above were taken from. */
  sources: readonly string[];
  /** ISO date the entry was last checked against its sources. */
  capturedOn: string;
};

const CAPTURED = '2026-10-13';

/**
 * Pennsylvania's approved list of electronic and remote notarization vendors,
 * cited by every platform entry that relies on it.
 */
const PA_VENDOR_LIST =
  'https://www.pa.gov/content/dam/copapwp-pagov/en/dos/programs/notary/electronic-notarization/Approved-E-Notary-and-RON-Vendor-List.pdf';

export const WORK_SOURCES: readonly WorkSource[] = [
  // -------------------------------------------------------------------------
  // Signing services and dispatch platforms
  // -------------------------------------------------------------------------
  {
    key: 'snapdocs',
    name: 'Snapdocs Notary Connect',
    category: 'SIGNING_SERVICE',
    howWorkArrives:
      'Title, escrow, lender and signing-service companies post orders; Snapdocs offers them to ' +
      'notaries in ranked order by text or email. Snapdocs says the hiring company chooses who ' +
      'gets the job — it is not first-come-first-served — and the company, not Snapdocs, sets the fee.',
    howToJoin: [
      'Create a free account (name, email, mobile number for two-factor sign-in).',
      'Choose text or email offers and enter the address payments should go to.',
      'Complete your profile with a photo and bio. Snapdocs lists profile completeness, completed ' +
        'orders, Verified status and distance as ranking inputs.',
      'Optional but valuable: apply for “Snapdocs Verified” by uploading your commission, your ' +
        'bond where your state requires one, a background-check report, your E&O policy, and a ' +
        'driver’s license (front, back and a face photo). Review takes up to about three business days.',
      'Remote online notarization is a separate free add-on once your state authorizes you.',
    ],
    applyUrl: 'https://www.snapdocs.com/join-notary-network',
    requirements: ['COMMISSION_ACTIVE', 'BACKGROUND_CHECK', 'EO_ACTIVE', 'HEADSHOT_BIO'],
    payNote:
      'No platform rate: the fee on each offer is whatever the hiring company will pay (Snapdocs ' +
      'support pages). Companies enrolled in VendorPay are invoiced on the 3rd and 18th and ' +
      'Snapdocs puts total time to payment at roughly one to three weeks after the company closes ' +
      'the order; cancelled orders are not paid through VendorPay. Other companies pay under their own terms.',
    paRelevance: 'HIGH',
    paNote: 'Snapdocs is on Pennsylvania’s approved electronic and remote notarization vendor list.',
    caveat:
      'Several support pages are two to five years old. Forum users dispute that offers are not ' +
      'first-come-first-served, and report low opening fees that rarely move when countered.',
    evidence: 'OFFICIAL',
    sources: [
      'https://www.snapdocs.com/join-notary-network',
      'https://support.snapdocs.com/create-notary-account',
      'https://support.snapdocs.com/notary-credentials',
      'https://support.snapdocs.com/guide-snapdocs-vendorpay',
      'https://support.snapdocs.com/vendorpay-bill-cycles',
      'https://support.snapdocs.com/boost-my-notary-ranking',
      PA_VENDOR_LIST,
    ],
    capturedOn: CAPTURED,
  },
  {
    key: 'signingorder',
    name: 'SigningOrder / NotaryResume',
    category: 'SIGNING_SERVICE',
    howWorkArrives:
      'Signing companies and title agencies that run SigningOrder’s scheduling software search its ' +
      'notary database and send orders directly. Notaries sign up through its partner site, NotaryResume.',
    howToJoin: [
      'Create a profile at NotaryResume: credentials, bond, E&O, services offered, areas covered and fees.',
      'Keep it current — companies filter on credentials and coverage area.',
      'Ask the signing companies you work with whether they use SigningOrder, so you are in the database they search.',
    ],
    applyUrl: 'https://www.notaryresume.com/signup',
    requirements: ['COMMISSION_ACTIVE', 'EO_ACTIVE'],
    payNote:
      'Not stated for notaries. The “$3 per order” figure on SigningOrder’s site is what hiring ' +
      'companies pay. Its terms say it acts as a limited agent for notaries when a company pays through VendorPay.',
    paRelevance: 'HIGH',
    paNote: 'A national platform, so Pennsylvania offers depend on which companies you are listed with.',
    caveat: 'What it costs a notary and what it requires were not stated on the pages seen.',
    evidence: 'OFFICIAL',
    sources: [
      'https://www.signingorder.com/',
      'https://www.notaryresume.com/signup',
      'https://www.signingorder.com/tos',
    ],
    capturedOn: CAPTURED,
  },
  {
    key: 'rocket-close',
    name: 'Rocket Close (formerly Amrock)',
    category: 'SIGNING_SERVICE',
    howWorkArrives:
      'An in-house signing network run by Rocket Companies: mortgage signings assigned to ' +
      'approved signing agents, paid by bi-weekly direct deposit.',
    howToJoin: [
      'Use the partner page’s interest form. Rocket Close says onboarding opens in areas of need and may be limited by market conditions.',
      'Have your commission, E&O and background-check details ready.',
      'If your area is not open, ask to be kept on a waiting list.',
    ],
    applyUrl: 'https://www.rocketclose.com/partners',
    requirements: ['COMMISSION_ACTIVE', 'EO_ACTIVE', 'BACKGROUND_CHECK'],
    payNote: 'Rates are not published. Payment is by bi-weekly direct deposit (company page).',
    paRelevance: 'HIGH',
    paNote: 'Rocket Close / Clear Sign is on Pennsylvania’s approved electronic and remote notarization vendor list.',
    caveat:
      'No requirements were visible on the pages seen. A 2022 forum thread mentions a year of ' +
      'experience; treat that as unconfirmed.',
    evidence: 'OFFICIAL',
    sources: [
      'https://www.rocketclose.com/partners',
      'https://www.rocketclose.com/contact/team',
      PA_VENDOR_LIST,
    ],
    capturedOn: CAPTURED,
  },
  {
    key: 'servicelink',
    name: 'ServiceLink (Fidelity National Financial)',
    category: 'SIGNING_SERVICE',
    howWorkArrives:
      'A national title and settlement-services company with its own panel of signing agents, ' +
      'assigned by region.',
    howToJoin: [
      'Start at the vendor page and submit the signing-agent application.',
      'Expect to document your signing history: ServiceLink’s own blog posts describe a panel ' +
        'threshold of 200+ completed mortgage signings and two-plus years as a notary.',
      'If you are new, build volume through Snapdocs or SigningOrder first and apply once you are over the line.',
    ],
    applyUrl: 'https://www.servicelink.com/vendors',
    requirements: ['COMMISSION_ACTIVE', 'EO_ACTIVE', 'BACKGROUND_CHECK', 'EXPERIENCE_SUMMARY'],
    payNote: null,
    paRelevance: 'HIGH',
    paNote: null,
    caveat:
      'The experience threshold comes from company blog posts that are 1.5 to 4 years old; forum ' +
      'accounts range from six months and 50 closings to two years.',
    evidence: 'OFFICIAL',
    sources: [
      'https://www.servicelink.com/vendors',
      'https://www.servicelink.com/blog/esigning-and-mobile-notary-benefits-for-servicers',
    ],
    capturedOn: CAPTURED,
  },
  {
    key: 'underwriter-approved',
    name: 'Title-underwriter “approved notary” status',
    category: 'TITLE_ESCROW',
    howWorkArrives:
      'Some title underwriters keep their own approved-notary lists, and escrow officers and ' +
      'signing services prefer — or require — approved notaries on their files.',
    howToJoin: [
      'Ask a title company or signing service you already work with whether they will sponsor you; ' +
        'posters describe approval as sponsor-based.',
      'Expect a background check (NNA or a similar screening), E&O and a track record.',
      'Approved notaries are commonly told not to advertise the status, so do not put it in your marketing.',
    ],
    applyUrl: null,
    requirements: ['COMMISSION_ACTIVE', 'EO_ACTIVE', 'BACKGROUND_CHECK', 'EXPERIENCE_SUMMARY'],
    payNote: null,
    paRelevance: 'MEDIUM',
    paNote: null,
    caveat:
      'Anecdotal only. Posters quote E&O limits anywhere from $100,000 to $500,000 and about two ' +
      'years of experience, and no underwriter page describing the process was found.',
    evidence: 'ANECDOTAL',
    sources: [
      'https://forum.notarycafe.com/t/getting-fidelity-approved/7515',
      'https://www.loansigningsystem.com/fidelity-approved.html',
    ],
    capturedOn: CAPTURED,
  },

  // -------------------------------------------------------------------------
  // Title, escrow and closing attorneys
  // -------------------------------------------------------------------------
  {
    key: 'pa-title-escrow',
    name: 'Pennsylvania title and settlement companies',
    category: 'TITLE_ESCROW',
    howWorkArrives:
      'Residential closings are run by a title company, settlement agent or attorney. Local title ' +
      'offices keep their own vendor lists and also order through signing services and platforms.',
    howToJoin: [
      'Register on the platforms above first; many title offices reach notaries through them.',
      'Then call or visit local title and settlement offices directly and ask how they add vendors. ' +
        'No Pennsylvania vendor form turned up in the research.',
      'Expect to be asked for signing-agent training, E&O and a current background screening — the ' +
        'National Notary Association says companies typically want all three.',
      'Learn what makes a deed recordable: county recorder pages list a missing county, state, date, ' +
        'name, notary signature, seal or commission expiry as defects that get a document rejected.',
    ],
    applyUrl: null,
    requirements: ['COMMISSION_ACTIVE', 'EO_ACTIVE', 'BACKGROUND_CHECK', 'NNA_CERTIFIED'],
    payNote: 'Not published. NNA will not recommend fee amounts, and surveys report offers well below what borrowers are charged.',
    paRelevance: 'HIGH',
    paNote:
      'Law-firm pages say Pennsylvania does not require an attorney at a residential closing. The ' +
      'deed is acknowledged before a notary and recorded with the county Recorder of Deeds.',
    caveat:
      'Unresolved conflict: the National Notary Association’s Pennsylvania signing-agent page says ' +
      'an attorney must be present when notarizing loan documents, while its own state-restrictions ' +
      'list omits Pennsylvania and Pennsylvania law-firm pages say no attorney is needed. Ask the ' +
      'title company how they run closings before you assume either.',
    evidence: 'SECONDARY',
    sources: [
      'https://www.ament.law/blog/do-i-need-a-lawyer-for-real-estate-closing-pennsylvania/',
      'https://aging.waynecountypa.gov/490/Recording-Documents',
      'https://www.westmorelandcountypa.gov/1207/Recording-Requirements',
      'https://www.nationalnotary.org/pennsylvania/signing-agent',
      'https://www.nationalnotary.org/knowledge-center/signing-agent-resources/state-restrictions',
    ],
    capturedOn: CAPTURED,
  },

  // -------------------------------------------------------------------------
  // Law firms
  // -------------------------------------------------------------------------
  {
    key: 'pa-estate-law',
    name: 'Estate-planning and elder-law practices',
    category: 'LAW_FIRM',
    howWorkArrives:
      'By relationship. Firms that prepare powers of attorney, wills and health-care documents ' +
      'need a notary at the signing, often at the client’s home, a hospital or a care facility.',
    howToJoin: [
      'No vendor lists were found. Introduce yourself to local estate-planning and elder-law ' +
        'offices with a one-page sheet: commission details, service area, hours, and what you charge for travel.',
      'Ask who handles signings off-site today — many firms use a staff notary and call out only for homebound clients.',
      'Know the Pennsylvania rule that drives the work: a general power of attorney must be ' +
        'acknowledged before a notary and also witnessed by two adults (20 Pa.C.S. § 5601). Living ' +
        'wills and health-care powers of attorney need two witnesses, with notarization optional.',
    ],
    applyUrl: null,
    requirements: ['COMMISSION_ACTIVE'],
    payNote: null,
    paRelevance: 'HIGH',
    paNote:
      'You may not choose the document or advise on what a client needs; that is the practice of ' +
      'law. Let the firm specify the act and the witnesses.',
    caveat: 'The statute is well sourced; whether firms hire outside notaries is not documented.',
    evidence: 'SECONDARY',
    sources: [
      'https://www.legis.state.pa.us/WU01/LI/LI/CT/HTM/20/00.056.001.000..HTM',
      'https://www.palegis.us/statutes/consolidated/view-statute?iFrame=true&txtType=HTM&ttl=20&div=0&chpt=54',
    ],
    capturedOn: CAPTURED,
  },

  // -------------------------------------------------------------------------
  // Healthcare and senior living
  // -------------------------------------------------------------------------
  {
    key: 'healthcare-senior',
    name: 'Hospitals, hospice, nursing homes and assisted living',
    category: 'HEALTHCARE_SENIOR',
    howWorkArrives:
      'Families and facility staff call a mobile notary when a patient or resident has to sign a ' +
      'power of attorney, advance directive or facility paperwork and cannot travel.',
    howToJoin: [
      'No Pennsylvania hospital or care-home vendor program was found. Contact the social-work ' +
        'or admissions office and ask whether they keep a list of mobile notaries.',
      'Bedside work needs care: the National Notary Association’s guidance is to confirm the ' +
        'signer understands what they are signing and to meet them privately.',
      'Be clear about your fee before you travel, and about what you cannot do — you cannot ' +
        'advise the family on which document the patient needs.',
    ],
    applyUrl: null,
    requirements: ['COMMISSION_ACTIVE'],
    payNote:
      'One mobile-notary marketing blog (not Pennsylvania) says $100 to $250 for a facility ' +
      'visit. Treat that as a ceiling, not a norm.',
    paRelevance: 'MEDIUM',
    paNote:
      'Pennsylvania living wills and health-care powers of attorney need witnesses rather than a ' +
      'notary, so expect general powers of attorney and facility paperwork instead.',
    caveat: 'Pay evidence is a single non-Pennsylvania marketing source.',
    evidence: 'ANECDOTAL',
    sources: [
      'https://www.nationalnotary.org/notary-bulletin/blog/2015/04/notarizations-for-hospital-patients',
      'https://findnotary.io/blog/notary-at-nursing-home/',
    ],
    capturedOn: CAPTURED,
  },

  // -------------------------------------------------------------------------
  // Apostille and international documents
  // -------------------------------------------------------------------------
  {
    key: 'pa-apostille',
    name: 'Apostille and documents for international use',
    category: 'APOSTILLE_INTL',
    howWorkArrives:
      'Individuals, students, translators and attorneys need a document notarized before the ' +
      'Pennsylvania Department of State will certify it for use abroad.',
    howToJoin: [
      'Learn the Department of State process: it charges $15 per document and certifies only ' +
        'documents for use outside the United States.',
      'Know what must be notarized first: diplomas, transcripts and criminal-record checks need a ' +
        'Pennsylvania notary before certification; birth certificates should not be notarized; a ' +
        'photocopy of a notarized document cannot be certified; the notarial certificate must be in English.',
      'Market to universities’ registrar offices, translators and immigration-adjacent attorneys, and say plainly that you are not an attorney and cannot give immigration advice.',
    ],
    applyUrl: 'https://www.pa.gov/agencies/dos/programs/document-certification.html',
    requirements: ['COMMISSION_ACTIVE'],
    payNote:
      'The $15 is the Department of State’s own certification fee, not yours. Your notarial fee ' +
      'is capped by the state schedule, with travel and clerical charges itemized separately.',
    paRelevance: 'HIGH',
    paNote:
      'A Pennsylvania notary may not use “notario” or hold themselves out as able to give legal or ' +
      'immigration advice; see the Department of State’s notario-fraud guidance.',
    caveat: null,
    evidence: 'OFFICIAL',
    sources: [
      'https://www.pa.gov/agencies/dos/programs/document-certification.html',
      'https://www.pa.gov/agencies/dos/programs/notaries/notario-fraud',
    ],
    capturedOn: CAPTURED,
  },

  // -------------------------------------------------------------------------
  // Vehicle titles (filed under "other")
  // -------------------------------------------------------------------------
  {
    key: 'pa-vehicle-titles',
    name: 'Vehicle title transfers (PennDOT)',
    category: 'OTHER',
    howWorkArrives:
      'Private sellers and buyers, and dealers that are not PennDOT issuing agents, need the ' +
      'seller’s signature on a title notarized or verified.',
    howToJoin: [
      'Check which form version the customer holds: PennDOT has moved several forms to unsworn ' +
        'declarations, so older versions still need a notary and newer ones may not.',
      'Licensed dealers that are PennDOT issuing agents can verify signatures themselves; ' +
        'other agents must have the signature notarized.',
      'A bigger step is PennDOT Agent Services (notary or messenger), a contract business that ' +
        'needs a $30,000 bond per place of business, State Police background checks for owners and ' +
        'staff, reference letters and a security plan. It is a separate business line, not a quick add-on.',
    ],
    applyUrl:
      'https://www.pa.gov/agencies/dmv/vehicle-services/title-and-registration/buying-or-selling-a-vehicle',
    requirements: ['COMMISSION_ACTIVE'],
    payNote: null,
    paRelevance: 'HIGH',
    paNote: null,
    caveat:
      'Demand is shrinking as forms move to unsworn declarations, and PennDOT’s own pages word ' +
      'the notarization rule slightly differently (before a notary versus before an authorized agent).',
    evidence: 'OFFICIAL',
    sources: [
      'https://www.pa.gov/agencies/dmv/vehicle-services/title-and-registration/buying-or-selling-a-vehicle',
      'https://www.pa.gov/content/dam/copapwp-pagov/en/penndot/documents/public/dvspubsforms/bmv/bmv-fact-sheets/fs-sig.pdf',
    ],
    capturedOn: CAPTURED,
  },

  // -------------------------------------------------------------------------
  // Directories and lead marketplaces
  // -------------------------------------------------------------------------
  {
    key: 'nna-signing-agent',
    name: 'NNA Notary Signing Agent certification and SigningAgent.com',
    category: 'DIRECTORY',
    howWorkArrives:
      'Not a source of work on its own, but the credential many signing services ask for, and a ' +
      'directory (SigningAgent.com) that companies can search.',
    howToJoin: [
      'Buy the signing-agent package, complete the training, and pass the exam (80% or higher is the pass mark).',
      'Complete the bundled background screening; certification and screening are annual.',
      'Your SigningAgent.com listing comes with the Standard package for one year.',
    ],
    applyUrl: 'https://www.nationalnotary.org/notary-signing-agent-training',
    requirements: ['COMMISSION_ACTIVE'],
    payNote: null,
    paRelevance: 'HIGH',
    paNote: null,
    caveat:
      'NNA’s own pages disagree on price: the Standard package is $199 on its signing-agent page ' +
      'and $294 or $299 on older ones, and standalone screening is $89 on one page and $199 on another. ' +
      'Confirm at checkout. NNA says certification is not required by law.',
    evidence: 'OFFICIAL',
    sources: [
      'https://www.nationalnotary.org/signing-agent',
      'https://www.nationalnotary.org/notary-signing-agent-training',
      'https://www.nationalnotary.org/background-screening',
    ],
    capturedOn: CAPTURED,
  },
  {
    key: 'google-business-profile',
    name: 'Google Business Profile',
    category: 'DIRECTORY',
    howWorkArrives:
      'Customers searching “notary near me” find and call you. Free, and the single most direct ' +
      'way to be found for consumer work.',
    howToJoin: [
      'Claim a profile for your notary business and verify it.',
      'Register as a service-area business: Google allows one profile and up to 20 service areas ' +
        'within roughly a two-hour drive, and hides your address.',
      'Do not use a PO box or a virtual office; Google treats those as ineligible.',
      'Ask satisfied customers for reviews.',
    ],
    applyUrl: 'https://support.google.com/business/answer/13763036',
    requirements: ['COMMISSION_ACTIVE'],
    payNote: 'Free.',
    paRelevance: 'HIGH',
    paNote:
      'A Pennsylvania notary’s online listing is an advertisement, so it needs the non-attorney ' +
      'statement Pennsylvania requires.',
    caveat: null,
    evidence: 'OFFICIAL',
    sources: ['https://support.google.com/business/answer/13763036'],
    capturedOn: CAPTURED,
  },
  {
    key: 'notary-rotary',
    name: 'Notary Rotary',
    category: 'DIRECTORY',
    howWorkArrives:
      'A directory of notaries and signing agencies that signing companies and customers search. ' +
      'It is a listing, not a dispatch platform; a Premier membership ranks above a free Basic one.',
    howToJoin: [
      'Create a free Basic listing.',
      'Decide whether Premier is worth it for your area: it is billed annually at $99 in year one, ' +
        '$89 in year two and $79 after (the page for memberships after June 2024; the homepage quotes $79 to $139).',
    ],
    applyUrl: 'https://www.notaryrotary.com/library/memberships.asp',
    requirements: ['COMMISSION_ACTIVE', 'HEADSHOT_BIO'],
    payNote: null,
    paRelevance: 'HIGH',
    paNote: null,
    caveat: 'No refunds on Premier, per the membership page. Forum views on return are mixed.',
    evidence: 'OFFICIAL',
    sources: ['https://www.notaryrotary.com/library/memberships.asp'],
    capturedOn: CAPTURED,
  },
  {
    key: '123notary',
    name: '123notary',
    category: 'DIRECTORY',
    howWorkArrives:
      'A long-running paid directory. Customers and companies searching for a notary in your ' +
      'county are shown listings in paid-rank order.',
    howToJoin: [
      'A free listing is available only where few notaries are listed in your county and you link ' +
        'back to the site or hold a certification.',
      'Otherwise the Regular tier is $59 a year and the Preferential tier $99; top positions ' +
        'are quoted per county (a 2017 post gave $250+ to $500+).',
      'Its free e-Test improves your placement slightly.',
    ],
    applyUrl: 'https://www.123notary.com/m/join/',
    requirements: ['COMMISSION_ACTIVE'],
    payNote: null,
    paRelevance: 'HIGH',
    paNote: null,
    caveat:
      'The pricing page is undated, so figures may be stale. Forum reports on return from paid ' +
      'listings are mixed, and cheaper pay-to-list sites draw “no assignments” complaints.',
    evidence: 'OFFICIAL',
    sources: ['https://www.123notary.com/m/join/'],
    capturedOn: CAPTURED,
  },
  {
    key: 'thumbtack',
    name: 'Thumbtack',
    category: 'DIRECTORY',
    howWorkArrives:
      'Consumers describe a job and Thumbtack sends it to local professionals, who pay for each ' +
      'lead whether or not they win the work.',
    howToJoin: [
      'Create a free professional profile.',
      'Set a maximum price per lead so a slow week does not become an expensive one.',
      'Respond within minutes — leads are shared with several professionals.',
    ],
    applyUrl: 'https://www.thumbtack.com/pro',
    requirements: ['COMMISSION_ACTIVE'],
    payNote:
      'You pay per lead. One notary on Thumbtack’s forum reported $457 for 23 leads (about $16 each); ' +
      'others report $50 to $170. These are unverified community reports.',
    paRelevance: 'MEDIUM',
    paNote: null,
    caveat: 'Lead prices vary by market and over time.',
    evidence: 'ANECDOTAL',
    sources: ['https://www.thumbtack.com/pro', 'https://help.thumbtack.com/article/new-pro-guide-1'],
    capturedOn: CAPTURED,
  },
  {
    key: 'yelp-nextdoor',
    name: 'Yelp and Nextdoor business pages',
    category: 'DIRECTORY',
    howWorkArrives:
      'Local discovery and reputation. Neighbours ask for recommendations on Nextdoor; people ' +
      'check reviews on Yelp before they call.',
    howToJoin: [
      'Claim a free Yelp business page and a Nextdoor Business Page (Nextdoor requires verification).',
      'Both sell advertising, from about $5 a day by their own marketing; start with the free pages.',
    ],
    applyUrl: 'https://business.yelp.com/products/business-page/',
    requirements: ['COMMISSION_ACTIVE'],
    payNote: 'Free pages; paid advertising from about $5 a day (company marketing).',
    paRelevance: 'MEDIUM',
    paNote: null,
    caveat: null,
    evidence: 'OFFICIAL',
    sources: [
      'https://business.yelp.com/products/business-page/',
      'https://business.nextdoor.com/en-us/getting-started/business-page',
    ],
    capturedOn: CAPTURED,
  },
  {
    key: 'pa-association-of-notaries',
    name: 'Pennsylvania Association of Notaries — Find a Notary',
    category: 'DIRECTORY',
    howWorkArrives:
      'A statewide directory of Pennsylvania notaries, searched by people who want a local ' +
      'commissioned notary.',
    howToJoin: [
      'Create a voluntary profile on the association’s find-a-notary page.',
      'Membership is bundled into its notary packages; no standalone price was seen.',
    ],
    applyUrl: 'https://www.notary.org/find-notary-in-pa',
    requirements: ['COMMISSION_ACTIVE'],
    payNote: null,
    paRelevance: 'HIGH',
    paNote: null,
    caveat: 'Little was found beyond the directory page itself; confirm what a listing costs and includes.',
    evidence: 'OFFICIAL',
    sources: ['https://www.notary.org/find-notary-in-pa'],
    capturedOn: CAPTURED,
  },

  // -------------------------------------------------------------------------
  // Remote online notarization platforms
  // -------------------------------------------------------------------------
  {
    key: 'proof',
    name: 'Proof (formerly Notarize) — On-Demand Notary',
    category: 'RON_PLATFORM',
    howWorkArrives:
      'Remote notarizations are routed to notaries on a live queue, including real-estate ' +
      'transactions from title agents and lenders. Proof’s on-demand network is live in Pennsylvania.',
    howToJoin: [
      'Hold a Pennsylvania commission and be authorized for electronic or remote notarization: ' +
        'notify the Department of State online of each technology you will use before your first act.',
      'Hold a National Notary Association Notary Signing Agent certification with its background check.',
      'Upload an E&O policy of at least $25,000, pass the platform-training assessments (80%), and ' +
        'obtain a digital certificate through ID verification.',
      'Your name on the platform must match your commission exactly.',
    ],
    applyUrl:
      'https://support.proof.com/hc/en-us/articles/4424922523415-On-Demand-Notary-Overview',
    requirements: [
      'COMMISSION_ACTIVE',
      'ELECTRONIC_NOTARY_APPROVAL',
      'NNA_CERTIFIED',
      'BACKGROUND_CHECK',
      'EO_ACTIVE',
    ],
    payNote:
      'Per Proof’s pay guide: $5 for the first stamp and $1 for each additional on retail and ' +
      'business sessions; $25 per completed real-estate transaction; $20 for a HELOC. If you ' +
      'bring your own clients, you set the price and Proof deducts $10 per transaction.',
    paRelevance: 'HIGH',
    paNote:
      'Proof is on Pennsylvania’s approved vendor list. Pennsylvania lets a remote notary add up ' +
      'to $20 per act to the base fee; Proof’s own per-act pay is set by Proof.',
    caveat:
      'Proof’s generic Pennsylvania compliance page carries text and a $75 fee copied from ' +
      'another state — do not rely on it. The Department of State says there is no added fee to register.',
    evidence: 'OFFICIAL',
    sources: [
      'https://support.proof.com/hc/en-us/articles/4424922523415-On-Demand-Notary-Overview',
      'https://support.proof.com/hc/en-us/articles/360057055154-Pay-Structure-and-Payout-Guide-for-On-Demand-Notaries',
      'https://support.proof.com/hc/en-us/articles/19239738708375-Fees-for-Notary-Sourced-Transactions',
      'https://www.proof.com/blog/notarize-network-pennsylvania-notaries',
      PA_VENDOR_LIST,
    ],
    capturedOn: CAPTURED,
  },
  {
    key: 'notarycam',
    name: 'NotaryCam',
    category: 'RON_PLATFORM',
    howWorkArrives:
      'Independent notaries perform remote notarizations for NotaryCam’s clients and, on the ' +
      'independent plan, for their own.',
    howToJoin: [
      'Hold remote-notarization authorization in your state, with your seal and a digital certificate.',
      'Provide a background check and proof of E&O.',
      'Choose the independent plan: the pricing page shows a $99 onboarding fee, $15 a month, ' +
        'and per-session charges.',
    ],
    applyUrl: 'https://www.notarycam.com/independent-notary-sign-up/',
    requirements: [
      'COMMISSION_ACTIVE',
      'ELECTRONIC_NOTARY_APPROVAL',
      'BACKGROUND_CHECK',
      'EO_ACTIVE',
    ],
    payNote:
      'Per its pricing page: a $5 minimum per signer plus $15 per seal on the independent plan.',
    paRelevance: 'HIGH',
    paNote: 'NotaryCam is on Pennsylvania’s approved electronic and remote notarization vendor list.',
    caveat:
      'The pricing page and a separate mention of a 12-month contract conflict; confirm the term before you sign.',
    evidence: 'OFFICIAL',
    sources: [
      'https://www.notarycam.com/independent-notary-sign-up/',
      'https://www.notarycam.com/pricing/',
      PA_VENDOR_LIST,
    ],
    capturedOn: CAPTURED,
  },
  {
    key: 'bluenotary',
    name: 'BlueNotary',
    category: 'RON_PLATFORM',
    howWorkArrives:
      'A remote-notarization platform with a free basic account; notaries perform sessions for ' +
      'BlueNotary customers or bring their own.',
    howToJoin: [
      'Open the free basic account and complete identity and commission verification.',
      'Confirm your state authorization (in Pennsylvania, notify the Department of State).',
      'Compare the paid tiers before upgrading — see the caveat.',
    ],
    applyUrl: 'https://bluenotary.us/pricing',
    requirements: ['COMMISSION_ACTIVE', 'ELECTRONIC_NOTARY_APPROVAL'],
    payNote: null,
    paRelevance: 'HIGH',
    paNote: 'BlueNotary is on Pennsylvania’s approved electronic and remote notarization vendor list.',
    caveat:
      'Two BlueNotary sites list different plans and prices, and the fee schedule seen was last ' +
      'updated in December 2023. Confirm current pay and plan costs on the platform.',
    evidence: 'OFFICIAL',
    sources: ['https://bluenotary.us/pricing', 'https://new.bluenotary.us/for-notaries', PA_VENDOR_LIST],
    capturedOn: CAPTURED,
  },
];

export function workSourceByKey(key: string | null | undefined): WorkSource | null {
  if (!key) return null;
  return WORK_SOURCES.find((source) => source.key === key) ?? null;
}

/** Most recent capture date across the directory, shown beside it in the UI. */
export function workSourcesCapturedOn(): string | null {
  const dates = WORK_SOURCES.map((source) => source.capturedOn).sort();
  return dates.length > 0 ? dates[dates.length - 1] : null;
}

const PA_RANK: Record<PaRelevance, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/**
 * Pennsylvania-relevant sources first. Within a tier, the sources the notary is
 * closest to joining come first when `readyPercent` is supplied, so the top of
 * the list is what they can act on today; then alphabetical.
 */
export function compareSourcesForPa(
  a: WorkSource,
  b: WorkSource,
  readyPercent?: (source: WorkSource) => number,
): number {
  return (
    PA_RANK[a.paRelevance] - PA_RANK[b.paRelevance] ||
    (readyPercent ? readyPercent(b) - readyPercent(a) : 0) ||
    a.name.localeCompare(b.name)
  );
}
