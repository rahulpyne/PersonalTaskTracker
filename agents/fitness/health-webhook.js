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

  const date = payload.date || new Date().toISOString().slice(0, 10)

  const row = {
    date,
    steps:          num(payload.steps),
    active_cals:    num(payload.active_cals),
    total_cals:     num(payload.total_cals),
    exercise_mins:  num(payload.exercise_mins),
    stand_hours:    num(payload.stand_hours),
    resting_hr:     num(payload.resting_hr),
    avg_hr:         num(payload.avg_hr),
    hrv:            num(payload.hrv),
    vo2_max:        num(payload.vo2_max),
    sleep_hrs:      num(payload.sleep_hrs),
    sleep_deep_hrs: num(payload.sleep_deep_hrs),
    sleep_rem_hrs:  num(payload.sleep_rem_hrs),
    raw:            payload,
  }

  const { error } = await supabase
    .from('fitness_daily_metrics')
    .upsert(row, { onConflict: 'date' })

  if (error) {
    warn(`HealthWebhook: DB error — ${error.message}`)
    res.writeHead(500)
    res.end('db error')
    return
  }

  log(`HealthWebhook: ✅ metrics saved for ${date} — steps=${row.steps ?? '?'} sleep=${row.sleep_hrs ?? '?'}h hrv=${row.hrv ?? '?'}`)
  res.writeHead(200)
  res.end('ok')
})

function num(v) {
  const n = Number(v)
  return isNaN(n) ? null : n
}

server.listen(PORT, () => {
  log(`HealthWebhook: listening on :${PORT}`)
  log(`HealthWebhook: POST /health-sync  |  GET /health`)
  if (SECRET) log('HealthWebhook: 🔒 secret auth enabled')
  else        warn('HealthWebhook: no HEALTH_WEBHOOK_SECRET — any device can POST')
})
