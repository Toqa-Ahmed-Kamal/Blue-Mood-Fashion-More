"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { captureAttribution } from "@/lib/attribution-store";

/** Records UTM / click-ID / referrer attribution for each visit. Renders nothing. */
export function AttributionCapture() {
  const pathname = usePathname();

  useEffect(() => {
    captureAttribution();
  }, [pathname]);

  return null;
}
