// Builds the history object expected by Avatar, Charts, and Insights.
// dailyStats (from task_daily_stats table) is the authoritative source —
// it survives task clears, pruner anonymisation, and deletions.
// Live tasks act as a fallback for days not yet written to the stats table.

const DAY = 86_400_000
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10)

export function buildHistory(tasks, dailyStats = []) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Primary source: persistent DB stats table
  const statsMap = {}
  dailyStats.forEach(s => {
    statsMap[s.date] = { count: s.completed || 0, work: s.work || 0, personal: s.personal || 0 }
  })

  // Fallback: live tasks for any day not yet in the stats table
  const tasksMap = {}
  tasks.forEach(t => {
    if (!t.done || !t.completed) return
    const key = dayKey(t.completed)
    if (statsMap[key]) return   // stats table wins
    if (!tasksMap[key]) tasksMap[key] = { count: 0, work: 0, personal: 0 }
    tasksMap[key].count++
    if (t.cat === 'work')     tasksMap[key].work++
    if (t.cat === 'personal') tasksMap[key].personal++
  })

  // --- daily: last 371 days (53 × 7 for full-year heatmap) ---
  const N = 371
  const daily = []
  for (let i = N - 1; i >= 0; i--) {
    const d   = new Date(today.getTime() - i * DAY)
    const key = dayKey(d.getTime())
    const src = statsMap[key] || tasksMap[key]
    daily.push({ date: key, count: src?.count || 0 })
  }

  // --- monthly: last 12 months ---
  const monthly = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const y = d.getFullYear()
    const m = d.getMonth()

    let work = 0, personal = 0
    const allDays = { ...tasksMap, ...statsMap }   // statsMap overwrites tasksMap for same keys
    Object.entries(allDays).forEach(([dateStr, src]) => {
      const c = new Date(dateStr)
      if (c.getFullYear() !== y || c.getMonth() !== m) return
      work     += src.work     || 0
      personal += src.personal || 0
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
