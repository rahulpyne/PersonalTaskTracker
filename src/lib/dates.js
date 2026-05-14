export function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  if (sameDay(d, today)) return 'Today'
  if (sameDay(d, tomorrow)) return 'Tomorrow'

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function isOverdue(iso) {
  if (!iso) return false
  return new Date(iso) < new Date() && !isSameDay(new Date(iso), new Date())
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function startOfDay(d = new Date()) {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

export function startOfWeek(d = new Date()) {
  const out = new Date(d)
  out.setDate(out.getDate() - out.getDay())
  out.setHours(0, 0, 0, 0)
  return out
}

export function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
