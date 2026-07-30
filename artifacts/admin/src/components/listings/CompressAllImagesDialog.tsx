import { useState } from "react";
import { Loader2 } from "lucide-react";

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

interface ImageRow {
  id: string;
  listing_id: string;
  url: string;
  storage_path: string;
}

interface Stats {
  total: number;
  done: number;
  skipped: number;
  failed: number;
  originalBytes: number;
  newBytes: number;
  errors: string[];
}

const CONCURRENCY = 4;
const JPEG_QUALITY = 0.8;

function formatMB(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(1);
}

export function CompressAllImagesDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);

  const run = async () => {
    setRunning(true);
    setStats(null);

    const [{ data: images, error: e1 }, { data: listings, error: e2 }] = await Promise.all([
      supabase.from("listing_images").select("id,listing_id,url,storage_path"),
      supabase.from("listings").select("id,cover_image_url"),
    ]);

    if (e1 || e2 || !images || !listings) {
      toast({
        variant: "destructive",
        title: "Không tải được danh sách ảnh",
        description: (e1 ?? e2)?.message,
      });
      setRunning(false);
      return;
    }

    const coverMap = new Map<string, string[]>();
    for (const l of listings as { id: string; cover_image_url: string | null }[]) {
      if (!l.cover_image_url) continue;
      const arr = coverMap.get(l.cover_image_url) ?? [];
      arr.push(l.id);
      coverMap.set(l.cover_image_url, arr);
    }

    const s: Stats = {
      total: images.length,
      done: 0,
      skipped: 0,
      failed: 0,
      originalBytes: 0,
      newBytes: 0,
      errors: [],
    };
    setStats({ ...s });

    const processOne = async (img: ImageRow) => {
      try {
        const origRes = await fetch(img.url);
        if (!origRes.ok) throw new Error(`tải ảnh gốc lỗi (${origRes.status})`);
        const origBlob = await origRes.blob();

        const bitmap = await createImageBitmap(origBlob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("không tạo được canvas");
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();

        const newBlob: Blob | null = await new Promise((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
        );
        if (!newBlob || newBlob.size >= origBlob.size) {
          s.skipped++;
          return;
        }

        const dir = img.storage_path.substring(0, img.storage_path.lastIndexOf("/"));
        const base = img.storage_path
          .substring(img.storage_path.lastIndexOf("/") + 1)
          .replace(/\.[^.]+$/, "");
        const newPath = `${dir}/${crypto.randomUUID()}-${base}.jpg`;

        const { error: upErr } = await supabase.storage
          .from(LISTINGS_BUCKET)
          .upload(newPath, newBlob, { upsert: false, contentType: "image/jpeg" });
        if (upErr) throw upErr;

        const { data: pub } = supabase.storage.from(LISTINGS_BUCKET).getPublicUrl(newPath);
        const newUrl = pub.publicUrl;

        const { error: dbErr } = await supabase
          .from("listing_images")
          .update({ url: newUrl, storage_path: newPath })
          .eq("id", img.id);
        if (dbErr) throw dbErr;

        if (coverMap.has(img.url)) {
          for (const listingId of coverMap.get(img.url)!) {
            await supabase.from("listings").update({ cover_image_url: newUrl }).eq("id", listingId);
          }
        }

        s.originalBytes += origBlob.size;
        s.newBytes += newBlob.size;
      } catch (err) {
        s.failed++;
        s.errors.push(`${img.storage_path}: ${(err as Error).message}`);
      } finally {
        s.done++;
        setStats({ ...s });
      }
    };

    const queue = images as ImageRow[];
    let idx = 0;
    const worker = async () => {
      while (idx < queue.length) {
        const my = queue[idx++];
        await processOne(my);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    setRunning(false);
    queryClient.invalidateQueries({ queryKey: ["listings"] });
    queryClient.invalidateQueries({ queryKey: ["listing-images"] });
    toast({ title: "Đã xử lý xong toàn bộ ảnh" });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !running && onOpenChange(v)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nén ảnh gốc để giảm dung lượng</DialogTitle>
          <DialogDescription>
            Giữ nguyên kích thước/độ phân giải ảnh, chỉ nén lại để giảm dung lượng file. Ảnh gốc
            được giữ nguyên trong kho lưu trữ, không xoá — chỉ tải thêm bản nhẹ hơn và cập nhật
            đường dẫn hiển thị.
          </DialogDescription>
        </DialogHeader>

        {!stats && !running && (
          <p className="text-sm text-muted-foreground">
            Thao tác này sẽ xử lý toàn bộ ảnh của tất cả bài đăng. Có thể mất vài phút tuỳ số
            lượng ảnh.
          </p>
        )}

        {stats && (
          <div className="space-y-3">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${stats.total ? (stats.done / stats.total) * 100 : 0}%` }}
              />
            </div>
            <div className="text-sm text-muted-foreground">
              Đã xử lý {stats.done}/{stats.total} — nén thành công{" "}
              {stats.done - stats.skipped - stats.failed}, bỏ qua (không nhẹ hơn) {stats.skipped},
              lỗi {stats.failed}
            </div>
            {stats.originalBytes > 0 && (
              <div className="text-sm">
                Dung lượng: {formatMB(stats.originalBytes)}MB → {formatMB(stats.newBytes)}MB (giảm{" "}
                {Math.round((1 - stats.newBytes / stats.originalBytes) * 100)}%)
              </div>
            )}
            {stats.errors.length > 0 && (
              <div className="max-h-32 overflow-y-auto rounded-md border bg-muted/50 p-2 text-xs text-destructive">
                {stats.errors.slice(0, 20).map((e, i) => (
                  <div key={i}>{e}</div>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {!running && (!stats || stats.done === stats.total) ? (
            <Button onClick={run}>{stats ? "Chạy lại" : "Bắt đầu nén"}</Button>
          ) : (
            <Button disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Đang xử lý…
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
