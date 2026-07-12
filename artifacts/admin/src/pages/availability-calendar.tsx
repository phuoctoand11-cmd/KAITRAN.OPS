import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
  subWeeks,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, LayoutGrid, Loader2, StretchHorizontal, X } from "lucide-react";

import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import {
  supabase,
  type Listing,
  type ListingCalendar,
  type ListingCalStatus,
  LISTING_CAL_STATUSES,
  LISTING_CAL_STATUS_LABELS,
} from "@/lib/supabase";
import { cn } from "@/lib/utils";

type CalendarView = "timeline" | "month" | "week";

const CELL_W = 56; // px per day column (timeline / week)
const ROW_H = 46; // px per villa row (timeline / week)
const SIDEBAR_W = 180; // px for villa name sidebar

const STATUS_SWATCH: Record<ListingCalStatus, string> = {
  available:     "bg-card border border-border",
  blocked:       "bg-gray-700",
  maintenance:   "bg-orange-500",
  owner_stay:    "bg-purple-600",
  cleaning_hold: "bg-amber-400",
};

const STATUS_CELL_BG: Record<ListingCalStatus, string> = {
  available:     "bg-background hover:bg-muted/50",
  blocked:       "bg-gray-700 text-white",
  maintenance:   "bg-orange-500 text-white",
  owner_stay:    "bg-purple-600 text-white",
  cleaning_hold: "bg-amber-400 text-amber-950",
};

const STATUS_BADGE_CLS: Record<ListingCalStatus, string> = {
  available:     "bg-emerald-100 text-emerald-700 border-emerald-200",
  blocked:       "bg-gray-200 text-gray-700 border-gray-300",
  maintenance:   "bg-orange-100 text-orange-700 border-orange-200",
  owner_stay:    "bg-purple-100 text-purple-700 border-purple-200",
  cleaning_hold: "bg-amber-100 text-amber-700 border-amber-200",
};

const LEGEND_ITEMS: { status: ListingCalStatus; label: string }[] = [
  { status: "available",     label: "Trống" },
  { status: "blocked",       label: "Đã khóa" },
  { status: "maintenance",   label: "Bảo trì" },
  { status: "owner_stay",    label: "Chủ nhà ở" },
  { status: "cleaning_hold", label: "Đang dọn" },
];

const PLATFORM_LABEL: Record<string, string> = {
  airbnb: "Airbnb",
  booking: "Booking.com",
  agoda: "Agoda",
  other: "Kênh khác",
};

const SOURCE_OPTIONS = [
  { value: "all", label: "Tất cả nguồn" },
  { value: "airbnb", label: "Airbnb" },
  { value: "booking", label: "Booking.com" },
  { value: "agoda", label: "Agoda" },
  { value: "other", label: "Kênh khác" },
  { value: "manual", label: "Thủ công" },
];

function cellKey(listingId: string, date: string) {
  return `${listingId}:${date}`;
}

/** iCal-synced rows are tagged note="ical:<platform>" — everything else is a manual admin edit. */
function sourceOf(entry: ListingCalendar | undefined): string {
  if (entry?.note?.startsWith("ical:")) return entry.note.slice(5);
  return "manual";
}

function cellLabel(entry: ListingCalendar | undefined, status: ListingCalStatus): string {
  const src = sourceOf(entry);
  if (src !== "manual") return PLATFORM_LABEL[src] ?? src;
  return LISTING_CAL_STATUS_LABELS[status];
}

