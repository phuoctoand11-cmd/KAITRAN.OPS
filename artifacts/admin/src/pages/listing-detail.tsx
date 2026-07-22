import { useMemo } from "react";
import { Link, useRoute } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MapPin, Loader2 } from "lucide-react";

import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { supabase, type Listing } from "@/lib/supabase";
import { ListingOverviewTab } from "@/components/listings/ListingOverviewTab";
import { ListingImagesTab } from "@/components/listings/ListingImagesTab";
import { ListingAmenitiesTab } from "@/components/listings/ListingAmenitiesTab";
import { ListingCalendarTab } from "@/components/listings/ListingCalendarTab";

const LISTING_SELECT =
  "id,title,description,address,city,country,bedrooms,bathrooms,max_guests,status,cover_image_url,video_url,image_link_url,created_at,updated_at";

const STATUS_LABELS: Record<Listing["status"], string> = {
  active: "Hoạt động",
  inactive: "Không hoạt động",
  maintenance: "Bảo trì",
};

export default function ListingDetail() {
  const [, params] = useRoute("/listings/:id");
  const id = params?.id;
  const { canManage } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: listing, isLoading, error } = useQuery({
    enabled: !!id,
    queryKey: ["listing", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listings")
        .select(LISTING_SELECT)
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as unknown as Listing;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (values: Partial<Listing>) => {
      const { data, error } = await supabase
        .from("listings")
        .update(values)
        .eq("id", id!)
        .select()
        .single();
      if (error) throw error;
      return data as Listing;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["listing", id] });
      queryClient.invalidateQueries({ queryKey: ["listings"] });
      toast({ title: "Đã cập nhật bài đăng" });
    },
    onError: (err: Error) =>
      toast({
        variant: "destructive",
        title: "Cập nhật thất bại",
        description: err.message,
      }),
  });

  const subtitle = useMemo(() => {
    if (!listing) return "";
    return [listing.city, listing.country].filter(Boolean).join(", ") || "Chưa có vị trí";
  }, [listing]);

  return (
    <AppLayout
      title={listing?.title ?? "Bài đăng"}
      action={
        <Button variant="ghost" asChild>
          <Link href="/listings">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Tất cả bài đăng
          </Link>
        </Button>
      }
    >
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Không tải được bài đăng</AlertTitle>
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      ) : isLoading || !listing ? (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : (
        <>
          <Card className="mb-6 overflow-hidden">
            <div className="grid gap-0 sm:grid-cols-[280px_1fr]">
              <div className="aspect-video bg-muted sm:aspect-auto sm:h-full">
                {listing.cover_image_url ? (
                  <img
                    src={listing.cover_image_url}
                    alt={listing.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    Chưa có ảnh
                  </div>
                )}
              </div>
              <CardContent className="p-6">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-semibold">{listing.title}</h2>
                    <div className="mt-1 flex items-center text-sm text-muted-foreground">
                      <MapPin className="mr-1 h-4 w-4" />
                      {subtitle}
                    </div>
                  </div>
                  <Badge variant={listing.status === "active" ? "default" : "secondary"}>
                    {STATUS_LABELS[listing.status]}
                  </Badge>
                </div>
                <p className="mb-4 text-sm text-muted-foreground">
                  {listing.description ?? "Chưa có mô tả."}
                </p>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <Stat label="Phòng ngủ" value={listing.bedrooms} />
                  <Stat label="Phòng tắm" value={listing.bathrooms} />
                  <Stat label="Số khách tối đa" value={listing.max_guests} />
                </div>
              </CardContent>
            </div>
          </Card>

          <Tabs defaultValue="overview">
            <TabsList className="mb-4 flex flex-wrap">
              <TabsTrigger value="overview">Tổng quan</TabsTrigger>
              <TabsTrigger value="images">Hình ảnh</TabsTrigger>
              <TabsTrigger value="amenities">Tiện nghi</TabsTrigger>
              <TabsTrigger value="calendar">Lịch</TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <ListingOverviewTab
                listing={listing}
                canManage={canManage}
                onSave={(v) => updateMutation.mutate(v)}
                saving={updateMutation.isPending}
              />
            </TabsContent>
            <TabsContent value="images">
              <ListingImagesTab listing={listing} canManage={canManage} />
            </TabsContent>
            <TabsContent value="amenities">
              <ListingAmenitiesTab listing={listing} canManage={canManage} />
            </TabsContent>
            <TabsContent value="calendar">
              <ListingCalendarTab listing={listing} canManage={canManage} />
            </TabsContent>
          </Tabs>

          {updateMutation.isPending && (
            <div className="pointer-events-none fixed bottom-4 right-4 flex items-center gap-2 rounded-md bg-card px-3 py-2 text-sm shadow-md">
              <Loader2 className="h-4 w-4 animate-spin" />
              Đang lưu…
            </div>
          )}
        </>
      )}
    </AppLayout>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-base font-medium text-foreground">{value}</div>
    </div>
  );
}
