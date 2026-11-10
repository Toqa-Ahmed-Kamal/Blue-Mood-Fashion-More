"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { captureAttribution } from "@/lib/attribution-store";
import { trackPageView } from "@/lib/journey-tracker";

/** Records UTM / click-ID / referrer attribution for each visit and each page in the journey. Renders nothing. */
export function AttributionCapture() {
  const pathname = usePathname();

  useEffect(() => {
    // The owner's dashboard is not store traffic.
    if (pathname.startsWith("/admin")) return;
    captureAttribution();
    // Every store page the shopper opens is a journey step (sent after the visit itself).
    trackPageView(pathname);
  }, [pathname]);

  return null;
}
