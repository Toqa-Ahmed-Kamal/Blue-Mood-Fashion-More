import type { Metadata, Viewport } from "next";
import { Cairo, El_Messiri, Great_Vibes, Playfair_Display } from "next/font/google";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ar" dir="rtl" className={`${cairo.variable} ${messiri.variable} ${playfair.variable} ${greatVibes.variable}`}>
      <body>{children}</body>
    </html>
  );
}
