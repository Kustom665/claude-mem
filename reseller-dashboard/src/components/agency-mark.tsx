import Image from "next/image";

import { cn } from "@/lib/cn";

/**
 * The agency's logo, falling back to a brand-coloured monogram so the shell
 * never renders a broken or empty box before a logo is uploaded.
 */
export function AgencyMark({
  name,
  logoUrl,
  className,
}: {
  name: string;
  logoUrl: string | null;
  className?: string;
}) {
  if (logoUrl) {
    return (
      <Image
        src={logoUrl}
        alt={`${name} logo`}
        width={160}
        height={160}
        className={cn("size-9 rounded-lg object-contain", className)}
        unoptimized={!logoUrl.startsWith("https://")}
      />
    );
  }

  const initial = name.trim().charAt(0).toUpperCase() || "A";

  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand text-sm font-semibold text-brand-fg",
        className,
      )}
    >
      {initial}
    </span>
  );
}
