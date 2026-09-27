// Edge Function: ical-import
// Đọc link .ics trong listing_ical_feeds và ĐỒNG BỘ HOÀN TOÀN lịch trống từ hôm nay trở đi:
// mọi ngày bận trên Airbnb/OTA được ghi vào listing_calendar (status="blocked"); các ngày khác
// (kể cả ngày khoá thủ công trong app) bị thay theo lịch OTA. Chỉ ghi khi mọi link của villa đọc OK.
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

  const byListing = new Map<string, NonNullable<typeof feeds>>();
  for (const f of feeds ?? []) {
    const arr = byListing.get(f.listing_id) ?? [];
    arr.push(f);
    byListing.set(f.listing_id, arr);
  }

  const today = new Date().toISOString().slice(0, 10);
  const summary: unknown[] = [];

  for (const [listingId, group] of byListing) {
    // date -> tag của kênh; lịch Airbnb/OTA là nguồn chuẩn cho từ hôm nay trở đi.
    const dateTags = new Map<string, string>();
    const perFeed: { feed: (typeof group)[number]; events: number; days: number; error?: string }[] = [];

    for (const feed of group) {
      try {
        const res = await fetch(feed.import_url, {
          headers: { "User-Agent": "AirbnbOps-iCal/1.0" },
          redirect: "follow",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const events = parseEvents(await res.text());
        let days = 0;
        for (const ev of events) {
          if (!ev.start || !ev.end) continue;
          for (const d of eachDate(ev.start, ev.end)) {
            if (d < today) continue;
            dateTags.set(d, `ical:${feed.platform}`);
            days++;
          }
        }
        perFeed.push({ feed, events: events.length, days });
      } catch (e) {
        perFeed.push({ feed, events: 0, days: 0, error: e instanceof Error ? e.message : String(e) });
      }
    }

    // Chỉ ghi đè khi TẤT CẢ link của villa đọc thành công, tránh xoá nhầm khi lỗi mạng.
    const allOk = perFeed.every((p) => !p.error);
    let writeError: string | undefined;
    if (allOk) {
      const { error: derr } = await supabase
        .from("listing_calendar")
        .delete()
        .eq("listing_id", listingId)
        .gte("date", today);
      if (derr) writeError = derr.message;

      const rows = Array.from(dateTags, ([date, note]) => ({
        listing_id: listingId,
        date,
        status: "blocked",
        note,
      }));
      if (!writeError && rows.length > 0) {
        const { error: ierr } = await supabase
          .from("listing_calendar")
          .upsert(rows, { onConflict: "listing_id,date" });
        if (ierr) writeError = ierr.message;
      }
    }

    for (const p of perFeed) {
      const err = p.error ?? writeError ?? (allOk ? undefined : "Bỏ qua: link khác của villa này bị lỗi");
      await supabase
        .from("listing_ical_feeds")
        .update({ last_synced_at: new Date().toISOString(), last_status: err ?? "ok" })
        .eq("id", p.feed.id);
      summary.push(
        err
          ? { feed: p.feed.id, platform: p.feed.platform, error: err }
          : { feed: p.feed.id, platform: p.feed.platform, events_found: p.events, days_blocked: p.days },
      );
    }
  }

  return new Response(JSON.stringify({ ok: true, synced: summary }, null, 2), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
});
