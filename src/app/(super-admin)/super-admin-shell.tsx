"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { LayoutDashboard, LogOut, Package, Sparkles, Users } from "lucide-react";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const NAV: Array<{
  href: string
  labelKey: "overview" | "accounts" | "ai" | "packages"
  icon: typeof LayoutDashboard
  exact?: boolean
}> = [
  { href: "/super-admin", labelKey: "overview", icon: LayoutDashboard, exact: true },
  { href: "/super-admin/accounts", labelKey: "accounts", icon: Users },
  { href: "/super-admin/ai", labelKey: "ai", icon: Sparkles },
  { href: "/super-admin/packages", labelKey: "packages", icon: Package },
];

interface NavPackage {
  id: string;
  name: string;
  isActive: boolean;
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("SuperAdmin");
  const [packages, setPackages] = useState<NavPackage[]>([]);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    function refresh() {
      void fetch("/api/super-admin/billing/packages")
        .then((r) => r.json())
        .then((data) => setPackages(data.packages ?? []))
        .catch(() => setPackages([]));
    }
    refresh();
    window.addEventListener("super-admin:packages-changed", refresh);
    return () => window.removeEventListener("super-admin:packages-changed", refresh);
  }, [user, pathname]);

  if (loading || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="flex w-60 flex-col border-r border-border bg-card">
        <div className="border-b border-border px-4 py-4">
          <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            {t("title")}
          </p>
          <p className="mt-1 truncate text-sm text-foreground">{user.email}</p>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {NAV.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href) ||
                (item.href === "/super-admin/packages" &&
                  pathname.startsWith("/super-admin/billing"));
            const Icon = item.icon;
            return (
              <div key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {t(`nav.${item.labelKey}`)}
                </Link>
                {item.href === "/super-admin/packages" && packages.length > 0 ? (
                  <div className="mt-0.5 ml-4 flex flex-col gap-0.5 border-l border-border pl-2">
                    {packages.map((pkg) => (
                      <Link
                        key={pkg.id}
                        href={`/super-admin/packages#pkg-${pkg.id}`}
                        className={cn(
                          "truncate rounded-md px-2 py-1.5 text-xs",
                          pkg.isActive
                            ? "text-muted-foreground hover:bg-muted hover:text-foreground"
                            : "text-muted-foreground/60 hover:bg-muted hover:text-foreground",
                        )}
                      >
                        {pkg.name}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
        <div className="border-t border-border p-2">
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={() => void signOut().then(() => router.push("/login"))}
          >
            <LogOut className="mr-2 h-4 w-4" />
            {t("signOut")}
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}

export function SuperAdminShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ShellInner>{children}</ShellInner>
    </AuthProvider>
  );
}
