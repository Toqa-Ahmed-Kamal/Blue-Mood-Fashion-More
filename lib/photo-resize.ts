// Browser only: shrinks a chosen photo to a JPEG small enough to store with the product.
const MAX_IMAGE_SIDE = 1200;
const MAX_IMAGE_BASE64 = 850_000;

/** Resizes the chosen photo in the browser to a JPEG small enough to store (≤ ~600 KB). */
export async function photoToBase64(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  for (const [side, quality] of [[MAX_IMAGE_SIDE, 0.85], [1000, 0.8], [800, 0.75], [700, 0.7]] as const) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) break;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const base64 = canvas.toDataURL("image/jpeg", quality).split(",")[1] ?? "";
    if (base64.length <= MAX_IMAGE_BASE64) return base64;
  }
  throw new Error("الصورة كبيرة جدًا حتى بعد تصغيرها. جربي صورة تانية.");
}

/**
 * Same, for review screenshots: keeps more pixels on the long side (phone screenshots are tall) and returns
 * the final size too, so the store can lay the photo out before it loads.
 */
export async function reviewPhotoToUpload(file: File): Promise<{ base64: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  for (const [side, quality] of [[1800, 0.82], [1500, 0.8], [1200, 0.78], [1000, 0.72], [800, 0.7]] as const) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) break;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const base64 = canvas.toDataURL("image/jpeg", quality).split(",")[1] ?? "";
    if (base64.length <= MAX_IMAGE_BASE64) return { base64, width: canvas.width, height: canvas.height };
  }
  throw new Error("الصورة كبيرة جدًا حتى بعد تصغيرها. جربي صورة تانية.");
}
