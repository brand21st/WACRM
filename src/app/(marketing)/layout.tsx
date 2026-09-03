import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "@/styles/marketing.css";
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from "@/lib/brand";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} — AI WhatsApp Marketing & CRM Platform`,
  description: PRODUCT_DESCRIPTION,
  alternates: {
    canonical: "https://www.vachat.in",
  },
  openGraph: {
    title: `${PRODUCT_NAME} — AI WhatsApp Marketing & CRM Platform`,
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
  return (
    <div className={`${manrope.variable} marketing-page-wrapper`}>
      {children}
    </div>
  );
}
