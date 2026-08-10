import { supabaseUrl } from "@/lib/env";

export const LOGO_BUCKET = "agency-logos";
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];

function publicPrefix(): string {
  return `${supabaseUrl().replace(/\/$/, "")}/storage/v1/object/public/${LOGO_BUCKET}/`;
}

/** `.../agency-logos/<agencyId>/logo-123.png` -> `<agencyId>/logo-123.png`. */
export function logoPathFromPublicUrl(url: string | null): string | null {
  if (!url) return null;

  const prefix = publicPrefix();
  if (!url.startsWith(prefix)) return null;

  const path = decodeURIComponent(url.slice(prefix.length)).split("?")[0];
  return path === "" ? null : path;
}

/**
 * Storage RLS already scopes writes to the agency's own folder; this repeats
 * the check on the value the form submits so a hand-edited hidden input cannot
 * point the logo at somebody else's object.
 */
export function isOwnLogoUrl(url: string, agencyId: string): boolean {
  const path = logoPathFromPublicUrl(url);
  return path !== null && path.startsWith(`${agencyId}/`);
}

export function logoObjectPath(agencyId: string, fileName: string): string {
  const extension = /\.(png|jpe?g|webp)$/i.exec(fileName)?.[1].toLowerCase() ?? "png";
  return `${agencyId}/logo-${Date.now()}.${extension === "jpg" ? "jpeg" : extension}`;
}
