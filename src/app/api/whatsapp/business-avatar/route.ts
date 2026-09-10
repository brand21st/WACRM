import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/whatsapp/encryption";
import { getWhatsAppBusinessProfile } from "@/lib/whatsapp/meta-api";

async function resolveBusinessPictureUrl(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.account_id) return null;

  const { data: config } = await supabase
    .from("whatsapp_config")
    .select("phone_number_id, access_token")
    .eq("account_id", profile.account_id)
    .maybeSingle();
  if (!config?.phone_number_id || !config.access_token) return null;

  let accessToken: string;
  try {
    accessToken = decrypt(config.access_token);
  } catch {
    return null;
  }

  const biz = await getWhatsAppBusinessProfile({
    phoneNumberId: config.phone_number_id,
    accessToken,
  });
  return biz.profile_picture_url ?? null;
}

/**
 * GET /api/whatsapp/business-avatar
 *
 * JSON `{ url }` by default. `?proxy=1` streams the image so the
 * header/sidebar `<img>` can load it — Meta's `pps.whatsapp.net` URLs
 * are not reliably embeddable from the browser.
 */
export async function GET(request: Request) {
  try {
    const proxy = new URL(request.url).searchParams.has("proxy");
    const url = await resolveBusinessPictureUrl();

    if (!proxy) {
      return NextResponse.json(
        { url },
        { headers: { "Cache-Control": "private, max-age=300" } },
      );
    }

    if (!url) {
      return new NextResponse(null, { status: 404 });
    }

    const image = await fetch(url);
    if (!image.ok) {
      return new NextResponse(null, { status: 404 });
    }

    return new NextResponse(image.body, {
      status: 200,
      headers: {
        "Content-Type": image.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[whatsapp/business-avatar]", err);
    return NextResponse.json({ url: null }, { status: 200 });
  }
}
