// Edge Function: ical-import
// Đọc link .ics đã lưu trong listing_ical_feeds, lấy ngày bận, ghi vào listing_calendar (status="blocked").
// Mỗi feed: xóa các ngày do chính feed này ghi lần trước (nhận diện qua note="ical:<platform>"),
// rồi ghi lại theo lịch mới nhất. Không đụng tới ngày admin tự set thủ công.
// GIỮ "Verify JWT" BẬT cho function này (gọi từ trong app, có đăng nhập).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const PLATFORM_LABEL: Record<string, string> = {
  airbnb: "Airbnb",
  booking: "Booking.com",
  agoda: "Agoda",
  other: "Kênh khác",
};

// lấy 'YYYY-MM-DD' từ một dòng iCal chứa YYYYMMDD
function icalDate(line: string): string {
  const m = line.match(/(\d{8})/);
  if (!m) return "";
  const s = m[1];
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function addDays(d: string, n: number): string {
  const dt = new Date(d + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// Tách các khoảng ngày bận từ nội dung .ics
function parseEvents(ics: string): { start: string; end: string }[] {
  const text = ics.replace(/\r?\n[ \t]/g, "");
  const lines = text.split(/\r?\n/);
  const events: { start: string; end: string }[] = [];
  let cur: { start?: string; end?: string } | null = null;

  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) {
      cur = {};
    } else if (line.startsWith("END:VEVENT")) {
      if (cur?.start) {
        const end = cur.end ?? addDays(cur.start, 1);
        events.push({ start: cur.start, end });
      }
      cur = null;
    } else if (cur) {
      if (line.startsWith("DTSTART")) cur.start = icalDate(line);
      else if (line.startsWith("DTEND")) cur.end = icalDate(line);
    }
  }
  return events;
}

// Liệt kê từng ngày trong [start, end) — end là ngày trả phòng, không tính vào.
function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  let d = start;
  while (d < end) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const { data: feeds, error: ferr } = await supabase
    .from("listing_ical_feeds")
    .select("id, listing_id, platform, import_url")
    .eq("is_active", true);

  if (ferr) {
    return new Response(JSON.stringify({ error: ferr.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const summary: unknown[] = [];

  for (const feed of feeds ?? []) {
    const tag = `ical:${feed.platform}`;
    try {
      const res = await fetch(feed.import_url, {
        headers: { "User-Agent": "AirbnbOps-iCal/1.0" },
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ics = await res.text();
      const events = parseEvents(ics);

      // Xóa các ngày do chính feed này ghi lần trước — không đụng ngày admin tự set thủ công.
      await supabase
        .from("listing_calendar")
        .delete()
        .eq("listing_id", feed.listing_id)
        .eq("note", tag);

      const dateSet = new Set<string>();
      for (const ev of events) {
        if (!ev.start || !ev.end) continue;
        for (const d of eachDate(ev.start, ev.end)) dateSet.add(d);
      }

      const rows = Array.from(dateSet).map((date) => ({
        listing_id: feed.listing_id,
        date,
        status: "blocked",
        note: tag,
      }));

      if (rows.length > 0) {
        const { error: ierr } = await supabase
          .from("listing_calendar")
          .upsert(rows, { onConflict: "listing_id,date" });
        if (ierr) throw new Error(ierr.message);
      }

      await supabase
        .from("listing_ical_feeds")
        .update({ last_synced_at: new Date().toISOString(), last_status: "ok" })
        .eq("id", feed.id);

      summary.push({
        feed: feed.id,
        platform: feed.platform,
        events_found: events.length,
        days_blocked: rows.length,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase
        .from("listing_ical_feeds")
        .update({ last_synced_at: new Date().toISOString(), last_status: msg })
        .eq("id", feed.id);
      summary.push({ feed: feed.id, platform: feed.platform, error: msg });
    }
  }

  return new Response(JSON.stringify({ ok: true, synced: summary }, null, 2), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
});
