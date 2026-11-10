import { IMAGE_ID_PATTERN } from "@/lib/custom-products";
import { loadProductImage } from "@/lib/custom-products-store";

export const runtime = "nodejs";

/**
 * Public photo of an admin-added product. Each upload gets a new ID, so the response never changes
 * and can be cached for a year by browsers and the CDN (one Redis read per photo, not per view).
 */
export async function GET(_request: Request, context: { params: Promise<{ imageId: string }> }) {
  const { imageId } = await context.params;
  if (!IMAGE_ID_PATTERN.test(imageId)) return new Response(null, { status: 404 });
  try {
    const image = await loadProductImage(imageId);
    if (!image) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    return new Response(new Uint8Array(image.data), {
      headers: {
        "Content-Type": image.type,
        "Content-Length": String(image.data.length),
        "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
