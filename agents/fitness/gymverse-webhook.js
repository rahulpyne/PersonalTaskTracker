/**
 * Agent — GymVerse Local Webhook Receiver
 *
 * Mirrors the Supabase Edge Function for local development / home Wi-Fi use.
 * Start with:  node agents/fitness/gymverse-webhook.js
 *
 * Uses the same payload format as the Edge Function — see gymverse-sync/index.ts
 * for full documentation.
 *
 * ── Env vars (agents/.env) ────────────────────────────────────────────────────
 *   GYMVERSE_WEBHOOK_PORT    default 3002
 *   GYMVERSE_WEBHOOK_SECRET  secret header value
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 */
import 'dotenv/config'
import http from 'http'
import { createSupabaseClient } from '../lib/supabase.js'
import { log, warn } from '../lib/logger.js'

const PORT   = Number(process.env.GYMVERSE_WEBHOOK_PORT   || 3002)
const SECRET =        process.env.GYMVERSE_WEBHOOK_SECRET || ''

const supabase = createSupabaseClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
)

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: 'gymverse-webhook' }))
    return
  }

  if (req.method !== 'POST' || !req.url.startsWith('/gymverse-sync')) {
    res.writeHead(404); res.end('not found'); return
  }

  if (SECRET && req.headers['x-webhook-secret'] !== SECRET) {
    warn('GymVerseWebhook: rejected — bad secret')
    res.writeHead(401); res.end('unauthorized'); return
  }

  let body = ''
  for await (const chunk of req) body += chunk
  let payload
  try { payload = JSON.parse(body) }
  catch { res.writeHead(400); res.end('invalid json'); return }

  const workouts = Array.isArray(payload.workouts) ? payload.workouts : [payload]
  let saved = 0, skipped = 0

  for (const w of workouts) {
    const row = buildRow(w)
    if (!row.started_at) { skipped++; continue }

    const { error } = await supabase
      .from('gymverse_workouts')
      .upsert(row, { onConflict: 'external_id', ignoreDuplicates: false })

    if (error) {
      warn(`GymVerseWebhook: DB error — ${error.message}`)
      skipped++
    } else {
      log(`GymVerseWebhook: ✅ ${row.workout_name ?? 'workout'} | ${row.duration_secs}s | ${row.active_energy_kcal ?? '?'} kcal`)
      saved++
    }
  }

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, saved, skipped, total: workouts.length }))
})

function buildRow(w) {
  const num = v => { const n = Number(v); return isNaN(n) ? null : n }
  const str = v => v != null ? String(v) : null
  return {
    external_id:        str(w.external_id),
    workout_name:       str(w.workout_name),
    started_at:         str(w.started_at),
    ended_at:           str(w.ended_at) ?? null,
    duration_secs:      num(w.duration_secs),
    active_energy_kcal: num(w.active_energy_kcal),
    total_volume_kg:    num(w.total_volume_kg)  ?? null,
    exercises:          Array.isArray(w.exercises) ? w.exercises : null,
    source_app:         'gymverse',
    device:             str(w.device) ?? null,
    raw:                w,
  }
}

server.listen(PORT, () => {
  log(`GymVerseWebhook: listening on :${PORT}`)
  log(`GymVerseWebhook: POST /gymverse-sync  |  GET /health`)
  if (SECRET) log('GymVerseWebhook: 🔒 secret auth enabled')
  else        warn('GymVerseWebhook: ⚠ no secret — any device can POST')
})
