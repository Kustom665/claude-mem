'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Alert,
  Button,
  Card,
  CardBody,
  Checkbox,
  Field,
  Fieldset,
  FormError,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import {
  ACTS_REQUIRING_OATH,
  ACT_TYPES,
  ACT_TYPE_LABELS,
  IDENTITY_METHODS,
  IDENTITY_METHOD_LABELS,
  ID_DOCUMENT_TYPES,
  US_STATES,
  type ActType,
  type IdentityMethod,
} from '@/lib/domain';
import { formatCents } from '@/lib/money';
import { createJournalEntryAction, type JournalFormState } from '../actions';

/**
 * The rules that govern this notary, computed on the server and passed down so
 * the browser and the server action agree on what is required.
 */
export type JournalFormRules = {
  commissionState: string | null;
  prohibitsBiometrics: boolean;
  publicInspectionRight: boolean;
  /** Document phrases that trigger a thumbprint requirement in this state. */
  thumbprintTriggers: string[];
  /** Statutory maximum for a standard act, in cents, or null if unknown. */
  actMaxCents: number | null;
  ronMaxCents: number | null;
  ronIsSurcharge: boolean;
  requiresFeeDisclosure: boolean;
  feeNote: string | null;
};

export type SigningOption = { id: string; label: string };

const COMMON_DOCUMENTS = [
  'Deed of Trust',
  'Mortgage',
  'Grant Deed',
  'Quitclaim Deed',
  'Power of Attorney',
  'Affidavit',
  'Promissory Note',
  'Closing Disclosure',
  'Signature/Name Affidavit',
  'Occupancy Affidavit',
  'Compliance Agreement',
  'Living Trust',
  'Advance Health Care Directive',
  'Vehicle Title Transfer',
  'Parental Consent to Travel',
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Sealing entry…' : 'Seal journal entry'}
    </Button>
  );
}

/** Set when this entry corrects an earlier one. */
export type AmendmentContext = {
  entryId: string;
  sequenceNumber: number;
  signerName: string;
};

