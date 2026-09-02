export const WEEKDAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const

export function hhmmToInput(value: string | undefined): string {
  if (!value || value.length < 4) return '09:00'
  return `${value.slice(0, 2)}:${value.slice(2, 4)}`
}

export function inputToHhmm(value: string): string {
  const digits = value.replace(/\D/g, '').padStart(4, '0').slice(0, 4)
  return digits
}

export function defaultWeeklyHours(): Array<{
  day_of_week: (typeof WEEKDAYS)[number]
  open_time: string
  close_time: string
}> {
  return WEEKDAYS.map((day) => ({
    day_of_week: day,
    open_time: '0900',
    close_time: day === 'SATURDAY' || day === 'SUNDAY' ? '1400' : '1800',
  }))
}
