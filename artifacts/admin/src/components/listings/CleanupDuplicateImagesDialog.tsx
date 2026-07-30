import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

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
import { LISTINGS_BUCKET, supabase } from "@/lib/supabase";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DuplicateEntry {
  listingId: string;
  listingTitle: string;
  path: string;
  bytes: number;
  keptPath: string;
}

function stem(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

function formatMB(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(1);
}

export function CleanupDuplicateImagesDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [scanning, setScanning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateEntry[] | null>(null);
  const [deleted, setDeleted] = useState<{ count: number; bytes: number } | null>(null);

  const scan = async () => {
    setScanning(true);
    setDuplicates(null);
    setDeleted(null);

    const [{ data: images, error: e1 }, { data: listings, error: e2 }] = await Promise.all([
      supabase.from("listing_images").select("id,listing_id,storage_path"),
      supabase.from("listings").select("id,title,cover_image_url"),
    ]);

    if (e1 || e2 || !images || !listings) {
      toast({
        variant: "destructive",
        title: "Không quét được kho ảnh",
        description: (e1 ?? e2)?.message,
      });
      setScanning(false);
      return;
    }

    const titleById = new Map(listings.map((l) => [l.id, l.title]));
    const referencedPaths = new Set(images.map((i) => i.storage_path));
    // Defensive: also protect whatever cover_image_url currently points to.
    for (const l of listings as { cover_image_url: string | null }[]) {
      if (!l.cover_image_url) continue;
      const marker = `/object/public/${LISTINGS_BUCKET}/`;
      const idx = l.cover_image_url.indexOf(marker);
      if (idx !== -1) referencedPaths.add(l.cover_image_url.slice(idx + marker.length));
    }

    const listingIds = [...new Set((images as { listing_id: string }[]).map((i) => i.listing_id))];
    const found: DuplicateEntry[] = [];

    for (const listingId of listingIds) {
      const { data: objects, error } = await supabase.storage
        .from(LISTINGS_BUCKET)
        .list(listingId, { limit: 1000 });
      if (error || !objects) continue;

      const referencedInFolder = objects
        .map((o) => `${listingId}/${o.name}`)
        .filter((p) => referencedPaths.has(p));

      for (const obj of objects) {
        const fullPath = `${listingId}/${obj.name}`;
        if (referencedPaths.has(fullPath)) continue; // still in use, never touch

        const orphanStem = stem(obj.name);
        const match = referencedInFolder.find((refPath) => {
          const refName = refPath.slice(listingId.length + 1);
          return stem(refName).endsWith(orphanStem);
        });
        if (!match) continue; // no proven lineage to a current file — leave it alone

        const matchedObj = objects.find((o) => `${listingId}/${o.name}` === match);
        const orphanSize = obj.metadata?.size ?? 0;
        const keptSize = matchedObj?.metadata?.size ?? 0;
        if (orphanSize <= keptSize) continue; // not actually heavier — leave it alone

        found.push({
          listingId,
          listingTitle: titleById.get(listingId) ?? listingId,
          path: fullPath,
          bytes: orphanSize,
          keptPath: match,
        });
      }
    }

    setDuplicates(found);
    setScanning(false);
  };

  const confirmDelete = async () => {
    if (!duplicates || duplicates.length === 0) return;
    setDeleting(true);
    let deletedCount = 0;
    let deletedBytes = 0;
    const chunkSize = 100;
    for (let i = 0; i < duplicates.length; i += chunkSize) {
      const chunk = duplicates.slice(i, i + chunkSize);
      const { error } = await supabase.storage
        .from(LISTINGS_BUCKET)
        .remove(chunk.map((d) => d.path));
      if (!error) {
        deletedCount += chunk.length;
        deletedBytes += chunk.reduce((sum, d) => sum + d.bytes, 0);
      }
    }
    setDeleted({ count: deletedCount, bytes: deletedBytes });
    setDuplicates([]);
    setDeleting(false);
    toast({ title: `Đã xoá ${deletedCount} ảnh trùng nặng hơn` });
    queryClient.invalidateQueries({ queryKey: ["listings"] });
    queryClient.invalidateQueries({ queryKey: ["listing-images"] });
  };

  const totalBytes = duplicates?.reduce((sum, d) => sum + d.bytes, 0) ?? 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !scanning && !deleting && onOpenChange(v)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Dọn ảnh trùng, giữ bản nhẹ nhất</DialogTitle>
          <DialogDescription>
            Chỉ xoá các bản ảnh cũ/nặng hơn mà chắc chắn đã có bản nhẹ hơn đang được dùng thay thế.
            Ảnh đang hiển thị trong app không bao giờ bị đụng tới. Bước quét không xoá gì cả — chỉ
            liệt kê để bạn xem trước.
          </DialogDescription>
        </DialogHeader>

        {!duplicates && !deleted && (
          <p className="text-sm text-muted-foreground">
            Bấm "Quét kho ảnh" để xem có bao nhiêu ảnh trùng nặng hơn đang chiếm dung lượng thừa.
          </p>
        )}

        {duplicates && duplicates.length === 0 && !deleted && (
          <p className="text-sm text-muted-foreground">
            Không tìm thấy ảnh trùng nào có thể xoá an toàn.
          </p>
        )}

        {duplicates && duplicates.length > 0 && (
          <div className="space-y-3">
            <div className="text-sm">
              Tìm thấy <strong>{duplicates.length}</strong> ảnh trùng, nặng hơn bản đang dùng —
              tổng <strong>{formatMB(totalBytes)}MB</strong> có thể giải phóng.
            </div>
            <div className="max-h-48 overflow-y-auto rounded-md border p-2 text-xs">
              {duplicates.map((d, i) => (
                <div key={i} className="flex justify-between gap-2 py-0.5">
                  <span className="truncate text-muted-foreground">
                    {d.listingTitle} — {d.path.split("/").pop()}
                  </span>
                  <span className="shrink-0">{(d.bytes / 1024).toFixed(0)}KB</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {deleted && (
          <div className="text-sm">
            Đã xoá {deleted.count} ảnh trùng, giải phóng {formatMB(deleted.bytes)}MB.
          </div>
        )}

        <DialogFooter>
          {duplicates && duplicates.length > 0 && !deleted ? (
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Xác nhận xoá {duplicates.length} ảnh
            </Button>
          ) : (
            <Button onClick={scan} disabled={scanning}>
              {scanning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Quét kho ảnh
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
