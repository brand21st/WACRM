/** Public product name shown in the UI, browser title, and legal pages. */
export const PRODUCT_NAME = "Vachat.in";

export const PRODUCT_DESCRIPTION =
  "WhatsApp Business CRM for customer conversations, broadcasts, and automations.";

/** Canonical public origin used in Open Graph tags on the landing host. */
export const LANDING_ORIGIN = "https://www.vachat.in";

/** 1200×630 share image. Meta requires an explicit og:image URL. */
export const OG_IMAGE_URL = `${LANDING_ORIGIN}/og-image.png`;

export const OG_IMAGE = {
  url: OG_IMAGE_URL,
  width: 1200,
  height: 630,
  alt: PRODUCT_NAME,
};
