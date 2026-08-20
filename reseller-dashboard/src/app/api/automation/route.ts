import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { renderAutoReply, smsSenderName } from "@/lib/branding";
import { automationApiSecret } from "@/lib/env";
import { isOpenAt } from "@/lib/hours";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizePhoneNumber } from "@/lib/validation";
import type { Agency, Client } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The seam between this dashboard and the existing Twilio + n8n backend.
 *
 *   GET  ?phone=+15550101234   -> branding, hours and the rendered auto-reply
 *   POST { phone, caller_number, replied? } -> records a captured lead
 *
 * Authenticated with the shared AUTOMATION_API_SECRET, sent as
 * `x-automation-secret`. This is what makes the agency's business name reach
 * the SMS sender name at runtime, and what populates the monthly lead counts.
 */

function authorized(request: NextRequest): boolean {
  const provided = request.headers.get("x-automation-secret");
  if (!provided) return false;

  // Hash first so the comparison is constant-time regardless of input length.
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(automationApiSecret()).digest();
  return timingSafeEqual(a, b);
}

const unauthorized = () =>
  NextResponse.json({ error: "Unauthorized" }, { status: 401 });

type ResolvedClient = { client: Client; agency: Agency };

async function resolveByPhone(phone: string): Promise<ResolvedClient | null> {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized) return null;

  const admin = createSupabaseAdminClient();

  const { data: client } = await admin
    .from("clients")
    .select("*")
    .eq("phone_number", normalized)
    .maybeSingle();

  if (!client) return null;

  const { data: agency } = await admin
    .from("agencies")
    .select("*")
    .eq("id", (client as Client).agency_id)
    .maybeSingle();

  if (!agency) return null;

  return { client: client as Client, agency: agency as Agency };
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return unauthorized();

  const phone = request.nextUrl.searchParams.get("phone");
  if (!phone) {
    return NextResponse.json(
      { error: "Missing `phone` query parameter." },
      { status: 400 },
    );
  }

  const resolved = await resolveByPhone(phone);
  if (!resolved) {
    return NextResponse.json({ error: "No client for that number." }, { status: 404 });
  }

  const { client, agency } = resolved;

  return NextResponse.json({
    client: {
      id: client.id,
      business_name: client.business_name,
      phone_number: client.phone_number,
      status: client.status,
      timezone: client.timezone,
      hours: client.hours,
      open_now: isOpenAt(client.hours, client.timezone),
    },
    branding: {
      agency_name: agency.name,
      sms_sender_name: smsSenderName(agency.name),
      logo_url: agency.logo_url,
      primary_color: agency.primary_color,
    },
    auto_reply: {
      template: client.auto_reply_message,
      message: renderAutoReply(client.auto_reply_message, {
        agencyName: agency.name,
        businessName: client.business_name,
      }),
    },
  });
}

const leadSchema = z.object({
  phone: z.string().min(1),
  caller_number: z.string().trim().min(1),
  replied: z.boolean().optional(),
  captured_at: z.iso.datetime().optional(),
});

export async function POST(request: NextRequest) {
  if (!authorized(request)) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const resolved = await resolveByPhone(parsed.data.phone);
  if (!resolved) {
    return NextResponse.json({ error: "No client for that number." }, { status: 404 });
  }

  const { data, error } = await createSupabaseAdminClient()
    .from("leads")
    .insert({
      client_id: resolved.client.id,
      caller_number:
        normalizePhoneNumber(parsed.data.caller_number) ??
        parsed.data.caller_number.trim(),
      replied: parsed.data.replied ?? false,
      ...(parsed.data.captured_at ? { captured_at: parsed.data.captured_at } : {}),
    })
    .select("id, captured_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ lead: data }, { status: 201 });
}
