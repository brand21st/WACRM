"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isAccountStatus, type PlatformAccountStatus } from "@/lib/auth/account-status";

export function AccountStatusSelect({
  value,
  onChange,
  disabled,
  labels,
  className,
}: {
  value: string;
  onChange: (status: PlatformAccountStatus) => void;
  disabled?: boolean;
  labels: { active: string; hold: string; block: string };
  className?: string;
}) {
  const current = isAccountStatus(value) ? value : "active";

  return (
    <Select
      value={current}
      disabled={disabled}
      onValueChange={(next) => {
        if (isAccountStatus(next)) onChange(next);
      }}
    >
      <SelectTrigger className={className ?? "w-32"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="active">{labels.active}</SelectItem>
        <SelectItem value="hold">{labels.hold}</SelectItem>
        <SelectItem value="suspended">{labels.block}</SelectItem>
      </SelectContent>
    </Select>
  );
}
