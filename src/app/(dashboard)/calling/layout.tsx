import type { ReactNode } from "react";
import { CallingNav } from "@/components/calling/calling-nav";

export default function CallingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <CallingNav />
      {children}
    </div>
  );
}
