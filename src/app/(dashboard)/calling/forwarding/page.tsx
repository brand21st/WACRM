'use client'

import { CallingComingSoon } from '@/components/calling/coming-soon'
import { UpgradePlanBanner } from '@/components/settings/upgrade-plan-banner'
import { useEntitlements } from '@/hooks/use-entitlements'

export default function Page() {
  const { entitlements } = useEntitlements()
  return (
    <>
      <div className="mx-auto max-w-2xl">
        <UpgradePlanBanner allowed={entitlements?.callForwardingEnabled} />
      </div>
      <CallingComingSoon
        titleKey="forwardingTitle"
        descKey="forwardingDesc"
        bodyKey="forwardingBody"
      />
    </>
  )
}
