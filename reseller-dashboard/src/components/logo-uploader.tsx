"use client";

import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui";
import {
  ALLOWED_LOGO_TYPES,
  LOGO_BUCKET,
  MAX_LOGO_BYTES,
  logoObjectPath,
} from "@/lib/logo-storage";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Uploads straight from the browser to Supabase Storage, then hands the public
 * URL to the branding form as a hidden field. Keeping the bytes out of the
 * server action avoids the request body limit on Vercel.
 */
export function LogoUploader({
  agencyId,
  value,
  onChange,
  name,
}: {
  agencyId: string;
  value: string;
  onChange: (url: string) => void;
  name: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, startUpload] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleFile(file: File) {
    setError(null);

    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      setError("Use a PNG, JPEG or WebP image.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError("That image is larger than 2 MB.");
      return;
    }

    startUpload(async () => {
      const supabase = createSupabaseBrowserClient();
      const path = logoObjectPath(agencyId, file.name);

      const { error: uploadError } = await supabase.storage
        .from(LOGO_BUCKET)
        .upload(path, file, { cacheControl: "3600", upsert: true });

      if (uploadError) {
        setError(uploadError.message);
        return;
      }

      const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
      onChange(data.publicUrl);
    });
  }

  return (
    <div>
      <input type="hidden" name={name} value={value} />

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex size-16 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          {value ? (
            // Not next/image: this URL changes on every upload and needs no
            // optimisation for a 64px preview.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt="Current logo"
              className="size-full object-contain"
            />
          ) : (
            <span className="text-xs text-slate-400">No logo</span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? "Uploading…" : value ? "Replace logo" : "Upload logo"}
          </Button>

          {value ? (
            <Button
              type="button"
              variant="ghost"
              disabled={uploading}
              onClick={() => {
                onChange("");
                setError(null);
              }}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_LOGO_TYPES.join(",")}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleFile(file);
          // Allow re-picking the same file after a failure.
          event.target.value = "";
        }}
      />

      <p className="mt-2 text-sm text-slate-500">
        PNG, JPEG or WebP, up to 2 MB.
      </p>
      {error ? <p className="mt-1 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
