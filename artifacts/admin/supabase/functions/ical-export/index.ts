// Edge Function: ical-export
// Xuất lịch BẬN của 1 villa (mọi status khác "available" trong listing_calendar) ra file .ics chuẩn
// để Airbnb/Booking/Agoda đọc. Nhận diện villa qua ?token=<ical_export_token>.
// LƯU Ý: phải TẮT "Verify JWT" cho function này (OTA gọi không kèm đăng nhập).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// 'YYYY-MM-DD' -> 'YYYYMMDD'
function fmtDate(d: string): string {
  return d.replaceAll("-", "");
}

function addDays(d: string, n: number): string {
  const dt = new Date(d + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return new Response("Missing token", { status: 400 });

  const { data: listing, error: lerr } = await supabase
    .from("listings")
    .select("id, title")
    .eq("ical_export_token", token)
    .maybeSingle();

  if (lerr || !listing) return new Response("Not found", { status: 404 });

  // Mọi ngày trong listing_calendar không phải "available" = bận (đã khóa, bảo trì, chủ nhà ở, đang dọn...)
  const { data: entries } = await supabase
    .from("listing_calendar")
    .select("id, date, status")
    .eq("listing_id", listing.id)
    .neq("status", "available")
    .order("date");

  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Airbnb Ops//Villa Sync//VI",
    "CALSCALE:GREGORIAN",
  ];

  for (const e of entries ?? []) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:cal-${e.id}@airbnbops`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${fmtDate(e.date)}`,
      `DTEND;VALUE=DATE:${fmtDate(addDays(e.date, 1))}`,
      "SUMMARY:Blocked",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  const body = lines.join("\r\n") + "\r\n";

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="villa-${listing.id}.ics"`,
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
