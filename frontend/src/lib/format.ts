const dateTime = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' })
const number = new Intl.NumberFormat('ru-RU')

export function formatDate(value: string | null | undefined) {
  return value ? dateTime.format(new Date(value)) : '—'
}

export function formatNumber(value: number) {
  return number.format(value)
}

export function formatDuration(value: number | null) {
  if (value === null) return '—'
  const seconds = Math.max(0, Math.round(value))
  if (seconds < 60) return seconds + ' с'
  if (seconds < 3600) return Math.floor(seconds / 60) + ' мин ' + (seconds % 60) + ' с'
  if (seconds < 86400) return Math.floor(seconds / 3600) + ' ч ' + Math.floor(seconds % 3600 / 60) + ' мин'
  return Math.floor(seconds / 86400) + ' д ' + Math.floor(seconds % 86400 / 3600) + ' ч'
}
