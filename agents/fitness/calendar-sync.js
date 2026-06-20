/**
 * Calendar Sync — pulls Google Calendar events + Calendly bookings into the
 * calendar_events table so the app can render a unified read-only calendar.
 *
 * Window: today → +35 days. Each run replaces the future window for each
 * source (so cancellations/reschedules disappear), then upserts fresh rows.
 *
 * Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *      (calendar.readonly scope), optional CALENDLY_TOKEN.
 *
 * Standalone:  node fitness/calendar-sync.js
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createCalendarClient, fetchGoogleEvents, fetchCalendlyEvents } from '../lib/calendar.js'
import { log, warn } from '../lib/logger.js'

const LOOKAHEAD_DAYS = 35
const ACCOUNTS_FILE  = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'accounts.json')

// setup-oauth.js writes the calendar-scoped refresh token into accounts.json,
// so that's the source of truth. CALENDAR_ACCOUNT picks which email's calendar
// to sync (defaults to the first account). Falls back to GOOGLE_REFRESH_TOKEN.
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
  const timeMin  = new Date(now); timeMin.setHours(0, 0, 0, 0)
  const timeMax  = new Date(timeMin.getTime() + LOOKAHEAD_DAYS * 86400000)
  const minISO   = timeMin.toISOString()
  const maxISO   = timeMax.toISOString()

  const clientId     = opts.clientId     ?? process.env.GOOGLE_CLIENT_ID
  const clientSecret = opts.clientSecret ?? process.env.GOOGLE_CLIENT_SECRET
  const refreshToken = resolveGoogleToken(opts.refreshToken)
  const calendlyTok  = opts.calendlyToken ?? process.env.CALENDLY_TOKEN

  let rows = []

  // ── Google Calendar ──────────────────────────────────────────────────────
  try {
    const cal = createCalendarClient({ clientId, clientSecret, refreshToken })
    const gEvents = await fetchGoogleEvents(cal, { timeMin: minISO, timeMax: maxISO })
    rows.push(...gEvents)
    log(`CalendarSync: ${gEvents.length} Google events`)
  } catch (e) {
    warn(`CalendarSync: Google fetch failed — ${e.message}`)
  }

  // ── Calendly (optional) ──────────────────────────────────────────────────
  if (calendlyTok) {
    try {
      const cEvents = await fetchCalendlyEvents({ token: calendlyTok, minStart: minISO, maxStart: maxISO })
      rows.push(...cEvents)
      log(`CalendarSync: ${cEvents.length} Calendly events`)
    } catch (e) {
      warn(`CalendarSync: Calendly fetch failed — ${e.message}`)
    }
  } else {
    log('CalendarSync: no CALENDLY_TOKEN — skipping Calendly')
  }

  if (opts.dryRun) {
    log(`CalendarSync: [DRY RUN] would upsert ${rows.length} events`)
    return { fetched: rows.length, upserted: 0 }
  }

  // ── Replace the future window per source, then upsert ─────────────────────
  const sources = [...new Set(rows.map(r => r.source))]
  for (const src of sources) {
    const { error } = await supabase
      .from('calendar_events')
      .delete()
      .eq('source', src)
      .gte('start_at', minISO)
      .lt('start_at', maxISO)
    if (error) warn(`CalendarSync: clear ${src} window failed — ${error.message}`)
  }

  let upserted = 0
  if (rows.length) {
    const { error } = await supabase
      .from('calendar_events')
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: false })
    if (error) warn(`CalendarSync: upsert failed — ${error.message}`)
    else upserted = rows.length
  }

  log(`CalendarSync: done — ${upserted} events synced`)
  return { fetched: rows.length, upserted }
}

// Standalone entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const { default: dotenv } = await import('dotenv')
  dotenv.config()
  const { createSupabaseClient } = await import('../lib/supabase.js')
  const supabase = createSupabaseClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  const dryRun = process.argv.includes('--dry-run')
  await run(supabase, { dryRun })
  process.exit(0)
}
