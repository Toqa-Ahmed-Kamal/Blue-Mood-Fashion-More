"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

type PixelWindow = Window & {
  fbq?: (...args: unknown[]) => void;
  __bmPixelLastPath?: string;
};

/**
 * Sends PageView for client-side navigations. The first page view is sent by the
 * base code in app/layout.tsx; the shared last-path marker keeps the two from
 * double-counting (including React Strict Mode's repeated effects in development).
 */
export function MetaPixelPageView() {
  const pathname = usePathname();

  useEffect(() => {
    const pixelWindow = window as PixelWindow;
    // Base code hasn't run yet: it will record this first page itself.
    if (!pixelWindow.fbq || pixelWindow.__bmPixelLastPath === undefined) return;
    if (pixelWindow.__bmPixelLastPath === pathname || pathname.startsWith("/admin")) return;

    pixelWindow.__bmPixelLastPath = pathname;
    pixelWindow.fbq("track", "PageView");
  }, [pathname]);

  return null;
}
