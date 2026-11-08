import type { Metadata, Viewport } from "next";
import { Cairo, El_Messiri, Great_Vibes, Playfair_Display } from "next/font/google";
import Script from "next/script";

import { MetaPixelPageView } from "@/components/meta-pixel-page-view";
import "./globals.css";

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
});

const messiri = El_Messiri({
  variable: "--font-messiri",
  subsets: ["arabic", "latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
});

const greatVibes = Great_Vibes({
  variable: "--font-script",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Blue Mood | عبايات، أرواب، بيجامات وبلانكيت",
  description: "Blue Mood — عبايات قطيفة، أرواب فرو، بيجامات شتوي وبلانكيت. عرض الشتاء ٤ قطع بـ ١١٠٠ جنيه والطلب بيتأكد على واتساب.",
  icons: { icon: "/images/blue-mood-logo-badge.png" },
};

export const viewport: Viewport = {
  themeColor: "#fbf6f1",
};

// Pixel IDs are numeric; anything else is ignored so the value can't break the inline script.
const rawPixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() ?? "";
const metaPixelId = /^\d{5,20}$/.test(rawPixelId) ? rawPixelId : null;

// Meta Pixel base code. The __bmPixelInit flag makes init + the first PageView run once per page load.
const metaPixelBaseCode = metaPixelId && `
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
if (!window.__bmPixelInit) {
  window.__bmPixelInit = true;
  fbq('init', ${JSON.stringify(metaPixelId)});
  fbq('track', 'PageView');
  window.__bmPixelLastPath = window.location.pathname;
}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ar" dir="rtl" className={`${cairo.variable} ${messiri.variable} ${playfair.variable} ${greatVibes.variable}`}>
      <body>
        {children}
        {metaPixelBaseCode && (
          <>
            <Script id="meta-pixel-base" strategy="afterInteractive">{metaPixelBaseCode}</Script>
            <noscript>
              {/* eslint-disable-next-line @next/next/no-img-element -- Meta's no-JS tracking pixel must be a plain img */}
              <img height="1" width="1" style={{ display: "none" }} alt="" src={`https://www.facebook.com/tr?id=${metaPixelId}&ev=PageView&noscript=1`} />
            </noscript>
            <MetaPixelPageView />
          </>
        )}
      </body>
    </html>
  );
}
