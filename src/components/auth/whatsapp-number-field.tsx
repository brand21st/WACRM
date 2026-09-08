'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import {
  clampNationalDigits,
  countryByIso2,
  DIAL_COUNTRIES,
  flagImageUrl,
  isKnownCountryIso2,
  nsnLength,
  splitWhatsAppNumber,
} from '@/lib/geo/dial-codes'
import { detectCountryFromBrowser } from '@/lib/geo/detect-country'
import { useTranslations } from 'next-intl'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

const FIELD_CLASS =
  'h-12 border border-slate-200 dark:border-border bg-white dark:bg-muted/40 text-sm text-slate-900 dark:text-foreground placeholder:text-slate-400 focus:border-[#00794c] focus:outline-none focus:ring-2 focus:ring-[#00794c]/20 transition-all'

function CountryFlag({
  iso2,
  eager = false,
}: {
  iso2: string
  eager?: boolean
}) {
  return (
    <img
      src={flagImageUrl(iso2, 40)}
      srcSet={`${flagImageUrl(iso2, 80)} 2x`}
      alt=""
      width={22}
      height={16}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      className="h-4 w-[1.375rem] shrink-0 rounded-[2px] object-cover ring-1 ring-black/10"
    />
  )
}

export function WhatsAppNumberField({
  id,
  iso2,
  national,
  onIso2Change,
  onNationalChange,
  autoDetect = false,
  disabled = false,
  required = false,
  hint,
  nationalPlaceholder,
  countryLabel,
  numberLabel,
}: {
  id: string
  iso2: string
  national: string
  onIso2Change: (iso2: string) => void
  onNationalChange: (national: string) => void
  autoDetect?: boolean
  disabled?: boolean
  required?: boolean
  hint?: string
  nationalPlaceholder?: string
  countryLabel: string
  numberLabel: string
}) {
  const t = useTranslations('WhatsAppNumber')
  // Stay unlocked until the user picks a country. `!autoDetect` here
  // used to freeze geo forever when the parent starts with no profile
  // (autoDetect false) and later turns it on for an empty number.
  const lockedRef = useRef(false)
  const onIso2Ref = useRef(onIso2Change)
  onIso2Ref.current = onIso2Change
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!autoDetect || lockedRef.current) return
    onIso2Ref.current(detectCountryFromBrowser())

    let cancelled = false
    fetch('/api/geo/country')
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { iso2?: string | null } | null) => {
        if (cancelled || lockedRef.current) return
        const next = body?.iso2
        if (typeof next === 'string' && isKnownCountryIso2(next)) {
          onIso2Ref.current(next)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [autoDetect])

  const selectCountry = (next: string) => {
    lockedRef.current = true
    onIso2Change(next)
    onNationalChange(clampNationalDigits(next, national))
    setOpen(false)
  }

  const selected = countryByIso2(iso2) ?? countryByIso2('IN')!
  const length = nsnLength(selected.iso2)
  const lengthHint =
    length.min === length.max
      ? t('digits', { count: length.max })
      : t('digitsRange', { min: length.min, max: length.max })

  const onNationalInput = (raw: string) => {
    const trimmed = raw.trim()
    if (trimmed.startsWith('+') || trimmed.startsWith('00')) {
      lockedRef.current = true
      const split = splitWhatsAppNumber(trimmed.replace(/^00/, '+'))
      onIso2Change(split.iso2)
      onNationalChange(clampNationalDigits(split.iso2, split.national))
      return
    }
    const digits = raw.replace(/\D/g, '')
    if (
      digits.startsWith(selected.dial) &&
      digits.length - selected.dial.length >= length.min
    ) {
      onNationalChange(
        clampNationalDigits(selected.iso2, digits.slice(selected.dial.length)),
      )
      return
    }
    onNationalChange(clampNationalDigits(selected.iso2, raw))
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-sm font-medium text-slate-700 dark:text-slate-300 text-left"
      >
        {numberLabel}
      </label>
      <div className="flex">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            type="button"
            disabled={disabled}
            aria-label={countryLabel}
            className={`${FIELD_CLASS} flex w-[7.75rem] shrink-0 items-center gap-2 rounded-l-lg rounded-r-none border-r-0 px-2.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <CountryFlag iso2={selected.iso2} eager />
            <span className="flex-1 text-left font-medium tabular-nums">
              +{selected.dial}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="bottom"
            className="w-72 max-h-72 overflow-y-auto p-1"
          >
            {DIAL_COUNTRIES.map((country) => {
              const active = country.iso2 === selected.iso2
              return (
                <button
                  key={country.iso2}
                  type="button"
                  onClick={() => selectCountry(country.iso2)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-slate-100 dark:hover:bg-muted ${
                    active ? 'bg-slate-50 dark:bg-muted/60' : ''
                  }`}
                >
                  <CountryFlag iso2={country.iso2} />
                  <span className="min-w-[3.25rem] font-medium tabular-nums">
                    +{country.dial}
                  </span>
                  <span className="flex-1 truncate text-slate-600 dark:text-muted-foreground">
                    {country.name}
                  </span>
                  {active ? (
                    <Check className="h-4 w-4 shrink-0 text-[#00794c]" />
                  ) : null}
                </button>
              )
            })}
          </PopoverContent>
        </Popover>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder={nationalPlaceholder}
          value={national}
          maxLength={length.max + 1}
          disabled={disabled}
          required={required}
          onChange={(e) => onNationalInput(e.target.value)}
          className={`${FIELD_CLASS} min-w-0 flex-1 rounded-l-none rounded-r-lg px-3.5`}
        />
      </div>
      {hint || lengthHint ? (
        <p className="text-xs text-slate-400 dark:text-muted-foreground">
          {[hint, lengthHint].filter(Boolean).join(' · ')}
        </p>
      ) : null}
    </div>
  )
}
