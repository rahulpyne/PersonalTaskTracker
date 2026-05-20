/**
 * Agent 7b — Apple Health Webhook Receiver
 *
 * Runs as a persistent HTTP server on port 3001 (separate from the cron).
 * Start with:  node agents/fitness/health-webhook.js
 *
 * ── iOS Shortcut Setup ────────────────────────────────────────────────────────
 * Create an automation in the Shortcuts app that runs daily (e.g. at 9pm)
 * and POSTs a JSON body to http://YOUR_LOCAL_IP:3001/health-sync
 *
 * The shortcut should read from Health and build this payload:
 * {
 *   "date":           "2026-05-20",
 *   "steps":          9842,
 *   "active_cals":    480,
 *   "total_cals":     2350,
 *   "exercise_mins":  52,
 *   "stand_hours":    11,
 *   "resting_hr":     57,
 *   "avg_hr":         71,
 *   "hrv":            52.4,
 *   "vo2_max":        52.1,
 *   "sleep_hrs":      7.2,
 *   "sleep_deep_hrs": 1.4,
 *   "sleep_rem_hrs":  1.9
 * }
 *
 * For external access (iPhone away from home Wi-Fi), expose the port via:
 *   npx cloudflared tunnel --url http://localhost:3001
 * or use the Cloudflare Tunnel from your router.
 *
 * ── Recommended iOS app ───────────────────────────────────────────────────────
 * "Health Auto Export" (free tier) can POST all the above fields to a custom
 * URL automatically. Set the export URL to http://YOUR_IP:3001/health-sync
 * and add X-Webhook-Secret header matching HEALTH_WEBHOOK_SECRET in .env
 *
 * ── Auth ──────────────────────────────────────────────────────────────────────
 * Set HEALTH_WEBHOOK_SECRET in agents/.env. Include it as the
 * X-Webhook-Secret header in the Shortcut or Health Auto Export config.
 */
import 'dotenv/config'
import http from 'http'
import { createSupabaseClient } from '../lib/supabase.js'
import { log, warn }            from '../lib/logger.js'

const PORT    = Number(process.env.HEALTH_WEBHOOK_PORT   || 3001)
const SECRET  =        process.env.HEALTH_WEBHOOK_SECRET || ''

const supabase = createSupabaseClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
)

const server = http.createServer(async (req, res) => {
  // ── Health check ────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, ts: new Date().toISOString() }))
    return
  }

  // ── Data ingest endpoint ─────────────────────────────────────────
  if (req.method !== 'POST' || !req.url.startsWith('/health-sync')) {
    res.writeHead(404)
    res.end('not found')
    return
  }

  // Auth
  if (SECRET && req.headers['x-webhook-secret'] !== SECRET) {
    warn('HealthWebhook: rejected — bad secret')
    res.writeHead(401)
    res.end('unauthorized')
    return
  }

  // Parse body
  let body = ''
  for await (const chunk of req) body += chunk
  let payload
  try {
    payload = JSON.parse(body)
  } catch {
    res.writeHead(400)
    res.end('invalid json')
    return
  }

  // ── Detect Health Auto Export format vs flat format ──────────────
  // Health Auto Export sends: { data: { metrics: [{ name, units, data: [{qty, date}] }] } }
  // Flat format (manual/custom):  { date, steps, active_cals, ... }
  const rows = payload.data?.metrics
    ? parseHealthAutoExport(payload, payload)
    : [buildFlatRow(payload)]

  let saved = 0
  for (const row of rows) {
    const { error } = await supabase
      .from('fitness_daily_metrics')
      .upsert(row, { onConflict: 'date' })

    if (error) warn(`HealthWebhook: DB error (${row.date}) — ${error.message}`)
    else {
      log(`HealthWebhook: ✅ ${row.date} — steps=${row.steps ?? '?'} hrv=${row.hrv ?? '?'} restHR=${row.resting_hr ?? '?'} exerciseMins=${row.exercise_mins ?? '?'}`)
      saved++
    }
  }
  log(`HealthWebhook: saved ${saved}/${rows.length} date rows`)
  res.writeHead(200)
  res.end('ok')
})

