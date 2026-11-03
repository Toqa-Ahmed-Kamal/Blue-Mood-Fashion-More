import type { Metadata } from "next";

import { Checkout } from "@/components/checkout";

export const metadata: Metadata = {
  title: "إتمام الطلب | Blue Mood",
};

export default function CheckoutPage() {
  return <Checkout />;
}
