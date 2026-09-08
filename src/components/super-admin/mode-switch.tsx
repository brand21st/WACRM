"use client";

import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";

import { useTheme } from "@/hooks/use-theme";
import { MODES, type Mode } from "@/lib/themes";
import { cn } from "@/lib/utils";

/**
 * Compact light/dark switch for the super-admin chrome. Uses the same
 * `useTheme` store as the merchant dashboard so the choice persists
 * across the whole app on this device.
 */
export function SuperAdminModeSwitch({ className }: { className?: string }) {
  const { mode, setMode } = useTheme();
  const t = useTranslations("SuperAdmin.appearance");

  return (
    <div
      role="radiogroup"
      aria-label={t("mode")}
      className={cn("grid grid-cols-2 gap-1 rounded-lg bg-muted p-1", className)}
    >
      {MODES.map((m) => (
        <ModeOption
          key={m}
          mode={m}
          active={m === mode}
          label={t(m)}
          ariaLabel={t("useMode", { mode: t(m) })}
          onPick={() => setMode(m)}
        />
      ))}
    </div>
  );
}

function ModeOption({
  mode,
  active,
  label,
  ariaLabel,
  onPick,
}: {
  mode: Mode;
  active: boolean;
  label: string;
  ariaLabel: string;
  onPick: () => void;
}) {
  const Icon = mode === "light" ? Sun : Moon;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={ariaLabel}
      onClick={onPick}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
