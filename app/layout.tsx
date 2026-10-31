import type { Metadata } from "next";
import { Cormorant_Garamond, Noto_Naskh_Arabic } from "next/font/google";
import "./globals.css";

const arabicFont = Noto_Naskh_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
});

const displayFont = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Blue Mood | Fashion & More",
  description: "Premium Arabic fashion storefront for Blue Mood with winter collections, offers and product details.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ar" dir="rtl" className={`${arabicFont.variable} ${displayFont.variable} h-full antialiased`}>
      <body className="min-h-full bg-[#f8f3ed] text-[#13233f]">{children}</body>
    </html>
  );
}
