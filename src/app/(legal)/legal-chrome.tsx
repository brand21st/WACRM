import Link from "next/link";
import { MessageSquare } from "lucide-react";
import type { ReactNode } from "react";
import { PRODUCT_NAME } from "@/lib/brand";

export const LEGAL_OPERATOR = "Samanga";
export const LEGAL_APP = PRODUCT_NAME;
export const LEGAL_CONTACT_EMAIL = "tuttusky@gmail.com";
export const LEGAL_UPDATED = "1 September 2026";

const NAV = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
  { href: "/data-deletion", label: "Data deletion" },
] as const;

export function LegalChrome({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <MessageSquare className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium">{LEGAL_APP}</p>
            <p className="text-xs text-muted-foreground">{LEGAL_OPERATOR}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Last updated {LEGAL_UPDATED}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-muted-foreground">{description}</p>
        <div className="mt-8 space-y-6 text-sm leading-6 [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2">
          {children}
        </div>
      </main>

      <footer className="border-t border-border">
        <nav className="mx-auto flex max-w-3xl flex-wrap gap-x-5 gap-y-2 px-6 py-5 text-sm text-muted-foreground">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="hover:text-foreground">
              {item.label}
            </Link>
          ))}
          <a
            href={`mailto:${LEGAL_CONTACT_EMAIL}`}
            className="hover:text-foreground"
          >
            {LEGAL_CONTACT_EMAIL}
          </a>
        </nav>
      </footer>
    </div>
  );
}
