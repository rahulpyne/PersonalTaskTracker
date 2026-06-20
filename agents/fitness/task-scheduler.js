/**
 * Task Scheduler — Motion-style auto-scheduling.
 *
 * Lifecycle of a task_block: proposed → approved → confirmed (in Google Cal)
 *                            confirmed → done | missed (re-proposed next run)
 *
 * Each run:
 *   1. push  — approved blocks → create Google Calendar events → confirmed
 *   2. reconcile — done tasks' blocks closed; missed confirmed blocks removed
 *      from Google Calendar (their tasks re-enter the pool)
 *   3. propose — schedule remaining incomplete tasks into free slots, replacing
 *      the previous proposals (this is the auto-reprioritization)
 *
 * Standalone:  node fitness/task-scheduler.js          (propose only)
 *              node fitness/task-scheduler.js --push    (also write approved→GCal)
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { schedule } from '../lib/scheduler.js'
import { createCalendarClient, createGoogleEvent, deleteGoogleEvent } from '../lib/calendar.js'
import { log, warn } from '../lib/logger.js'

const HORIZON_DAYS  = 14
const ACCOUNTS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'accounts.json')

function resolveGoogleToken(explicit) {
  if (explicit) return explicit
  try {
    const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'))
    const wanted   = process.env.CALENDAR_ACCOUNT
    const acct     = (wanted && accounts.find(a => a.email === wanted)) || accounts[0]
    if (acct?.refreshToken) return acct.refreshToken
  } catch { /* fall through */ }
  return process.env.GOOGLE_REFRESH_TOKEN
}

export async function run(supabase, opts = {}) {
  const now      = new Date()
  const nowISO   = now.toISOString()
  const push     = opts.push ?? false
  const calendar = (() => {
    try {
      return createCalendarClient({
        clientId:     process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        refreshToken: resolveGoogleToken(opts.refreshToken),
      })
    } catch { return null }
  })()

  // ── Load tasks + existing blocks ──────────────────────────────────────────
  const { data: tasks = [] } = await supabase
    .from('tasks').select('id,text,type,prio,done,duration_mins').is('parent_id', null)
  const incompleteById = new Map(tasks.filter(t => !t.done).map(t => [t.id, t]))
  const doneIds        = new Set(tasks.filter(t => t.done).map(t => t.id))

  const { data: blocks = [] } = await supabase
    .from('task_blocks').select('*')

  // ── 1. Push approved → Google Calendar → confirmed ────────────────────────
  if (push && calendar) {
    for (const b of blocks.filter(b => b.status === 'approved')) {
      try {
        const eventId = await createGoogleEvent(calendar, {
          summary: `▸ ${b.title}`,
          description: `Auto-scheduled task block (${b.category}, ${b.prio}).`,
          start: b.start_at, end: b.end_at,
        })
        await supabase.from('task_blocks')
          .update({ status: 'confirmed', gcal_event_id: eventId }).eq('id', b.id)
        b.status = 'confirmed'; b.gcal_event_id = eventId
        log(`TaskScheduler: confirmed "${b.title}" → GCal ${eventId}`)
      } catch (e) { warn(`TaskScheduler: push failed for "${b.title}" — ${e.message}`) }
    }
  }

  // ── 2. Reconcile done + missed ────────────────────────────────────────────
  for (const b of blocks) {
    const taskDone = doneIds.has(b.task_id)
    const missed   = new Date(b.end_at) < now && incompleteById.has(b.task_id)

    if (taskDone && b.status !== 'done') {
      await supabase.from('task_blocks').update({ status: 'done' }).eq('id', b.id)
      b.status = 'done'
    } else if (missed && b.status === 'confirmed') {
      if (calendar && b.gcal_event_id) {
        try { await deleteGoogleEvent(calendar, b.gcal_event_id) } catch { /* ignore */ }
      }
      await supabase.from('task_blocks').update({ status: 'missed' }).eq('id', b.id)
      b.status = 'missed'
      log(`TaskScheduler: missed "${b.title}" — will re-propose`)
    }
  }

  // ── 3. Propose for incomplete tasks not already committed ─────────────────
  // Confirmed future blocks are commitments → keep them, treat as busy, and
  // exclude their tasks from re-proposal.
  const liveConfirmed = blocks.filter(b =>
    b.status === 'confirmed' && new Date(b.end_at) >= now && incompleteById.has(b.task_id))
  const committedTaskIds = new Set(liveConfirmed.map(b => b.task_id))

  // External busy (GCal + Calendly) + confirmed commitments
  const horizonISO = new Date(now.getTime() + HORIZON_DAYS * 86400000).toISOString()
  const { data: ext = [] } = await supabase
    .from('calendar_events').select('start_at,end_at')
    .eq('busy', true).lt('start_at', horizonISO).gt('end_at', nowISO)
  const busy = [
    ...ext.map(e => ({ start: e.start_at, end: e.end_at })),
    ...liveConfirmed.map(b => ({ start: b.start_at, end: b.end_at })),
  ]

  const toSchedule = [...incompleteById.values()]
    .filter(t => !committedTaskIds.has(t.id))
    .map(t => ({ id: t.id, text: t.text, type: t.type === 'work' ? 'work' : 'personal', prio: t.prio, duration_mins: t.duration_mins }))

  const proposed = schedule(toSchedule, busy, { now, horizonDays: HORIZON_DAYS })

  if (!opts.dryRun) {
    // Replace previous proposals/approved-but-unpushed with the fresh plan
    await supabase.from('task_blocks').delete().in('status', ['proposed'])
    if (proposed.length) {
      const rows = proposed.map(p => ({ ...p, status: 'proposed' }))
      const { error } = await supabase.from('task_blocks').insert(rows)
      if (error) warn(`TaskScheduler: insert proposed failed — ${error.message}`)
    }
  }

  log(`TaskScheduler: ${proposed.length} proposed, ${committedTaskIds.size} already committed`)
  return { proposed: proposed.length, committed: committedTaskIds.size }
}

// Standalone entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const { default: dotenv } = await import('dotenv')
  dotenv.config()
  const { createSupabaseClient } = await import('../lib/supabase.js')
  const supabase = createSupabaseClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  await run(supabase, { push: process.argv.includes('--push'), dryRun: process.argv.includes('--dry-run') })
  process.exit(0)
}
