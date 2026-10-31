import { notFound } from "next/navigation";

import { ProductDetailClient } from "@/components/product-detail-client";
import { products } from "@/lib/site-data";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = products.find((item) => item.slug === slug);

  if (!product) {
    notFound();
  }

  return <ProductDetailClient product={product} />;
}
