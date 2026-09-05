"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { AccountAccessAlert } from "@/components/layout/account-access-alert";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import { IncomingMessageAlerts } from "@/components/layout/incoming-message-alerts";
import { CallSessionProvider } from "@/components/calls/call-session-provider";
import { BillingGateHost } from "@/components/billing/billing-gate-host";
import { InboxChromeProvider } from "@/components/inbox/inbox-chrome-context";
import { cn } from "@/lib/utils";

// Desktop icon-rail preference. Device-scoped like the inbox contact
// panel — not written during render so SSR stays expanded.
const SIDEBAR_COLLAPSED_KEY = "wacrm:sidebar:collapsed";

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (stored !== null) setSidebarCollapsed(stored === "true");
    } catch {
      // localStorage can throw in private-browsing / sandboxed contexts.
    }
  }, []);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // Persistence is best-effort; ignore storage failures.
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div
        className="flex h-screen items-center justify-center bg-background"
        suppressHydrationWarning
      >
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          {/* suppressHydrationWarning: this node is the first paint of
              every dashboard load. Browser extensions (and Cursor's
              preview, which stamps data-cursor-ref) can add attributes
              before React hydrates, which Next reports as a mismatch
              even though the spinner text is identical. */}
          <p className="text-sm text-muted-foreground" suppressHydrationWarning>
            Loading...
          </p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <CallSessionProvider>
      <div className="relative flex h-screen overflow-hidden bg-background">
        {/* Reports this tab's online/away presence once we know a user is
            signed in. Headless — renders nothing. */}
        <PresenceHeartbeat />
        <IncomingMessageAlerts />
        <BillingGateHost>
          {({ locked, banner }) => (
            <div
              className={cn(
                "flex min-w-0 flex-1 overflow-hidden",
                locked && "pointer-events-none select-none blur-sm",
              )}
            >
              <Sidebar
                open={sidebarOpen}
                onClose={closeSidebar}
                collapsed={sidebarCollapsed}
                onToggleCollapsed={toggleSidebarCollapsed}
              />
              <div className="flex flex-1 flex-col overflow-hidden">
                <Header onOpenSidebar={() => setSidebarOpen(true)} />
                {banner}
                <main className="flex-1 overflow-y-auto p-4 sm:p-6">
                  <AccountAccessAlert />
                  {children}
                </main>
              </div>
            </div>
          )}
        </BillingGateHost>
      </div>
    </CallSessionProvider>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <InboxChromeProvider>
        <DashboardShellInner>{children}</DashboardShellInner>
      </InboxChromeProvider>
    </AuthProvider>
  );
}
