import type { Metadata } from "next";
import { SuperAdminShell } from "./super-admin-shell";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SuperAdminShell>{children}</SuperAdminShell>;
}
