// Builds the history object expected by Avatar, Charts, and Insights
// from real DB tasks (already in UI format: { done, completed, cat })

const DAY = 86_400_000
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10)

export function buildHistory(tasks) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // --- daily: last 371 days (53 × 7) ---
  const countMap = {}
  tasks.forEach(t => {
    if (t.done && t.completed) {
      const key = dayKey(t.completed)
      countMap[key] = (countMap[key] || 0) + 1
    }
  })

  const N = 371
  const daily = []
  for (let i = N - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY)
    const key = dayKey(d.getTime())
    daily.push({ date: key, count: countMap[key] || 0 })
  }

  // --- monthly: last 12 months ---
  const monthly = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const y = d.getFullYear()
    const m = d.getMonth()

    let work = 0, personal = 0
    tasks.forEach(t => {
      if (!t.done || !t.completed) return
      const c = new Date(t.completed)
      if (c.getFullYear() !== y || c.getMonth() !== m) return
      if (t.cat === 'work')     work++
      if (t.cat === 'personal') personal++
    })

    monthly.push({
      month:    d.toLocaleString('en', { month: 'short' }),
      year:     y,
      work:     Math.max(0, work),
      personal: Math.max(0, personal),
    })
  }

  return { daily, monthly }
}

export function computeStreak(daily) {
  let streak = 0
  for (let i = daily.length - 1; i >= 0; i--) {
    if (daily[i].count > 0) streak++
    else break
  }
  return streak
}
