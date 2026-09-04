import type { Metadata } from "next";
import { PRODUCT_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Pricing Plans — ${PRODUCT_NAME} WhatsApp CRM & Automation`,
  description:
    "Explore VaChat pricing plans that scale with your Shopify business. Choose your perfect plan from getting started to full automation with AI & voice cloning.",
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
