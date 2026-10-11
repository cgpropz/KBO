// Board "last updated" stamp, America/New_York, matching "Fri 10/9 7:13 PM ET".
export function formatBoardUpdated(iso) {
  const date = new Date(iso || '')
  if (Number.isNaN(date.getTime())) return ''
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(date).map((part) => [part.type, part.value]),
  )
  return `${parts.weekday} ${parts.month}/${parts.day} ${parts.hour}:${parts.minute} ${parts.dayPeriod} ET`
}
