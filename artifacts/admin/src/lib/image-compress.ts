const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 0.82;
const SKIP_IF_UNDER_BYTES = 800_000;

const UNSUPPORTED_TYPES = new Set(["image/svg+xml", "image/gif"]);

/**
 * Resizes/re-encodes an image file client-side before upload. Falls back to
 * returning the original file untouched on any error or when compression
 * wouldn't actually shrink it (never blocks or corrupts the upload).
 */
export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || UNSUPPORTED_TYPES.has(file.type)) {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));

    if (scale === 1 && file.size < SKIP_IF_UNDER_BYTES) {
      bitmap.close();
      return file;
    }

    const targetWidth = Math.round(bitmap.width * scale);
    const targetHeight = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    );
    if (!blob || blob.size >= file.size) {
      return file;
    }

    const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], newName, { type: "image/jpeg" });
  } catch {
    return file;
  }
}
