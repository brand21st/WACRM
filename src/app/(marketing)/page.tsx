import Link from "next/link";
import {
  Inbox,
  Megaphone,
  MessageSquare,
  PhoneCall,
  ShoppingBag,
  Workflow,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from "@/lib/brand";
import { APP_ORIGIN } from "@/lib/hosts";

const APP_LOGIN = `${APP_ORIGIN}/login`;

const FEATURES = [
  {
    icon: Inbox,
    title: "Shared inbox",
    body: "One team inbox for every chat. Assign, note, and reply without losing the thread.",
  },
  {
    icon: Megaphone,
    title: "Broadcasts",
    body: "Send approved templates, schedule campaigns, and see what actually delivered.",
  },
  {
    icon: Workflow,
    title: "Automations",
    body: "Route new chats, follow up after hours, and keep the pipeline moving on its own.",
  },
  {
    icon: PhoneCall,
    title: "Calling",
    body: "Take WhatsApp calls in the same workspace — with optional live AI on the line.",
  },
  {
    icon: ShoppingBag,
    title: "Shopify",
    body: "Match products, send catalogs, and follow up on carts from the conversation.",
  },
  {
    icon: MessageSquare,
    title: "One cloud app",
    body: "Sign in at cloud.vachat.in. This site is the public homepage — the CRM lives next door.",
  },
] as const;

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border/80 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#7c3aed]">
              <MessageSquare className="h-4 w-4 text-white" strokeWidth={2.5} />
            </div>
            <span className="text-sm font-semibold tracking-tight">
              {PRODUCT_NAME}
            </span>
          </div>
          <nav className="flex items-center gap-2">
            <Link
              href="/privacy"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              Privacy
            </Link>
            <a href={APP_LOGIN} className={buttonVariants({ size: "sm" })}>
              Open app
            </a>
          </nav>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_oklch(0.45_0.18_290_/_0.28),_transparent_55%)]"
          />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 sm:py-24 lg:grid-cols-[1.1fr_0.9fr] lg:py-28">
            <div>
              <p className="text-sm font-medium text-primary">
                WhatsApp Business CRM
              </p>
              <h1 className="mt-3 max-w-xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
                Customer conversations, without the tab chaos.
              </h1>
              <p className="mt-5 max-w-lg text-base text-muted-foreground text-pretty sm:text-lg">
                {PRODUCT_DESCRIPTION} Teams use Vachat to reply faster, broadcast
                with control, and keep sales in one place.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a href={APP_LOGIN} className={buttonVariants({ size: "lg" })}>
                  Open app
                </a>
                <a
                  href={`${APP_ORIGIN}/signup`}
                  className={buttonVariants({ variant: "outline", size: "lg" })}
                >
                  Create account
                </a>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                App login lives at cloud.vachat.in — not on this page.
              </p>
            </div>

            <div className="rounded-2xl border border-border bg-card p-4 shadow-2xl shadow-black/20">
              <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>Inbox</span>
                <span>cloud.vachat.in</span>
              </div>
              <ul className="space-y-2">
                {[
                  {
                    name: "Priya · order #4821",
                    preview: "Can I change the delivery date?",
                    time: "2m",
                  },
                  {
                    name: "Ahmed · new lead",
                    preview: "What’s included in the pro plan?",
                    time: "14m",
                  },
                  {
                    name: "Store broadcast",
                    preview: "Festival sale — 1,204 delivered",
                    time: "1h",
                  },
                ].map((row) => (
                  <li
                    key={row.name}
                    className="rounded-xl border border-border bg-background px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium">{row.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {row.time}
                      </p>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {row.preview}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
            <h2 className="text-2xl font-semibold tracking-tight">
              Built for the conversations that close.
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Inbox, campaigns, automations, calling, and Shopify — in one
              cloud workspace.
            </p>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <li
                  key={title}
                  className="rounded-xl border border-border bg-card p-5"
                >
                  <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <h3 className="text-sm font-medium">{title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {PRODUCT_NAME} · operated by Samanga
          </p>
          <nav className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <a href={APP_LOGIN} className="hover:text-foreground">
              Open app
            </a>
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link href="/data-deletion" className="hover:text-foreground">
              Data deletion
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
