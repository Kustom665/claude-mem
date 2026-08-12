import { describe, expect, it } from 'vitest';
import {
  assessThumbprint,
  checkFeeAgainstStateMax,
  journalFieldRulesFor,
  journalRuleFor,
  requiresFeeDisclosure,
} from '../src/lib/compliance';
import { fillTemplate, placeholdersIn, certificateTemplatesFor } from '../src/lib/certificates';
import { signPayload } from '../src/lib/webhooks';
import { journalEntrySchema, toFieldErrors } from '../src/lib/validation';

/**
 * State rules run in opposite directions, which is the whole reason this layer
 * exists: California *requires* a thumbprint for real-property documents while
 * Pennsylvania *prohibits* recording biometrics at all. A generic notary app
 * gets one of those wrong.
 */
describe('assessThumbprint', () => {
  it('requires a thumbprint for California real-property documents', () => {
    for (const doc of [
      'Deed of Trust',
      'Grant Deed',
      'Quitclaim Deed',
      'Power of Attorney',
      'Mortgage',
    ]) {
      const result = assessThumbprint(doc, null, 'CA');
      expect(result.required, `${doc} should require a thumbprint in CA`).toBe(true);
      expect(result.prohibited).toBe(false);
    }
  });

  it('honours the California statutory exemptions', () => {
    // Deeds of reconveyance and trustees' deeds are carved out of §8206.
    for (const doc of ['Deed of Reconveyance', "Trustee's Deed Upon Sale"]) {
      const result = assessThumbprint(doc, null, 'CA');
      expect(result.required, `${doc} is exempt`).toBe(false);
      expect(result.exempt).toBe(true);
    }
  });

  it('prohibits thumbprints in Pennsylvania regardless of document', () => {
    const result = assessThumbprint('Deed of Trust', null, 'PA');
    expect(result.prohibited).toBe(true);
    expect(result.required).toBe(false);
    expect(result.reason).toContain('biometrics');
  });

  it('recommends but does not require elsewhere', () => {
    const result = assessThumbprint('Deed of Trust', null, 'TX');
    expect(result.required).toBe(false);
    expect(result.prohibited).toBe(false);
    expect(result.recommended).toBe(true);
  });

  it('says nothing for documents unrelated to real property', () => {
    const result = assessThumbprint('Affidavit of Identity', null, 'CA');
    expect(result.required).toBe(false);
    expect(result.recommended).toBe(false);
    expect(result.reason).toBeNull();
  });

  it('reads the description as well as the type', () => {
    const result = assessThumbprint('Miscellaneous', 'Signed grant deed for the Bellefonte lot', 'CA');
    expect(result.required).toBe(true);
  });
});

describe('journal field rules', () => {
  it('captures the Pennsylvania personal-identifier ban', () => {
    const rules = journalFieldRulesFor('PA');
    expect(rules.prohibitsBiometrics).toBe(true);
    expect(rules.idNumberLastFourOnly).toBe(true);
    expect(rules.prohibitsDateOfBirth).toBe(true);
    expect(rules.publicInspectionRight).toBe(true);
  });

  it('defaults to last-four-only everywhere, which is safe in every state', () => {
    const rules = journalFieldRulesFor('WY');
    expect(rules.idNumberLastFourOnly).toBe(true);
    expect(rules.prohibitsBiometrics).toBe(false);
  });
});

describe('journalRuleFor', () => {
  it('knows Pennsylvania mandates a journal and permits an electronic one', () => {
    const rule = journalRuleFor('PA');
    expect(rule.requirement).toBe('REQUIRED');
    expect(rule.electronicJournalPermitted).toBe(true);
  });

  it('knows California does not treat an electronic journal as the record', () => {
    expect(journalRuleFor('CA').electronicJournalPermitted).toBe(false);
  });

  it('falls back to a best-practice recommendation for unknown states', () => {
    expect(journalRuleFor('ZZ').requirement).toBe('RECOMMENDED');
    expect(journalRuleFor(null).requirement).toBe('RECOMMENDED');
  });
});

