/**
 * Supabase Edge Function — Apple Health Webhook Receiver
 *
 * Deployed URL (always-on, no local server needed):
 *   https://sozysnvupisjygmwdzej.supabase.co/functions/v1/health-sync
 *
 * Deploy with:
 *   npx supabase functions deploy health-sync --no-verify-jwt
 *
 * Set the secret in Supabase Dashboard → Edge Functions → health-sync → Secrets:
 *   HEALTH_WEBHOOK_SECRET = <your secret>
 *
 * In Health Auto Export app:
 *   URL    : https://sozysnvupisjygmwdzej.supabase.co/functions/v1/health-sync
 *   Header : X-Webhook-Secret = <your secret>
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL        = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEBHOOK_SECRET      = Deno.env.get('HEALTH_WEBHOOK_SECRET') ?? ''

Deno.serve(async (req: Request) => {
  // Health check
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (req.method !== 'POST') {
    return new Response('not found', { status: 404 })
  }

  // Auth
  if (WEBHOOK_SECRET && req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    console.warn('health-sync: rejected — bad secret')
    return new Response('unauthorized', { status: 401 })
  }

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return new Response('invalid json', { status: 400 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Detect Health Auto Export nested format vs flat
  const rows = (payload as any).data?.metrics
    ? parseHealthAutoExport(payload)
    : [buildFlatRow(payload)]

  let saved = 0
  for (const row of rows) {
    const { error } = await supabase
      .from('fitness_daily_metrics')
      .upsert(row, { onConflict: 'date' })

    if (error) {
      console.error(`health-sync: DB error (${row.date}) — ${error.message}`)
    } else {
      console.log(`health-sync: ✅ ${row.date} steps=${row.steps ?? '?'} hrv=${row.hrv ?? '?'} restHR=${row.resting_hr ?? '?'}`)
      saved++
    }
  }

  return new Response(
    JSON.stringify({ ok: true, saved, total: rows.length }),
    { headers: { 'Content-Type': 'application/json' } }
  )
})

// ── Flat format (manual shortcut) ─────────────────────────────────────────────
function buildFlatRow(p: Record<string, unknown>) {
  return {
    date:           (p.date as string) || new Date().toISOString().slice(0, 10),
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

// ── Health Auto Export nested format ─────────────────────────────────────────
function parseHealthAutoExport(payload: Record<string, unknown>) {
  const metrics = (payload as any).data.metrics as Array<{
    name: string; units: string; data: Array<{ qty: number; date: string }>
  }>

  // Group readings by local date
  const byDate: Record<string, Record<string, number[]>> = {}
  for (const metric of metrics) {
    for (const reading of (metric.data ?? [])) {
      if (reading.qty == null) continue
      const dateStr = reading.date.slice(0, 10)
      if (!byDate[dateStr])              byDate[dateStr] = {}
      if (!byDate[dateStr][metric.name]) byDate[dateStr][metric.name] = []
      byDate[dateStr][metric.name].push(Number(reading.qty))
    }
  }

  const sum  = (arr?: number[]) => arr?.length ? arr.reduce((s, v) => s + v, 0) : null
  const avg  = (arr?: number[]) => arr?.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null
  const last = (arr?: number[]) => arr?.length ? arr[arr.length - 1] : null
  const rnd  = (v: number | null, d = 1) => v != null ? +v.toFixed(d) : null

  return Object.entries(byDate).map(([date, r]) => {
    const activeCals = r['active_energy']       ? Math.round(sum(r['active_energy'])!) : null
    const basalCals  = r['basal_energy_burned'] ? Math.round(sum(r['basal_energy_burned'])!) : null

    return {
      date,
      steps:          r['step_count']              ? Math.round(sum(r['step_count'])!) : null,
      active_cals:    activeCals,
      total_cals:     activeCals != null && basalCals != null ? activeCals + basalCals : null,
      exercise_mins:  r['apple_exercise_time']     ? Math.round(sum(r['apple_exercise_time'])!) : null,
      stand_hours:    r['apple_stand_hour']         ? Math.round(sum(r['apple_stand_hour'])!) : null,
      resting_hr:     r['resting_heart_rate']       ? Math.round(avg(r['resting_heart_rate'])!) : null,
      avg_hr:         r['heart_rate']               ? Math.round(avg(r['heart_rate'])!) : null,
      hrv:            r['heart_rate_variability']   ? rnd(avg(r['heart_rate_variability'])) : null,
      vo2_max:        r['vo2_max']                  ? rnd(last(r['vo2_max'])) : null,
      sleep_hrs:      r['sleep_analysis']           ? rnd(sum(r['sleep_analysis'])) : null,
      sleep_deep_hrs: r['sleep_deep']               ? rnd(sum(r['sleep_deep'])) : null,
      sleep_rem_hrs:  r['sleep_rem']                ? rnd(sum(r['sleep_rem'])) : null,
      raw:            payload,
    }
  })
}

function num(v: unknown): number | null {
  const n = Number(v)
  return isNaN(n) ? null : n
}
