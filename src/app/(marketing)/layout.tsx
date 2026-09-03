import type { Metadata } from "next";
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: "WhatsApp Business CRM",
  description: PRODUCT_DESCRIPTION,
  alternates: {
    canonical: "https://www.vachat.in",
  },
  openGraph: {
    title: PRODUCT_NAME,
    description: PRODUCT_DESCRIPTION,
    url: "https://www.vachat.in",
    siteName: PRODUCT_NAME,
    type: "website",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
