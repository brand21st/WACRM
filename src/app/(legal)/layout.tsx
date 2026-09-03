import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LANDING_ORIGIN, OG_IMAGE, PRODUCT_NAME } from "@/lib/brand";

// These pages must be publicly crawlable — Meta's go-live form fetches
// Privacy Policy, Terms of Service, and Data deletion URLs without a
// session. Override the root layout's global noindex so the crawler
// sees ordinary public documents.
export const metadata: Metadata = {
  metadataBase: new URL(LANDING_ORIGIN),
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    siteName: PRODUCT_NAME,
    type: "website",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    images: [OG_IMAGE.url],
  },
};

export default function LegalLayout({ children }: { children: ReactNode }) {
  return children;
}
