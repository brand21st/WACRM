"use client";

import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps, ReactNode } from "react";

/**
 * Client wrapper around next-intl's provider.
 *
 * Importing `NextIntlClientProvider` from `next-intl` in a Server
 * Component resolves to an async server wrapper (`NextIntlClientProviderServer`).
 * Next.js 16 / Turbopack can treat that async wrapper as a Client Component
 * (it re-exports the `'use client'` provider), which throws:
 * "An unknown Component is an async Client Component".
 *
 * This module is already a Client Component, so the same import resolves
 * to the sync client provider.
 */
export function IntlProvider({
  locale,
  messages,
  children,
}: {
  locale: string;
  messages: ComponentProps<typeof NextIntlClientProvider>["messages"];
  children: ReactNode;
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
