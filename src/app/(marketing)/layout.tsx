import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "@/styles/marketing.css";
import {
  LANDING_ORIGIN,
  OG_IMAGE,
  PRODUCT_DESCRIPTION,
  PRODUCT_NAME,
} from "@/lib/brand";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

export const metadata: Metadata = {
  metadataBase: new URL(LANDING_ORIGIN),
  title: `${PRODUCT_NAME} — AI WhatsApp Marketing & CRM Platform`,
  description: PRODUCT_DESCRIPTION,
  alternates: {
    canonical: LANDING_ORIGIN,
  },
  openGraph: {
    title: `${PRODUCT_NAME} — AI WhatsApp Marketing & CRM Platform`,
    description: PRODUCT_DESCRIPTION,
    url: LANDING_ORIGIN,
    siteName: PRODUCT_NAME,
    type: "website",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: `${PRODUCT_NAME} — AI WhatsApp Marketing & CRM Platform`,
    description: PRODUCT_DESCRIPTION,
    images: [OG_IMAGE.url],
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
  return (
    <div className={`${manrope.variable} marketing-page-wrapper`}>
      {children}
    </div>
  );
}
