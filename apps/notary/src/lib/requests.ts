import {
  CONTACT_PREFERENCE_LABELS,
  REQUEST_SERVICE_LABELS,
  TIME_WINDOWS,
  type ContactPreference,
  type RequestService,
  type TimeWindow,
} from './domain';
import { ceilToHour, zonedTimeToUtc } from './dates';

/**
 * Turning a request into a calendar entry.
 *
 * A requester says "Thursday afternoon", not "13:00 America/New_York". These
 * helpers do the translation once, in one place, so accepting a request lands
 * a signing at a believable time in the notary's own zone and never in the past.
 */

/** Hour of day (24h, notary-local) a window opens at. */
export const WINDOW_START_HOUR: Record<TimeWindow, number> = {
  FLEXIBLE: 10,
  MORNING: 9,
  AFTERNOON: 13,
  EVENING: 18,
};

function isTimeWindow(value: string): value is TimeWindow {
  return (TIME_WINDOWS as readonly string[]).includes(value);
}

/**
 * When to put an accepted request on the calendar.
 *
 * Uses the requester's date and window when they are usable; otherwise the
 * earliest slot the notary's own minimum-notice setting allows. The notary
 * confirms or changes it on the signing that is created, so this only has to
 * be a sensible starting point.
 */
export function proposedStart(
  request: { preferredDate: Date | null; preferredWindow: string },
  timeZone: string,
  minNoticeHours: number,
  now: Date = new Date(),
): Date {
  const earliest = ceilToHour(new Date(now.getTime() + minNoticeHours * 60 * 60 * 1000));

  if (!request.preferredDate) return earliest;

  // The date was entered as a calendar day with no zone, and is stored as UTC
  // midnight of that day — so read its calendar parts in UTC.
  const day = request.preferredDate;
  const hour = WINDOW_START_HOUR[isTimeWindow(request.preferredWindow) ? request.preferredWindow : 'FLEXIBLE'];
  const wanted = zonedTimeToUtc(
    day.getUTCFullYear(),
    day.getUTCMonth() + 1,
    day.getUTCDate(),
    hour,
    0,
    timeZone,
  );

  return wanted.getTime() >= now.getTime() ? wanted : earliest;
}

/** "just now", "3 h ago", "2 d ago": how long a request has been waiting. */
export function waitingLabel(since: Date, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60_000));
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/**
 * A number a phone can dial: digits only, with a country code.
 *
 * Ten digits is a US/Canada number typed without the country code, which is how
 * almost every requester will type theirs.
 */
function dialable(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

/** `tel:` link for a phone number typed in any punctuation, or null if it isn't one. */
export function telHref(phone: string | null | undefined): string | null {
  const number = phone ? dialable(phone) : null;
  return number ? `tel:${number}` : null;
}

export function smsHref(phone: string | null | undefined): string | null {
  const number = phone ? dialable(phone) : null;
  return number ? `sms:${number}` : null;
}

/**
 * `mailto:` link for an address a stranger typed. Only a plainly shaped address
 * is linked, so nothing that could smuggle a header (`?cc=…`) or a second
 * recipient into the link ever becomes one.
 */
export function mailtoHref(email: string | null | undefined): string | null {
  if (!email) return null;
  return /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(email)
    ? `mailto:${email}`
    : null;
}

/** The note carried onto the signing, so nothing the requester said is lost. */
export function requestNote(request: {
  service: string;
  documentSummary: string | null;
  signerCount: number;
  preferredContact: string;
  preferredWindow: string;
  message: string | null;
  requesterPhone: string | null;
  requesterEmail: string | null;
}): string {
  const lines: string[] = ['Requested through your public request link.'];

  const service = REQUEST_SERVICE_LABELS[request.service as RequestService];
  if (service) lines.push(`Service: ${service}`);
  if (request.documentSummary) lines.push(`Documents: ${request.documentSummary}`);
  lines.push(`Signers: ${request.signerCount}`);

  const contact = CONTACT_PREFERENCE_LABELS[request.preferredContact as ContactPreference];
  if (contact) lines.push(`Preferred contact: ${contact}`);

  if (request.message) lines.push(`Message: ${request.message}`);
  return lines.join('\n');
}