export function JournalEntryForm({
  rules,
  signings,
  defaults,
  amending,
}: {
  rules: JournalFormRules;
  signings: SigningOption[];
  defaults: {
    performedAt: string;
    locationState: string | null;
    signingId?: string;
    documentType?: string;
    signerName?: string;
  };
  amending?: AmendmentContext;
}) {
  const [state, formAction] = useActionState<JournalFormState, FormData>(
    createJournalEntryAction,
    null,
  );
  const errors = state?.errors ?? {};

  const [actType, setActType] = useState<ActType>('ACKNOWLEDGMENT');
  const [identityMethod, setIdentityMethod] = useState<IdentityMethod>('IDENTIFICATION_DOCUMENT');
  const [documentType, setDocumentType] = useState(defaults.documentType ?? '');
  const [isRemote, setIsRemote] = useState(false);
  const [feeText, setFeeText] = useState('');

  // Mirrors assessThumbprint() on the server. Kept in sync by sharing the
  // trigger list rather than duplicating the patterns.
  const thumbprintTriggered = useMemo(() => {
    const haystack = documentType.toLowerCase();
    if (/reconveyance|trustee'?s? deed/.test(haystack)) return false;
    return rules.thumbprintTriggers.some((trigger) => haystack.includes(trigger));
  }, [documentType, rules.thumbprintTriggers]);

  const thumbprintRequired =
    thumbprintTriggered && !rules.prohibitsBiometrics && rules.commissionState === 'CA';

  const feeCapCents = useMemo(() => {
    if (rules.actMaxCents === null) return null;
    if (!isRemote || rules.ronMaxCents === null) return rules.actMaxCents;
    return rules.ronIsSurcharge ? rules.actMaxCents + rules.ronMaxCents : rules.ronMaxCents;
  }, [isRemote, rules.actMaxCents, rules.ronMaxCents, rules.ronIsSurcharge]);

  const feeCents = useMemo(() => {
    const cleaned = feeText.replace(/[$,\s]/g, '');
    if (cleaned === '') return null;
    const value = Number(cleaned);
    return Number.isFinite(value) ? Math.round(value * 100) : null;
  }, [feeText]);

  const overCap = feeCapCents !== null && feeCents !== null && feeCents > feeCapCents;

  return (
    <form action={formAction} className="space-y-5">
      <FormError message={errors._form} />

      {amending ? (
        <>
          <input type="hidden" name="amendsEntryId" value={amending.entryId} />
          <Alert tone="warning" title={`Amending entry #${amending.sequenceNumber}`}>
            The original entry stays exactly as it was sealed. This creates a new, separately
            numbered entry that points back at it — the same thing you would do in a paper journal
            by lining out the error and adding a dated correction. Re-enter the act as it should
            have been recorded.
          </Alert>
          <Card>
            <CardBody>
              <Field
                label="What this amendment corrects"
                htmlFor="amendmentReason"
                error={errors.amendmentReason}
                hint={`Original entry recorded ${amending.signerName}.`}
                required
              >
                <Textarea
                  id="amendmentReason"
                  name="amendmentReason"
                  required
                  placeholder="Signer's middle initial was recorded as J; the identification read M."
                />
              </Field>
            </CardBody>
          </Card>
        </>
      ) : null}

      {rules.prohibitsBiometrics ? (
        <Alert tone="info" title={`${rules.commissionState} journal rules`}>
          Your journal may not contain personal identifiers — no Social Security number, no full ID
          number, no date of birth, and no biometrics. This form records only the last four digits
          of an ID and has no thumbprint field, so an entry cannot be made non-compliant by
          accident.
        </Alert>
      ) : null}

      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Date and time of the act" htmlFor="performedAt" error={errors.performedAt} required>
            <Input
              id="performedAt"
              name="performedAt"
              type="datetime-local"
              defaultValue={defaults.performedAt}
              required
            />
          </Field>

          <Field label="Type of notarial act" htmlFor="actType" error={errors.actType} required>
            <Select
              id="actType"
              name="actType"
              value={actType}
              onChange={(event) => setActType(event.target.value as ActType)}
              required
            >
              {ACT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {ACT_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Document type"
            htmlFor="documentType"
            error={errors.documentType}
            hint="What the document is called — this drives the thumbprint rules."
            required
          >
            <Input
              id="documentType"
              name="documentType"
              list="common-documents"
              value={documentType}
              onChange={(event) => setDocumentType(event.target.value)}
              placeholder="Deed of Trust"
              required
            />
            <datalist id="common-documents">
              {COMMON_DOCUMENTS.map((doc) => (
                <option key={doc} value={doc} />
              ))}
            </datalist>
          </Field>

          <Field label="Date on the document" htmlFor="documentDate" error={errors.documentDate}>
            <Input id="documentDate" name="documentDate" type="date" />
          </Field>

          <Field
            label="Number of signatures notarised"
            htmlFor="numberOfSignatures"
            error={errors.numberOfSignatures}
          >
            <Input
              id="numberOfSignatures"
              name="numberOfSignatures"
              type="number"
              min={1}
              max={100}
              defaultValue={1}
            />
          </Field>

          <Field label="Linked signing" htmlFor="signingId" error={errors.signingId}>
            <Select id="signingId" name="signingId" defaultValue={defaults.signingId ?? ''}>
              <option value="">Not linked to a signing</option>
              {signings.map((signing) => (
                <option key={signing.id} value={signing.id}>
                  {signing.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Further description"
            htmlFor="documentDescription"
            error={errors.documentDescription}
            className="sm:col-span-2"
          >
            <Input
              id="documentDescription"
              name="documentDescription"
              placeholder="Property at 118 Maple Ave; loan #4482190"
            />
          </Field>
        </CardBody>
      </Card>

      {ACTS_REQUIRING_OATH.has(actType) ? (
        <Alert tone="warning" title="This act requires an oath or affirmation">
          A {ACT_TYPE_LABELS[actType].toLowerCase()} is only valid if you actually administered the
          oath or affirmation and the signer responded. Ceremonial words matter here — an unsworn
          jurat is a defective notarisation.
        </Alert>
      ) : null}

      <Card>
        <CardBody>
          <Fieldset legend="Signer" description="Recorded in the journal as the person whose signature you notarised.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" htmlFor="signerName" error={errors.signerName} required>
                <Input
                  id="signerName"
                  name="signerName"
                  defaultValue={defaults.signerName ?? ''}
                  required
                />
              </Field>
              <Field label="Phone" htmlFor="signerPhone" error={errors.signerPhone}>
                <Input id="signerPhone" name="signerPhone" type="tel" />
              </Field>
              <Field label="Address" htmlFor="signerAddressLine1" error={errors.signerAddressLine1}>
                <Input id="signerAddressLine1" name="signerAddressLine1" />
              </Field>
              <Field label="Email" htmlFor="signerEmail" error={errors.signerEmail}>
                <Input id="signerEmail" name="signerEmail" type="email" />
              </Field>
              <Field label="City" htmlFor="signerCity" error={errors.signerCity}>
                <Input id="signerCity" name="signerCity" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="State" htmlFor="signerState" error={errors.signerState}>
                  <Select id="signerState" name="signerState" defaultValue="">
                    <option value="">—</option>
                    {US_STATES.map(([code]) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="ZIP" htmlFor="signerPostalCode" error={errors.signerPostalCode}>
                  <Input id="signerPostalCode" name="signerPostalCode" inputMode="numeric" />
                </Field>
              </div>
            </div>
          </Fieldset>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <Fieldset
            legend="How you identified the signer"
            description="The field a commissioning authority audits first."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Method"
                htmlFor="identityMethod"
                error={errors.identityMethod}
                className="sm:col-span-2"
                required
              >
                <Select
                  id="identityMethod"
                  name="identityMethod"
                  value={identityMethod}
                  onChange={(event) => setIdentityMethod(event.target.value as IdentityMethod)}
                  required
                >
                  {IDENTITY_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {IDENTITY_METHOD_LABELS[method]}
                    </option>
                  ))}
                </Select>
              </Field>

              {identityMethod === 'IDENTIFICATION_DOCUMENT' ? (
                <>
                  <Field label="Document shown" htmlFor="idType" error={errors.idType} required>
                    <Input id="idType" name="idType" list="id-types" placeholder="Driver's license" />
                    <datalist id="id-types">
                      {ID_DOCUMENT_TYPES.map((type) => (
                        <option key={type} value={type} />
                      ))}
                    </datalist>
                  </Field>
                  <Field label="Issued by" htmlFor="idIssuer" error={errors.idIssuer} hint="State or country that issued it.">
                    <Input id="idIssuer" name="idIssuer" placeholder="Pennsylvania" />
                  </Field>
                  <Field
                    label="Last four digits only"
                    htmlFor="idNumberLast4"
                    error={errors.idNumberLast4}
                    hint="Never record a full ID number. Four digits is all any state permits."
                  >
                    <Input
                      id="idNumberLast4"
                      name="idNumberLast4"
                      inputMode="numeric"
                      maxLength={4}
                      pattern="\d{4}"
                      placeholder="4821"
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Issued on" htmlFor="idIssuedOn" error={errors.idIssuedOn}>
                      <Input id="idIssuedOn" name="idIssuedOn" type="date" />
                    </Field>
                    <Field label="Expires" htmlFor="idExpiresOn" error={errors.idExpiresOn}>
                      <Input id="idExpiresOn" name="idExpiresOn" type="date" />
                    </Field>
                  </div>
                </>
              ) : null}

              {identityMethod === 'CREDIBLE_WITNESS' ? (
                <>
                  <Field
                    label="Credible witness"
                    htmlFor="credibleWitnessName"
                    error={errors.credibleWitnessName}
                    required
                  >
                    <Input id="credibleWitnessName" name="credibleWitnessName" />
                  </Field>
                  <Field
                    label="Second credible witness"
                    htmlFor="secondCredibleWitnessName"
                    error={errors.secondCredibleWitnessName}
                    hint="Some states require two when you do not personally know the witness."
                  >
                    <Input id="secondCredibleWitnessName" name="secondCredibleWitnessName" />
                  </Field>
                  <Field
                    label="Witness address"
                    htmlFor="credibleWitnessAddress"
                    error={errors.credibleWitnessAddress}
                    className="sm:col-span-2"
                  >
                    <Input id="credibleWitnessAddress" name="credibleWitnessAddress" />
                  </Field>
                </>
              ) : null}

              {identityMethod === 'PERSONAL_KNOWLEDGE' ? (
                <div className="sm:col-span-2">
                  <Alert tone="warning">
                    Personal knowledge means you know this person well enough to be certain of their
                    identity — not that they were introduced to you today. If there is any doubt,
                    ask for identification instead.
                  </Alert>
                </div>
              ) : null}
            </div>
          </Fieldset>
        </CardBody>
      </Card>

      {thumbprintTriggered && !rules.prohibitsBiometrics ? (
        <Alert
          tone={thumbprintRequired ? 'danger' : 'warning'}
          title={
            thumbprintRequired
              ? 'This document requires a thumbprint'
              : 'This document affects real property'
          }
        >
          {thumbprintRequired
            ? 'California Government Code §8206 requires the signer’s right thumbprint in your journal for powers of attorney and documents affecting real property. The entry cannot be sealed without it.'
            : 'A thumbprint is not required in your state, but it is the strongest evidence available if this notarisation is ever challenged.'}
        </Alert>
      ) : null}

      <Card>
        <CardBody>
          <Fieldset legend="Fees and circumstances">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Notarial fee charged"
                htmlFor="feeChargedCents"
                error={errors.feeChargedCents}
                hint={
                  feeCapCents !== null
                    ? `${rules.commissionState} maximum: ${formatCents(feeCapCents)}${isRemote && rules.ronIsSurcharge ? ' including the remote surcharge' : ''}.`
                    : 'Verify your state’s maximum before charging.'
                }
              >
                <Input
                  id="feeChargedCents"
                  name="feeChargedCents"
                  inputMode="decimal"
                  value={feeText}
                  onChange={(event) => setFeeText(event.target.value)}
                  placeholder="5.00"
                  aria-invalid={overCap}
                />
              </Field>

              <Field
                label="Travel fee"
                htmlFor="travelFeeCents"
                error={errors.travelFeeCents}
                hint="Non-notarial. Subject to self-employment tax and tracked separately."
              >
                <Input id="travelFeeCents" name="travelFeeCents" inputMode="decimal" placeholder="0.00" />
              </Field>

              <Field label="City where the act was performed" htmlFor="locationCity" error={errors.locationCity}>
                <Input id="locationCity" name="locationCity" />
              </Field>

              <Field label="State" htmlFor="locationState" error={errors.locationState}>
                <Select
                  id="locationState"
                  name="locationState"
                  defaultValue={defaults.locationState ?? ''}
                >
                  <option value="">—</option>
                  {US_STATES.map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="space-y-3 sm:col-span-2">
                {!rules.prohibitsBiometrics ? (
                  <Checkbox
                    name="thumbprintTaken"
                    label="Thumbprint taken"
                    hint={
                      thumbprintRequired
                        ? 'Required for this document in your state.'
                        : 'Optional, but strong evidence.'
                    }
                  />
                ) : null}

                <Checkbox
                  name="notarizedRemotely"
                  label="Performed remotely using communication technology"
                  checked={isRemote}
                  onChange={(event) => setIsRemote(event.target.checked)}
                />

                {isRemote ? (
                  <Field label="RON platform" htmlFor="ronPlatform" error={errors.ronPlatform} required>
                    <Input id="ronPlatform" name="ronPlatform" placeholder="e.g. BlueNotary" />
                  </Field>
                ) : null}
              </div>

              <Field label="Witness names" htmlFor="witnessNames" error={errors.witnessNames}>
                <Input id="witnessNames" name="witnessNames" placeholder="Separate with commas" />
              </Field>

              <Field label="Notes" htmlFor="notes" error={errors.notes} className="sm:col-span-2">
                <Textarea
                  id="notes"
                  name="notes"
                  placeholder="Anything unusual: a refused signature, an interpreter present, a signer who could not sign by hand."
                />
              </Field>
            </div>
          </Fieldset>
        </CardBody>
      </Card>

      {overCap ? (
        <Alert tone="danger" title="Fee is above your state maximum">
          {rules.commissionState} caps this act at {formatCents(feeCapCents)}. Bill the difference
          as a separate, disclosed non-notarial charge — travel, printing or handling — rather than
          as a notarial fee.
        </Alert>
      ) : null}

      {rules.requiresFeeDisclosure ? (
        <Alert tone="info">
          {rules.commissionState} requires you to disclose your fees to the client before performing
          the act. Non-notarial charges must be itemised and agreed in advance.
        </Alert>
      ) : null}

      <Alert tone="neutral" title="This entry is permanent">
        Sealing writes the entry into a hash chain that makes any later alteration detectable. It
        cannot be edited or deleted afterwards — a mistake is corrected by adding an amending entry
        that references this one, exactly as you would line out and annotate a paper journal.
      </Alert>

      <div className="flex flex-wrap gap-2">
        <SubmitButton />
      </div>
    </form>
  );
}
