/**
 * Task auto-scheduler — Motion-style slot packing.
 *
 * Places incomplete tasks into free calendar slots by priority, respecting
 * per-category time windows. Because every run schedules ALL incomplete tasks
 * forward from `now`, a missed block (its task is still incomplete) is simply
 * re-placed into the next free slot — that's the auto-reprioritization.
 *
 * Pure function — no I/O. The agent wraps it with DB + Google Calendar.
 */

// Default block length by priority (minutes); overridden per-task by duration_mins.
export const DEFAULT_DURATION = { high: 60, med: 30, low: 20 }

// Allowed scheduling windows (local hours, 24h).
//   work     → Mon–Fri only, 9:00–19:00 (core 9–17 is "at work"; overflow to 19)
//   personal → any day 9:00–23:00, but NOT during the Mon–Fri 9–17 work block
const WINDOWS = {
  work:     { startH: 9,  endH: 19, days: [1, 2, 3, 4, 5] },        // Mon–Fri
  personal: { startH: 9,  endH: 23, days: [0, 1, 2, 3, 4, 5, 6] },  // any day
}
const WORK_BLOCK = { startH: 9, endH: 17, days: [1, 2, 3, 4, 5] }   // reserved for work
const PRIO_RANK  = { high: 0, med: 1, low: 2 }
const STEP_MIN   = 15            // slot granularity
const DAY_MS     = 86_400_000

const minsOfDay = (d) => d.getHours() * 60 + d.getMinutes()
const atTime    = (day, mins) => { const x = new Date(day); x.setHours(0, mins, 0, 0); return x }

function durationFor(task) {
  return task.duration_mins || DEFAULT_DURATION[task.prio] || 30
}

// Is [start, end) allowed for this category on its day, and clear of the work block?
function withinWindow(category, start, end) {
  const win = WINDOWS[category] || WINDOWS.personal
  const dow = start.getDay()
  if (!win.days.includes(dow)) return false
  const s = minsOfDay(start), e = minsOfDay(end)
  if (s < win.startH * 60 || e > win.endH * 60) return false
  // Personal tasks may not occupy the Mon–Fri 9–17 work block
  if (category !== 'work' && WORK_BLOCK.days.includes(dow)) {
    const wb0 = WORK_BLOCK.startH * 60, wb1 = WORK_BLOCK.endH * 60
    if (s < wb1 && e > wb0) return false   // overlaps the work block
  }
  return true
}

const overlaps = (s1, e1, s2, e2) => s1 < e2 && s2 < e1

/**
 * @param tasks  [{ id, text, type:'work'|'personal', prio:'high'|'med'|'low', duration_mins? }]
 *               (already filtered to incomplete; fitness counts as 'personal')
 * @param busy   [{ start:Date|ISO, end:Date|ISO }] external commitments (GCal/Calendly + confirmed blocks)
 * @param opts   { now?:Date, horizonDays?:number }
 * @returns      [{ task_id, title, category, prio, start_at, end_at, duration_mins }]
 */
export function schedule(tasks, busy = [], opts = {}) {
  const now         = opts.now ? new Date(opts.now) : new Date()
  const horizonDays = opts.horizonDays ?? 14
  const horizon     = new Date(now.getTime() + horizonDays * DAY_MS)

  // Mutable busy list (Date pairs), seeded with external commitments
  const blocked = busy.map(b => ({ start: new Date(b.start), end: new Date(b.end) }))

  // Priority order, stable within a priority by given order
  const queue = [...tasks].sort((a, b) =>
    (PRIO_RANK[a.prio] ?? 1) - (PRIO_RANK[b.prio] ?? 1))

  const placed = []

  for (const task of queue) {
    const category = task.type === 'work' ? 'work' : 'personal'
    const durMin   = durationFor(task)
    const durMs    = durMin * 60000

    // Walk forward in STEP_MIN increments from the next step boundary >= now
    let cursor = new Date(Math.ceil(now.getTime() / (STEP_MIN * 60000)) * (STEP_MIN * 60000))
    let slot   = null

    while (cursor < horizon) {
      const dayStart = new Date(cursor); dayStart.setHours(0, 0, 0, 0)
      const win      = WINDOWS[category] || WINDOWS.personal

      // Skip whole days the category can't use
      if (!win.days.includes(cursor.getDay())) {
        cursor = atTime(new Date(dayStart.getTime() + DAY_MS), win.startH * 60)
        continue
      }
      // Before window opens → jump to open; after it closes → next day
      const open  = atTime(dayStart, win.startH * 60)
      const close = atTime(dayStart, win.endH * 60)
      if (cursor < open)  { cursor = open; continue }
      if (cursor >= close) { cursor = atTime(new Date(dayStart.getTime() + DAY_MS), win.startH * 60); continue }

      const candEnd = new Date(cursor.getTime() + durMs)
      if (!withinWindow(category, cursor, candEnd)) {
        cursor = new Date(cursor.getTime() + STEP_MIN * 60000)
        continue
      }
      const clash = blocked.find(b => overlaps(cursor, candEnd, b.start, b.end))
      if (clash) { cursor = new Date(clash.end); continue }   // jump past the conflict

      slot = { start: new Date(cursor), end: candEnd }
      break
    }

    if (!slot) continue   // couldn't fit within horizon

    blocked.push(slot)
    placed.push({
      task_id:       task.id,
      title:         task.text,
      category,
      prio:          task.prio,
      duration_mins: durMin,
      start_at:      slot.start.toISOString(),
      end_at:        slot.end.toISOString(),
    })
  }

  return placed
}