describe('checkFeeAgainstStateMax', () => {
  it('enforces the Pennsylvania $5 cap', () => {
    const under = checkFeeAgainstStateMax(500, 'ACKNOWLEDGMENT', 'PA');
    expect(under?.overMax).toBe(false);

    const over = checkFeeAgainstStateMax(1500, 'ACKNOWLEDGMENT', 'PA');
    expect(over?.overMax).toBe(true);
    expect(over?.maxCents).toBe(500);
  });

  it('adds the Pennsylvania remote surcharge on top of the base fee', () => {
    // PA allows up to $20 extra per act performed with communication technology.
    const remote = checkFeeAgainstStateMax(2500, 'ACKNOWLEDGMENT', 'PA', true);
    expect(remote?.maxCents).toBe(2500);
    expect(remote?.overMax).toBe(false);

    expect(checkFeeAgainstStateMax(2600, 'ACKNOWLEDGMENT', 'PA', true)?.overMax).toBe(true);
  });

  it('treats Florida’s RON figure as an absolute cap, not a surcharge', () => {
    const remote = checkFeeAgainstStateMax(2500, 'ACKNOWLEDGMENT', 'FL', true);
    expect(remote?.maxCents).toBe(2500);
  });

  it('enforces California’s per-signature $15', () => {
    expect(checkFeeAgainstStateMax(1500, 'ACKNOWLEDGMENT', 'CA')?.overMax).toBe(false);
    expect(checkFeeAgainstStateMax(1600, 'ACKNOWLEDGMENT', 'CA')?.overMax).toBe(true);
  });

  it('returns null rather than guessing for states without reference data', () => {
    // "We don't know the cap" must be distinguishable from "within the cap".
    expect(checkFeeAgainstStateMax(9999, 'ACKNOWLEDGMENT', 'WY')).toBeNull();
    expect(checkFeeAgainstStateMax(9999, 'ACKNOWLEDGMENT', null)).toBeNull();
  });
});

describe('requiresFeeDisclosure', () => {
  it('flags the three states that compel advance disclosure', () => {
    expect(requiresFeeDisclosure('PA')).toBe(true);
    expect(requiresFeeDisclosure('MI')).toBe(true);
    expect(requiresFeeDisclosure('NC')).toBe(true);
    expect(requiresFeeDisclosure('CA')).toBe(false);
  });
});

describe('certificate templates', () => {
  it('puts the Pennsylvania forms first for a PA notary', () => {
    const templates = certificateTemplatesFor('PA');
    expect(templates[0].state).toBe('PA');
    expect(templates.some((template) => template.actType === 'JURAT')).toBe(true);
  });

  it('falls back to the generic RULONA forms elsewhere', () => {
    const templates = certificateTemplatesFor('TX');
    expect(templates.every((template) => template.state === null)).toBe(true);
  });

  it('fills placeholders and rules a blank line for the rest', () => {
    const filled = fillTemplate('Before me on {{date}} by {{signer_name}}.', {
      date: '1 August 2026',
    });
    expect(filled).toContain('1 August 2026');
    expect(filled).toContain('________________');
  });

  it('lists placeholders in first-appearance order', () => {
    expect(placeholdersIn('{{county}} then {{date}} then {{county}}')).toEqual([
      'county',
      'date',
    ]);
  });
});

describe('webhook signing', () => {
  it('is deterministic and depends on secret, timestamp and body', () => {
    const body = '{"event":"signing.completed"}';
    const base = signPayload('secret', '1000', body);

    expect(signPayload('secret', '1000', body)).toBe(base);
    expect(signPayload('other', '1000', body)).not.toBe(base);
    expect(signPayload('secret', '1001', body)).not.toBe(base);
    expect(signPayload('secret', '1000', `${body} `)).not.toBe(base);
  });

  it('produces a hex SHA-256 digest', () => {
    expect(signPayload('s', '1', 'b')).toMatch(/^[0-9a-f]{64}$/);
  });
});