function num(v) {
  const n = Number(v)
  return isNaN(n) ? null : n
}

// ── Flat format (manual shortcut) ─────────────────────────────────────────────
function buildFlatRow(p) {
  return {
    date:           p.date || new Date().toISOString().slice(0, 10),
    steps:          num(p.steps),
    active_cals:    num(p.active_cals),
    total_cals:     num(p.total_cals),
    exercise_mins:  num(p.exercise_mins),
    stand_hours:    num(p.stand_hours),
    resting_hr:     num(p.resting_hr),
    avg_hr:         num(p.avg_hr),
    hrv:            num(p.hrv),
    vo2_max:        num(p.vo2_max),
    sleep_hrs:      num(p.sleep_hrs),
    sleep_deep_hrs: num(p.sleep_deep_hrs),
    sleep_rem_hrs:  num(p.sleep_rem_hrs),
    raw:            p,
  }
}

// ── Health Auto Export format ─────────────────────────────────────────────────
// Parses the nested metrics array, groups readings by date, aggregates per day.
// Metric name → column mapping based on Health Auto Export field names.
function parseHealthAutoExport(payload, rawPayload) {
  const metrics = payload.data.metrics   // [{ name, units, data: [{qty, date, source}] }]

  // Group raw readings by local date (YYYY-MM-DD from timestamp string)
  const byDate = {}
  for (const metric of metrics) {
    for (const reading of (metric.data || [])) {
      if (reading.qty == null) continue
      const dateStr = reading.date.slice(0, 10)   // "2026-05-19 08:59:00 -0700" → "2026-05-19"
      if (!byDate[dateStr])              byDate[dateStr] = {}
      if (!byDate[dateStr][metric.name]) byDate[dateStr][metric.name] = []
      byDate[dateStr][metric.name].push(Number(reading.qty))
    }
  }

  const sum  = arr => arr?.length ? arr.reduce((s, v) => s + v, 0) : null
  const avg  = arr => arr?.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null
  const last = arr => arr?.length ? arr[arr.length - 1] : null
  const rnd  = (v, d = 1) => v != null ? +v.toFixed(d) : null

  return Object.entries(byDate).map(([date, r]) => {
    const activeCals = rnd(sum(r['active_energy']),    0)
    const basalCals  = rnd(sum(r['basal_energy_burned']), 0)
    const totalCals  = (activeCals != null && basalCals != null) ? activeCals + basalCals : null

    // Sleep: sleep_analysis comes as hours in "asleep" state
    const sleepHrs      = rnd(sum(r['sleep_analysis']),        1)
    const sleepDeepHrs  = rnd(sum(r['sleep_deep']),            1)
    const sleepRemHrs   = rnd(sum(r['sleep_rem']),             1)

    return {
      date,
      steps:          r['step_count']             ? Math.round(sum(r['step_count']))          : null,
      active_cals:    activeCals,
      total_cals:     totalCals,
      exercise_mins:  r['apple_exercise_time']    ? Math.round(sum(r['apple_exercise_time'])) : null,
      stand_hours:    r['apple_stand_hour']        ? Math.round(sum(r['apple_stand_hour']))    : null,
      resting_hr:     r['resting_heart_rate']      ? Math.round(avg(r['resting_heart_rate']))  : null,
      avg_hr:         r['heart_rate']              ? Math.round(avg(r['heart_rate']))          : null,
      hrv:            r['heart_rate_variability']  ? rnd(avg(r['heart_rate_variability']))     : null,
      vo2_max:        r['vo2_max']                 ? rnd(last(r['vo2_max']))                   : null,
      sleep_hrs:      sleepHrs,
      sleep_deep_hrs: sleepDeepHrs,
      sleep_rem_hrs:  sleepRemHrs,
      raw:            rawPayload,  // store full payload once (on first/last date row)
    }
  })
}

server.listen(PORT, () => {
  log(`HealthWebhook: listening on :${PORT}`)
  log(`HealthWebhook: POST /health-sync  |  GET /health`)
  if (SECRET) log('HealthWebhook: 🔒 secret auth enabled')
  else        warn('HealthWebhook: no HEALTH_WEBHOOK_SECRET — any device can POST')
})
