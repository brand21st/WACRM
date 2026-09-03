/** Canonical CRM origin. Landing hosts stay on vachat.in / www. */
export const APP_HOST = "cloud.vachat.in";
export const WWW_APP_HOST = "www.cloud.vachat.in";
export const APP_ORIGIN = "https://cloud.vachat.in";

const LANDING_HOSTS = new Set(["vachat.in", "www.vachat.in"]);
const APP_HOSTS = new Set([APP_HOST, WWW_APP_HOST]);

/** Merchant + Super Admin + auth surfaces that belong on the app host. */
const CRM_PATH_PREFIXES = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/join",
  "/auth",
  "/dashboard",
  "/inbox",
  "/contacts",
  "/pipelines",
  "/broadcasts",
  "/automations",
  "/settings",
  "/calling",
  "/flows",
  "/agents",
  "/notifications",
  "/super-admin",
] as const;

export function normalizeHost(host: string | null | undefined): string {
  if (!host) return "";
  return host.split(":")[0]?.trim().toLowerCase() ?? "";
}

export function isLandingHost(host: string | null | undefined): boolean {
  return LANDING_HOSTS.has(normalizeHost(host));
}

export function isAppHost(host: string | null | undefined): boolean {
  return APP_HOSTS.has(normalizeHost(host));
}

export function isWwwAppHost(host: string | null | undefined): boolean {
  return normalizeHost(host) === WWW_APP_HOST;
}

export function isCrmPath(pathname: string): boolean {
  return CRM_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Invite links, Shopify OAuth, and the Open-app CTA use this origin. */
export function appOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  return fromEnv || APP_ORIGIN;
}
