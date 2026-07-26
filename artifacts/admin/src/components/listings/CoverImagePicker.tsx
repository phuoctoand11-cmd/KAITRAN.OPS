import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageIcon, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase, type Listing, type ListingImage } from "@/lib/supabase";

interface Props {
  listing: Listing;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CoverImagePicker({ listing, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: images, isLoading } = useQuery({
    queryKey: ["listing-images", listing.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listing_images")
        .select("*")
        .eq("listing_id", listing.id)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ListingImage[];
    },
    enabled: open,
  });

  const setCoverMutation = useMutation({
    mutationFn: async (img: ListingImage) => {
      const currentCover = images?.find((i) => i.position === 0);
      const oldPosition = img.position;
      const { error: e1 } = await supabase
        .from("listing_images")
        .update({ position: 0 })
        .eq("id", img.id);
      if (e1) throw e1;
      if (currentCover && currentCover.id !== img.id) {
        const { error: e2 } = await supabase
          .from("listing_images")
          .update({ position: oldPosition })
          .eq("id", currentCover.id);
        if (e2) throw e2;
      }
      const { error: e3 } = await supabase
        .from("listings")
        .update({ cover_image_url: img.url })
        .eq("id", listing.id);
      if (e3) throw e3;
    },
    onSuccess: () => {
      toast({ title: "Đã đặt ảnh bìa" });
      queryClient.invalidateQueries({ queryKey: ["listing-images", listing.id] });
      queryClient.invalidateQueries({ queryKey: ["listing", listing.id] });
      queryClient.invalidateQueries({ queryKey: ["listings"] });
      onOpenChange(false);
    },
    onError: (err: Error) =>
      toast({ variant: "destructive", title: "Không thể đặt ảnh bìa", description: err.message }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Đổi ảnh bìa</DialogTitle>
          <DialogDescription>Chọn 1 ảnh trong danh sách đã tải lên để làm ảnh bìa.</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="aspect-square animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : !images || images.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center text-muted-foreground">
            <ImageIcon className="mb-2 h-6 w-6" />
            <p className="text-sm">Chưa có ảnh nào — vào tab Hình ảnh để tải ảnh lên trước.</p>
          </div>
        ) : (
          <div className="grid max-h-[60vh] grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-4">
            {images.map((img) => {
              const isCover = img.position === 0;
              const isSetting =
                setCoverMutation.isPending && setCoverMutation.variables?.id === img.id;
              return (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => !isCover && setCoverMutation.mutate(img)}
                  disabled={isCover || setCoverMutation.isPending}
                  className={`relative aspect-square overflow-hidden rounded-md border ${
                    isCover ? "ring-2 ring-amber-500" : "cursor-pointer hover:opacity-80"
                  }`}
                >
                  <img src={img.url} alt="" className="h-full w-full object-cover" />
                  {isCover && (
                    <div className="absolute inset-x-0 bottom-0 bg-amber-500/90 py-0.5 text-center text-[10px] font-medium text-white">
                      Đang là bìa
                    </div>
                  )}
                  {isSetting && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