/**
 * Regression guard for the silent-failure bug.
 *
 * A browser omits a form control from the submission entirely when it was never
 * rendered, or when a checkbox is unchecked. This app renders controls
 * conditionally on purpose, so absent keys are normal — and when the schema
 * demanded them, every conditionally-hidden field failed validation against a
 * field with no visible input. The form silently did nothing, which in
 * Pennsylvania meant no journal entry could ever be recorded.
 */
describe('journalEntrySchema with fields the browser did not submit', () => {
  /** Exactly what a PA notary's browser posts: no thumbprint, no witness, no RON. */
  const pennsylvaniaSubmission = {
    performedAt: '2026-08-12T11:20',
    actType: 'ACKNOWLEDGMENT',
    documentType: 'Affidavit of Residence',
    documentDate: '',
    documentDescription: '',
    numberOfSignatures: '1',
    signerName: 'Marcus Ellery Vance',
    signerAddressLine1: '',
    signerCity: '',
    signerState: '',
    signerPostalCode: '',
    signerPhone: '',
    signerEmail: '',
    identityMethod: 'IDENTIFICATION_DOCUMENT',
    idType: "Driver's license",
    idIssuer: 'Pennsylvania',
    idNumberLast4: '7731',
    idIssuedOn: '',
    idExpiresOn: '',
    feeChargedCents: '5.00',
    travelFeeCents: '',
    witnessNames: '',
    locationCity: 'Pittsburgh',
    locationState: 'PA',
    notes: '',
    signingId: '',
    amendsEntryId: '',
    amendmentReason: '',
    // Deliberately absent, because the browser never sends them:
    //   thumbprintTaken, notarizedRemotely  — unchecked checkboxes
    //   ronPlatform                          — only rendered for a remote act
    //   credibleWitnessName, credibleWitnessAddress, secondCredibleWitnessName
    //                                        — only rendered for that method
  };

  it('accepts a Pennsylvania submission', () => {
    const result = journalEntrySchema.safeParse(pennsylvaniaSubmission);
    expect(
      result.success ? null : toFieldErrors(result.error),
      'a PA notary must be able to record an entry',
    ).toBeNull();
  });

  it('defaults absent checkboxes to false rather than rejecting', () => {
    const result = journalEntrySchema.parse(pennsylvaniaSubmission);
    expect(result.thumbprintTaken).toBe(false);
    expect(result.notarizedRemotely).toBe(false);
  });

  it('maps absent optional text to null', () => {
    const result = journalEntrySchema.parse(pennsylvaniaSubmission);
    expect(result.credibleWitnessName).toBeNull();
    expect(result.ronPlatform).toBeNull();
    expect(result.signingId).toBeNull();
  });

  it('still parses when every optional key is missing entirely', () => {
    // The minimum a form could post and still be a valid act.
    const minimal = {
      performedAt: '2026-08-12T11:20',
      actType: 'JURAT',
      documentType: 'Affidavit',
      signerName: 'Dana Reyes',
      identityMethod: 'PERSONAL_KNOWLEDGE',
      feeChargedCents: '5.00',
    };
    const result = journalEntrySchema.safeParse(minimal);
    expect(result.success ? null : toFieldErrors(result.error)).toBeNull();
  });

  it('still rejects genuinely missing required fields', () => {
    // The fix must not turn every absent key into a pass.
    const result = journalEntrySchema.safeParse({
      performedAt: '2026-08-12T11:20',
      actType: 'ACKNOWLEDGMENT',
      identityMethod: 'PERSONAL_KNOWLEDGE',
      feeChargedCents: '5.00',
      // documentType and signerName absent
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = toFieldErrors(result.error);
      expect(errors.documentType).toBeTruthy();
      expect(errors.signerName).toBeTruthy();
    }
  });

  it('still enforces the credible-witness rule when that method is chosen', () => {
    const result = journalEntrySchema.safeParse({
      ...pennsylvaniaSubmission,
      identityMethod: 'CREDIBLE_WITNESS',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toFieldErrors(result.error).credibleWitnessName).toBeTruthy();
    }
  });
});
