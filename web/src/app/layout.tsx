import type { Metadata, Viewport } from "next";
import "@fontsource-variable/unbounded";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/archivo/wdth.css";
import "./globals.css";
import { Providers } from "./providers";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "Stockpot: the ajo that pays out in stocks",
  description:
    "Save with your people in small amounts. Each round, one member collects the whole pot as real tokenized US stock on Base.",
  openGraph: {
    title: "Stockpot: the ajo that pays out in stocks",
    description: "Rotating savings circles that pay out in NVIDIA, Apple, Tesla and more, on Base.",
  },
};

export const viewport: Viewport = {
  themeColor: "#eef4ff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <SiteHeader />
          <main>{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