export default function AvailabilityCalendar() {
  const { canManage } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [view, setView] = useState<CalendarView>("timeline");
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [listingFilter, setListingFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [lastClickedDate, setLastClickedDate] = useState<string | null>(null);

  // ── Visible date range depends on the active view ───────────────────────
  const periodStart = view === "week" ? startOfWeek(cursor, { weekStartsOn: 1 }) : startOfMonth(cursor);
  const periodEnd = view === "week" ? endOfWeek(cursor, { weekStartsOn: 1 }) : endOfMonth(cursor);
  const days = eachDayOfInterval({ start: periodStart, end: periodEnd });

  // Month view always shows a full calendar grid (Mon-first), independent of periodStart/End above.
  const monthGridStart = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
  const monthGridEnd = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
  const monthGridDays = eachDayOfInterval({ start: monthGridStart, end: monthGridEnd });

  const queryRangeStart = view === "month" ? monthGridStart : periodStart;
  const queryRangeEnd = view === "month" ? monthGridEnd : periodEnd;

  const listingsQuery = useQuery({
    queryKey: ["listings-calendar-overview"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listings")
        .select("id,title,status")
        .order("title");
      if (error) throw error;
      return (data ?? []) as Pick<Listing, "id" | "title" | "status">[];
    },
  });

  const calQuery = useQuery({
    queryKey: ["listing_calendar_all", format(queryRangeStart, "yyyy-MM-dd"), format(queryRangeEnd, "yyyy-MM-dd")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listing_calendar")
        .select("id,listing_id,date,status,note")
        .gte("date", format(queryRangeStart, "yyyy-MM-dd"))
        .lte("date", format(queryRangeEnd, "yyyy-MM-dd"));
      if (error) throw error;
      return (data ?? []) as ListingCalendar[];
    },
  });

  const calByKey = useMemo(() => {
    const m = new Map<string, ListingCalendar>();
    (calQuery.data ?? []).forEach((e) => m.set(cellKey(e.listing_id, e.date.slice(0, 10)), e));
    return m;
  }, [calQuery.data]);

  const allListings = listingsQuery.data ?? [];
  const listings = listingFilter === "all" ? allListings : allListings.filter((l) => l.id === listingFilter);

  /** Effective status for a cell — entries that don't match the source filter display as "available". */
  const statusFor = useCallback(
    (listingId: string, ds: string): { status: ListingCalStatus; entry: ListingCalendar | undefined } => {
      const entry = calByKey.get(cellKey(listingId, ds));
      if (!entry) return { status: "available", entry: undefined };
      if (sourceFilter !== "all" && sourceOf(entry) !== sourceFilter) return { status: "available", entry: undefined };
      return { status: entry.status, entry };
    },
    [calByKey, sourceFilter],
  );

  // ── Selection (single villa row at a time) ─────────────────────────────
  const clearSelection = useCallback(() => {
    setSelectedListingId(null);
    setSelectedDates(new Set());
    setLastClickedDate(null);
  }, []);

  useEffect(() => {
    clearSelection();
  }, [cursor, view, listingFilter, clearSelection]);

  function handleDayClick(listingId: string, ds: string, shiftKey: boolean) {
    if (!canManage) return;
    if (selectedListingId && selectedListingId !== listingId) {
      setSelectedListingId(listingId);
      setSelectedDates(new Set([ds]));
      setLastClickedDate(ds);
      return;
    }
    setSelectedListingId(listingId);
    setSelectedDates((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastClickedDate) {
        const a = lastClickedDate < ds ? lastClickedDate : ds;
        const b = lastClickedDate < ds ? ds : lastClickedDate;
        eachDayOfInterval({ start: parseISO(a), end: parseISO(b) }).forEach((d) => {
          next.add(format(d, "yyyy-MM-dd"));
        });
      } else {
        if (next.has(ds)) next.delete(ds);
        else next.add(ds);
      }
      return next;
    });
    setLastClickedDate(ds);
  }

  const bulkMutation = useMutation({
    mutationFn: async (rows: { listing_id: string; date: string; status: ListingCalStatus; note: string | null }[]) => {
      const { error } = await supabase
        .from("listing_calendar")
        .upsert(rows, { onConflict: "listing_id,date" });
      if (error) throw error;
    },
    onSuccess: (_, rows) => {
      toast({ title: `Đã cập nhật ${rows.length} ngày.` });
      qc.invalidateQueries({ queryKey: ["listing_calendar_all"] });
      clearSelection();
    },
    onError: (err: Error) =>
      toast({ variant: "destructive", title: "Không thể lưu lịch", description: err.message }),
  });

  // ── Occupancy (only meaningful once a single villa is picked) ───────────
  const occupancy = useMemo(() => {
    if (listingFilter === "all") return null;
    const listing = allListings.find((l) => l.id === listingFilter);
    if (!listing) return null;
    const busyDays = days.filter((d) => statusFor(listing.id, format(d, "yyyy-MM-dd")).status !== "available").length;
    const pct = days.length > 0 ? Math.round((busyDays / days.length) * 100) : 0;
    return { listing, busyDays, totalDays: days.length, pct };
  }, [listingFilter, allListings, days, statusFor]);

  const isLoading = listingsQuery.isLoading || calQuery.isLoading;
  const queryError = listingsQuery.error || calQuery.error;
  const selectedArray = Array.from(selectedDates).sort();

  const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

  const periodLabel =
    view === "week"
      ? `${format(periodStart, "d MMM")} – ${format(periodEnd, "d MMM yyyy")}`
      : format(cursor, "MMMM yyyy");

  const goPrev = () => setCursor((c) => (view === "week" ? subWeeks(c, 1) : addMonths(c, -1)));
  const goNext = () => setCursor((c) => (view === "week" ? addWeeks(c, 1) : addMonths(c, 1)));

  return (
    <AppLayout title="Lịch trống">
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* View switcher */}
          <div className="flex overflow-hidden rounded-lg border border-border bg-card p-0.5">
            {(
              [
                { key: "timeline" as const, label: "Timeline", icon: StretchHorizontal },
                { key: "month" as const, label: "Tháng", icon: LayoutGrid },
                { key: "week" as const, label: "Tuần", icon: CalendarDays },
              ]
            ).map((v) => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium uppercase tracking-wide transition-colors",
                  view === v.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                <v.icon className="h-3.5 w-3.5" />
                {v.label}
              </button>
            ))}
          </div>

          <Button size="icon" variant="outline" onClick={goPrev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h3 className="min-w-40 text-center text-base font-semibold">{periodLabel}</h3>
          <Button size="icon" variant="outline" onClick={goNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>

          {view !== "week" && (
            <Input
              type="month"
              value={format(cursor, "yyyy-MM")}
              onChange={(e) => {
                if (!e.target.value) return;
                setCursor(startOfMonth(parseISO(`${e.target.value}-01`)));
              }}
              className="h-9 w-[150px]"
              aria-label="Chọn tháng"
            />
          )}

          <Select value={listingFilter} onValueChange={setListingFilter}>
            <SelectTrigger className="h-9 w-[180px]">
              <SelectValue placeholder="Căn hộ" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả villa</SelectItem>
              {allListings.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="h-9 w-[150px]">
              <SelectValue placeholder="Nguồn" />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {LEGEND_ITEMS.map(({ status, label }) => (
            <span key={status} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={cn("h-3 w-3 shrink-0 rounded-sm", STATUS_SWATCH[status])} />
              {label}
            </span>
          ))}
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="h-3 w-3 shrink-0 rounded-sm bg-amber-50 border border-amber-200" />
            Cuối tuần
          </span>
        </div>
      </div>

      {/* ── Occupancy card (single villa selected) ──────────────────────── */}
      {occupancy && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm w-fit">
          <OccupancyRing pct={occupancy.pct} />
          <div>
            <p className="text-[11px] text-muted-foreground truncate max-w-[220px] leading-tight">
              {occupancy.listing.title}
            </p>
            <p className="text-lg font-bold tabular-nums text-foreground leading-tight mt-0.5">
              {occupancy.pct}%
            </p>
            <p className="text-[10px] text-muted-foreground tabular-nums">{occupancy.busyDays} đêm bận</p>
          </div>
        </div>
      )}

      {queryError ? (
        <Alert variant="destructive">
          <AlertTitle>Không tải được lịch</AlertTitle>
          <AlertDescription>{(queryError as Error).message}</AlertDescription>
        </Alert>
      ) : isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : listings.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card p-12 text-center">
          <CalendarDays className="mb-3 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">Chưa có villa nào.</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          {view === "month" ? (
            <MonthGrid
              days={monthGridDays}
              cursor={cursor}
              listings={listings}
              statusFor={statusFor}
              canEdit={canManage && listingFilter !== "all"}
              onDayClick={(ds) => listingFilter !== "all" && handleDayClick(listingFilter, ds, false)}
              selectedListingId={selectedListingId}
              selectedDates={selectedDates}
            />
          ) : (
            <div className="rounded-lg border overflow-hidden shadow-sm">
              <div className="flex">
                {/* Sticky villa sidebar */}
                <div className="sticky left-0 z-20 flex-none border-r bg-background" style={{ width: SIDEBAR_W }}>
                  <div className="flex items-center border-b bg-muted/50 px-3" style={{ height: ROW_H }}>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Căn hộ
                    </span>
                  </div>
                  {listings.map((l) => (
                    <div key={l.id} className="flex items-center border-b px-3 last:border-b-0" style={{ height: ROW_H }}>
                      <p className="truncate text-sm font-medium">{l.title}</p>
                    </div>
                  ))}
                </div>

                {/* Scrollable date grid */}
                <div className="overflow-x-auto flex-1">
                  <div style={{ width: days.length * CELL_W }}>
                    {/* Date header */}
                    <div className="flex border-b bg-card/90" style={{ height: ROW_H }}>
                      {days.map((d) => {
                        const weekend = isWeekend(d);
                        const today = isToday(d);
                        return (
                          <div
                            key={d.toISOString()}
                            className={cn(
                              "flex-none flex flex-col items-center justify-center border-r text-[10px]",
                              weekend && "bg-amber-50/60",
                              today && "bg-blue-50",
                            )}
                            style={{ width: CELL_W }}
                          >
                            <span className="font-semibold leading-none">{format(d, "d")}</span>
                            <span className="mt-0.5 leading-none text-muted-foreground">{format(d, "EEE")}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Villa rows */}
                    {listings.map((l) => (
                      <div key={l.id} className="flex border-b last:border-b-0" style={{ height: ROW_H }}>
                        {days.map((d) => {
                          const ds = format(d, "yyyy-MM-dd");
                          const { status, entry } = statusFor(l.id, ds);
                          const isSelected = selectedListingId === l.id && selectedDates.has(ds);
                          const label = status !== "available" ? cellLabel(entry, status) : "";
                          return (
                            <button
                              key={ds}
                              title={entry?.note ?? LISTING_CAL_STATUS_LABELS[status]}
                              onClick={(e) => handleDayClick(l.id, ds, e.shiftKey)}
                              disabled={!canManage}
                              className={cn(
                                "flex-none flex items-center justify-center border-r last:border-r-0 px-1 text-[10px] font-medium leading-tight transition-colors",
                                STATUS_CELL_BG[status],
                                isWeekend(d) && status === "available" && "bg-amber-50/40",
                                canManage && "cursor-pointer",
                                !canManage && "cursor-default",
                                isSelected && "ring-2 ring-inset ring-primary",
                              )}
                              style={{ width: CELL_W, height: ROW_H }}
                            >
                              <span className="truncate">{label}</span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Right panel ──────────────────────────────────────────── */}
          <div>
            {canManage && selectedListingId && selectedDates.size > 0 ? (
              <BulkEditor
                listingTitle={listings.find((l) => l.id === selectedListingId)?.title ?? ""}
                selectedDates={selectedArray}
                calByKey={calByKey}
                selectedListingId={selectedListingId}
                saving={bulkMutation.isPending}
                onApply={(status, note) => {
                  const rows = selectedArray.map((ds) => ({
                    listing_id: selectedListingId,
                    date: ds,
                    status,
                    note,
                  }));
                  bulkMutation.mutate(rows);
                }}
                onClear={clearSelection}
              />
            ) : (
              <Card className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 text-center">
                <CardContent className="flex flex-col items-center gap-3 p-8">
                  <CalendarDays className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm font-medium text-muted-foreground">
                    {canManage
                      ? view === "month" && listingFilter === "all"
                        ? "Chọn 1 villa ở bộ lọc \"Căn hộ\" để chỉnh lịch tháng"
                        : "Chọn một hoặc nhiều ngày của một villa để chỉnh trạng thái"
                      : "Xem trạng thái trống/bận của từng villa"}
                  </p>
                  {canManage && (
                    <p className="text-xs text-muted-foreground/70">
                      Click vào ô để chọn. Shift+click để chọn khoảng trong cùng villa (Timeline/Tuần).
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </AppLayout>
  );
}

// ── Occupancy ring ──────────────────────────────────────────────────────────
function OccupancyRing({ pct }: { pct: number }) {
  const ringColor =
    pct >= 80 ? "#059669" : pct >= 50 ? "#2563EB" : pct >= 25 ? "#F59E0B" : "#9CA3AF";
  const circumference = 87.96;
  const dash = (pct / 100) * circumference;
  return (
    <div className="w-12 h-12 relative shrink-0">
      <svg viewBox="0 0 36 36" className="rotate-[-90deg] w-full h-full">
        <circle cx="18" cy="18" r="14" fill="none" stroke="currentColor" strokeWidth="3.5" className="text-border" />
        <circle
          cx="18" cy="18" r="14"
          fill="none"
          stroke={ringColor}
          strokeWidth="3.5"
          strokeDasharray={`${dash} ${circumference}`}
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

// ── Month grid (single big calendar, Mon-first) ──────────────────────────────
function MonthGrid({
  days,
  cursor,
  listings,
  statusFor,
  canEdit,
  onDayClick,
  selectedListingId,
  selectedDates,
}: {
  days: Date[];
  cursor: Date;
  listings: Pick<Listing, "id" | "title" | "status">[];
  statusFor: (listingId: string, ds: string) => { status: ListingCalStatus; entry: ListingCalendar | undefined };
  canEdit: boolean;
  onDayClick: (ds: string) => void;
  selectedListingId: string | null;
  selectedDates: Set<string>;
}) {
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  const DAY_NAMES = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

  // When multiple villas are visible, show the "worst" (highest-priority) status per day.
  const PRIORITY: ListingCalStatus[] = ["maintenance", "blocked", "owner_stay", "cleaning_hold"];
  function dominantFor(ds: string) {
    for (const s of PRIORITY) {
      const hit = listings.find((l) => statusFor(l.id, ds).status === s);
      if (hit) return { status: s, entry: statusFor(hit.id, ds).entry };
    }
    return null;
  }

  return (
    <div className="rounded-xl border overflow-hidden shadow-sm">
      <div className="grid grid-cols-7 border-b bg-card/80">
        {DAY_NAMES.map((d, idx) => (
          <div
            key={d}
            className={cn(
              "py-2.5 text-center text-xs font-semibold",
              idx >= 5 ? "text-amber-600/80 bg-amber-50/60" : "text-muted-foreground",
            )}
          >
            {d}
          </div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7">
          {week.map((day, colIdx) => {
            const ds = format(day, "yyyy-MM-dd");
            const inMonth = isSameMonth(day, cursor);
            const today = isToday(day);
            const wknd = colIdx === 5 || colIdx === 6;
            const dominant = dominantFor(ds);
            const isSelected = selectedListingId && selectedDates.has(ds);
            return (
              <button
                key={ds}
                onClick={() => onDayClick(ds)}
                disabled={!canEdit}
                className={cn(
                  "min-h-[76px] border-b border-r p-1.5 last:border-r-0 text-left transition-colors",
                  !inMonth && "bg-muted/20",
                  inMonth && wknd && !today && "bg-amber-50/30",
                  today && "bg-blue-50",
                  canEdit && "cursor-pointer hover:bg-muted/40",
                  !canEdit && "cursor-default",
                  isSelected && "ring-2 ring-inset ring-primary",
                )}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-sm font-medium",
                    today ? "bg-blue-600 text-white font-bold" : !inMonth ? "text-muted-foreground/30 text-xs" : "text-foreground",
                  )}
                >
                  {format(day, "d")}
                </span>
                {dominant && (
                  <p
                    className={cn(
                      "mt-1 truncate rounded px-1 py-0.5 text-[10px] font-medium",
                      STATUS_BADGE_CLS[dominant.status],
                    )}
                  >
                    {cellLabel(dominant.entry, dominant.status)}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── BulkEditor panel ───────────────────────────────────────────────────────
interface BulkEditorProps {
  listingTitle: string;
  selectedDates: string[];
  calByKey: Map<string, ListingCalendar>;
  selectedListingId: string;
  saving: boolean;
  onApply: (status: ListingCalStatus, note: string | null) => void;
  onClear: () => void;
}

function BulkEditor({
  listingTitle,
  selectedDates,
  calByKey,
  selectedListingId,
  saving,
  onApply,
  onClear,
}: BulkEditorProps) {
  const [status, setStatus] = useState<ListingCalStatus>("blocked");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (selectedDates.length === 1) {
      const entry = calByKey.get(cellKey(selectedListingId, selectedDates[0]));
      if (entry) {
        setStatus(entry.status);
        setNote(entry.note ?? "");
      } else {
        setStatus("blocked");
        setNote("");
      }
    }
  }, [selectedDates, calByKey, selectedListingId]);

  const handleApply = () => {
    if (selectedDates.length === 0) return;
    onApply(status, note.trim() !== "" ? note.trim() : null);
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold truncate">{listingTitle}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Đã chọn <span className="text-primary font-medium">{selectedDates.length}</span> ngày —{" "}
              {selectedDates.length <= 3
                ? selectedDates.map((ds) => format(parseISO(ds), "d/M")).join(", ")
                : `${format(parseISO(selectedDates[0]), "d/M")} → ${format(parseISO(selectedDates[selectedDates.length - 1]), "d/M")}`}
            </p>
          </div>
          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onClear}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Trạng thái lịch</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as ListingCalStatus)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LISTING_CAL_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  <span className="flex items-center gap-2">
                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", STATUS_SWATCH[s])} />
                    {LISTING_CAL_STATUS_LABELS[s]}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Ghi chú (tuỳ chọn)</Label>
          <Input
            placeholder="VD: Đặt riêng, bảo trì khẩn…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="h-9 text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Xem trước:</span>
          <Badge variant="outline" className={cn("text-[11px] font-medium", STATUS_BADGE_CLS[status])}>
            {LISTING_CAL_STATUS_LABELS[status]}
          </Badge>
        </div>

        <div className="flex gap-2 pt-1">
          <Button className="flex-1" size="sm" disabled={saving || selectedDates.length === 0} onClick={handleApply}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Áp dụng
          </Button>
          <Button variant="outline" size="sm" onClick={onClear} disabled={saving}>
            Bỏ chọn
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
