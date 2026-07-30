import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical, ImageDown, Plus, MapPin, Home, Search, Trash2 } from "lucide-react";

import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ListingFormDialog } from "@/components/listings/ListingFormDialog";
import { CompressAllImagesDialog } from "@/components/listings/CompressAllImagesDialog";
import { CleanupDuplicateImagesDialog } from "@/components/listings/CleanupDuplicateImagesDialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { supabase, type Listing } from "@/lib/supabase";
import { useI18n } from "@/i18n";

const STATUS_BADGE: Record<Listing["status"], "default" | "secondary" | "outline"> = {
  active: "default",
  inactive: "outline",
  maintenance: "secondary",
};

const LISTINGS_SELECT =
  "id,title,description,address,city,country,bedrooms,bathrooms,max_guests,status,cover_image_url,sort_order,created_at,updated_at";

export default function Listings() {
  const { canManage } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [compressOpen, setCompressOpen] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);

  const { data: listings, isLoading, error } = useQuery({
    queryKey: ["listings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listings")
        .select(LISTINGS_SELECT)
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Listing[];
    },
  });

  const filtered = useMemo(() => {
    if (!listings) return [];
    const q = search.trim().toLowerCase();
    return listings.filter((l) => {
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (!q) return true;
      return (
        l.title.toLowerCase().includes(q) ||
        (l.city ?? "").toLowerCase().includes(q) ||
        (l.country ?? "").toLowerCase().includes(q)
      );
    });
  }, [listings, search, statusFilter]);

  // Kéo thả sắp xếp chỉ bật khi đang xem đầy đủ danh sách (không lọc/tìm kiếm),
  // để thứ tự hiển thị luôn khớp với thứ tự thật của toàn bộ bài đăng.
  const canReorder = canManage && !search.trim() && statusFilter === "all";
  const [orderedList, setOrderedList] = useState<Listing[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => {
    setOrderedList(filtered);
  }, [filtered]);

  const reorderMutation = useMutation({
    mutationFn: async (order: Listing[]) => {
      await Promise.all(
        order.map((l, i) =>
          supabase.from("listings").update({ sort_order: i }).eq("id", l.id)
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["listings"] });
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Không thể lưu thứ tự", description: err.message });
      queryClient.invalidateQueries({ queryKey: ["listings"] });
    },
  });

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      return;
    }
    const from = orderedList.findIndex((l) => l.id === dragId);
    const to = orderedList.findIndex((l) => l.id === targetId);
    if (from === -1 || to === -1) {
      setDragId(null);
      return;
    }
    const next = [...orderedList];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOrderedList(next);
    setDragId(null);
    reorderMutation.mutate(next);
  };

  const createMutation = useMutation({
    mutationFn: async (values: Partial<Listing>) => {
      const { data, error } = await supabase
        .from("listings")
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data as Listing;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["listings"] });
      toast({ title: t.listings.created });
      setCreateOpen(false);
    },
    onError: (err: Error) =>
      toast({
        variant: "destructive",
        title: t.listings.couldNotSave,
        description: err.message,
      }),
  });

  return (
    <AppLayout
      title={t.listings.title}
      action={
        canManage ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setCleanupOpen(true)}>
              <Trash2 className="mr-2 h-4 w-4" />
              Dọn ảnh trùng
            </Button>
            <Button variant="outline" onClick={() => setCompressOpen(true)}>
              <ImageDown className="mr-2 h-4 w-4" />
              Nén ảnh gốc
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t.listings.newListing}
            </Button>
          </div>
        ) : null
      }
    >
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.listings.searchPlaceholder}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="sm:w-[180px]">
            <SelectValue placeholder={t.common.status} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.listings.allStatuses}</SelectItem>
            <SelectItem value="active">{t.status.active}</SelectItem>
            <SelectItem value="inactive">{t.status.inactive}</SelectItem>
            <SelectItem value="maintenance">{t.status.maintenance}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.listings.couldNotLoad}</AlertTitle>
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      ) : isLoading ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i} className="overflow-hidden">
              <Skeleton className="h-48 w-full rounded-none" />
              <CardContent className="p-4">
                <Skeleton className="mb-2 h-6 w-3/4" />
                <Skeleton className="mb-4 h-4 w-1/2" />
                <div className="flex justify-between">
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-20" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card p-12">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Home className="h-6 w-6 text-primary" />
          </div>
          <h2 className="mb-2 text-xl font-semibold">{t.listings.noListings}</h2>
          {canManage && (
            <Button onClick={() => setCreateOpen(true)} className="mt-4">
              <Plus className="mr-2 h-4 w-4" />
              {t.listings.newListing}
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {orderedList.map((listing) => (
            <div
              key={listing.id}
              onDragOver={(e) => canReorder && e.preventDefault()}
              onDrop={(e) => {
                if (!canReorder) return;
                e.preventDefault();
                handleDrop(listing.id);
              }}
              className={dragId === listing.id ? "opacity-50" : ""}
            >
              <Link href={`/listings/${listing.id}`}>
                <Card className="relative cursor-pointer overflow-hidden transition-all hover:border-primary/50 hover:shadow-md">
                  {canReorder && (
                    <div
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        setDragId(listing.id);
                      }}
                      onDragEnd={() => setDragId(null)}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      title="Kéo để đổi vị trí"
                      className="absolute left-2 top-2 z-10 flex h-7 w-7 cursor-grab items-center justify-center rounded-md bg-background/90 text-muted-foreground shadow-sm active:cursor-grabbing"
                    >
                      <GripVertical className="h-4 w-4" />
                    </div>
                  )}
                  <div className="relative aspect-video w-full bg-muted">
                    {listing.cover_image_url ? (
                      <img
                        src={listing.cover_image_url}
                        alt={listing.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <Home className="h-8 w-8" />
                      </div>
                    )}
                    <div className="absolute right-2 top-2">
                      <Badge variant={STATUS_BADGE[listing.status]} className="capitalize shadow-sm">
                        {t.status[listing.status]}
                      </Badge>
                    </div>
                  </div>
                  <CardContent className="p-4">
                    <h3 className="mb-2 line-clamp-1 text-lg font-semibold">{listing.title}</h3>
                    <div className="mb-4 flex items-center text-sm text-muted-foreground">
                      <MapPin className="mr-1 h-3.5 w-3.5" />
                      <span className="line-clamp-1">
                        {[listing.city, listing.country].filter(Boolean).join(", ") || "—"}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {listing.bedrooms} {t.listings.bedrooms} · {listing.bathrooms} {t.listings.bathrooms} · {listing.max_guests} {t.listings.maxGuests}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <ListingFormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSubmit={(v) => createMutation.mutate(v)}
          submitting={createMutation.isPending}
        />
      )}

      {canManage && (
        <CompressAllImagesDialog open={compressOpen} onOpenChange={setCompressOpen} />
      )}

      {canManage && (
        <CleanupDuplicateImagesDialog open={cleanupOpen} onOpenChange={setCleanupOpen} />
      )}
    </AppLayout>
  );
}
