import type { CSSProperties } from "react";

export const DEFAULT_PRIMARY_COLOR = "#4f46e5";

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Accepts `abc`, `#abc`, `aabbcc`, `#AABBCC`; returns `#aabbcc` or null. */
export function normalizeHexColor(input: string | null | undefined): string | null {
  if (!input) return null;
  const match = HEX_RE.exec(input.trim());
  if (!match) return null;

  const digits = match[1].toLowerCase();
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((d) => d + d)
          .join("")
      : digits;

  return `#${full}`;
}

type Rgb = { r: number; g: number; b: number };

function toRgb(hex: string): Rgb {
  const normalized = normalizeHexColor(hex) ?? DEFAULT_PRIMARY_COLOR;
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const clamp = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

/** Straight sRGB interpolation — plenty for hover and tint shades. */
function mix(hex: string, target: Rgb, amount: number): string {
  const base = toRgb(hex);
  return toHex({
    r: base.r + (target.r - base.r) * amount,
    g: base.g + (target.g - base.g) * amount,
    b: base.b + (target.b - base.b) * amount,
  });
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

function relativeLuminance(hex: string): number {
  const { r, g, b } = toRgb(hex);
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (light + 0.05) / (dark + 0.05);
}

const LIGHT_FOREGROUND = "#ffffff";
const DARK_FOREGROUND = "#0f172a";

/** Whichever of white / near-black is more readable on the brand color. */
export function readableForeground(hex: string): string {
  return contrastRatio(hex, LIGHT_FOREGROUND) >=
    contrastRatio(hex, DARK_FOREGROUND)
    ? LIGHT_FOREGROUND
    : DARK_FOREGROUND;
}

/**
 * CSS custom properties for the agency's brand color, applied as an inline
 * style on the dashboard shell. `@theme inline` in globals.css maps these onto
 * Tailwind utilities (`bg-brand`, `text-brand-fg`, `border-brand-ring`, ...),
 * so the whole dashboard re-themes from one database column.
 */
export function brandStyle(color: string | null | undefined): CSSProperties {
  const brand = normalizeHexColor(color) ?? DEFAULT_PRIMARY_COLOR;

  return {
    "--brand": brand,
    "--brand-fg": readableForeground(brand),
    "--brand-hover": mix(brand, BLACK, 0.14),
    "--brand-active": mix(brand, BLACK, 0.26),
    "--brand-soft": mix(brand, WHITE, 0.9),
    "--brand-soft-fg": mix(brand, BLACK, 0.45),
    "--brand-ring": mix(brand, WHITE, 0.55),
  } as CSSProperties;
}

/**
 * The name the missed-call text-back sends as. Collapses whitespace and drops
 * characters that tend to force a UCS-2 (70 character) SMS segment.
 */
export function smsSenderName(agencyName: string): string {
  const cleaned = agencyName
    .replace(/[^\p{L}\p{N} &'._-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

  return (cleaned || "Your Team").slice(0, 32);
}

export type AutoReplyContext = {
  agencyName: string;
  businessName: string;
};

type Placeholder = "business_name" | "agency_name" | "sender";

/**
 * Substitutes `{{business_name}}`, `{{agency_name}}` and `{{sender}}` into an
 * auto-reply template. This is what makes the branding "runtime": the same
 * stored message renders with whatever the agency's business name is now.
 */
export function renderAutoReply(
  template: string,
  { agencyName, businessName }: AutoReplyContext,
): string {
  const values: Record<Placeholder, string> = {
    business_name: businessName,
    agency_name: agencyName,
    sender: smsSenderName(agencyName),
  };

  return template.replace(
    /\{\{\s*(business_name|agency_name|sender)\s*\}\}/gi,
    (_match, key: string) => values[key.toLowerCase() as Placeholder],
  );
}
