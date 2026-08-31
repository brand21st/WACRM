import type { Metadata } from "next";
import type { ReactNode } from "react";

// These pages must be publicly crawlable — Meta's go-live form fetches
// Privacy Policy, Terms of Service, and Data deletion URLs without a
// session. Override the root layout's global noindex so the crawler
// sees ordinary public documents.
export const metadata: Metadata = {
  robots: {
    index: true,
    follow: true,
  },
};

export default function LegalLayout({ children }: { children: ReactNode }) {
  return children;
}
