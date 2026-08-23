import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SyncResultItem {
  feed: string;
  platform: string;
  events_found?: number;
  days_blocked?: number;
  error?: string;
}

const PLATFORM_LABEL: Record<string, string> = {
  airbnb: "Airbnb",
  booking: "Booking.com",
  agoda: "Agoda",
  other: "Kênh khác",
};

export function SyncAllCalendarsDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [results, setResults] = useState<SyncResultItem[] | null>(null);
  const [listingByFeed, setListingByFeed] = useState<Map<string, string>>(new Map());

  const run = async () => {
    setSyncing(true);
    setResults(null);

    const [{ data: feeds }, { data: listings }] = await Promise.all([
      supabase.from("listing_ical_feeds").select("id,listing_id,platform").eq("is_active", true),
      supabase.from("listings").select("id,title"),
    ]);
    const titleById = new Map((listings ?? []).map((l) => [l.id, l.title]));
    const feedListing = new Map(
      (feeds ?? []).map((f) => [f.id, titleById.get(f.listing_id) ?? f.listing_id])
    );
    setListingByFeed(feedListing);

    const { data, error } = await supabase.functions.invoke("ical-import");
    setSyncing(false);

    if (error) {
      toast({ variant: "destructive", title: "Đồng bộ thất bại", description: error.message });
      return;
    }

    const synced: SyncResultItem[] = data?.synced ?? [];
    setResults(synced);
    const errCount = synced.filter((s) => s.error).length;
    toast({
      title: errCount > 0 ? `Đồng bộ xong, ${errCount} link lỗi` : "Đã đồng bộ tất cả lịch",
    });
    queryClient.invalidateQueries({ queryKey: ["listing_calendar_all"] });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !syncing && onOpenChange(v)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Đồng bộ tất cả lịch</DialogTitle>
          <DialogDescription>
            Đọc link iCal Airbnb (và các kênh khác đã lưu) của từng bài đăng, cập nhật ngày bận vào
            lịch trống. Chỉ thay các ngày do chính lần đồng bộ trước ghi ra — không đụng ngày bạn
            tự khoá thủ công.
          </DialogDescription>
        </DialogHeader>

        {!results && !syncing && (
          <p className="text-sm text-muted-foreground">
            Bấm "Đồng bộ ngay" để chạy cho toàn bộ bài đăng đã gắn link iCal.
          </p>
        )}

        {results && (
          <div className="max-h-64 space-y-1.5 overflow-y-auto text-sm">
            {results.length === 0 ? (
              <p className="text-muted-foreground">
                Chưa có bài đăng nào gắn link iCal — vào từng bài đăng, tab Lịch để thêm link.
              </p>
            ) : (
              results.map((r, i) => (
                <div key={i} className="flex items-start justify-between gap-3 rounded-md border p-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {listingByFeed.get(r.feed) ?? r.feed} —{" "}
                      {PLATFORM_LABEL[r.platform] ?? r.platform}
                    </div>
                    {r.error ? (
                      <div className="text-xs text-destructive">Lỗi: {r.error}</div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        {r.events_found ?? 0} lượt đặt · {r.days_blocked ?? 0} ngày bận
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        <DialogFooter>
          <Button onClick={run} disabled={syncing}>
            {syncing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {results ? "Đồng bộ lại" : "Đồng bộ ngay"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
