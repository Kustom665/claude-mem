export function formatMoney(
  cents: number | null | undefined,
  currency = "usd",
): string {
  if (cents === null || cents === undefined) return "—";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** Cents to a bare decimal string for editable price inputs. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

/** E.164 to +1 (555) 010-1234 for North American numbers; unchanged otherwise. */
export function formatPhoneNumber(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (!match) return e164;
  return `+1 (${match[1]}) ${match[2]}-${match[3]}`;
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

export function currentMonthLabel(): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date());
}
