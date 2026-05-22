/**
 * Supabase Edge Function — GymVerse Sync Receiver
 *
 * Deployed URL (always-on):
 *   https://sozysnvupisjygmwdzej.supabase.co/functions/v1/gymverse-sync
 *
 * Deploy with:
 *   npx supabase functions deploy gymverse-sync --no-verify-jwt
 *
 * Set secrets in Supabase Dashboard → Edge Functions → gymverse-sync → Secrets:
 *   GYMVERSE_WEBHOOK_SECRET = <your secret>        (copy from agents/.env)
 *
 * ── How this gets called ──────────────────────────────────────────────────────
 *
 * iOS Shortcut runs after every GymVerse workout:
 *   1. Reads the latest "Traditional Strength Training" workout from HealthKit
 *   2. Extracts: UUID, name, start time, end time, duration, active energy
 *   3. POSTs JSON to this endpoint with X-Webhook-Secret header
 *
 * The "Health Auto Export" app can also POST workout sessions automatically.
 *
 * ── Accepted payload formats ─────────────────────────────────────────────────
 *
 * Format A — single workout (iOS Shortcut, manual):
 * {
 *   "external_id":        "B5C8E2F1-1234-...",   // HealthKit UUID — used for dedup
 *   "workout_name":       "Push A",               // optional — set manually in GymVerse
 *   "started_at":         "2026-05-20T18:30:00",
 *   "ended_at":           "2026-05-20T19:22:00",
 *   "duration_secs":      3120,
 *   "active_energy_kcal": 318,
 *   "total_volume_kg":    3240,                   // optional — requires manual calc in shortcut
 *   "device":             "iPhone",
 *   "exercises": [                                // optional — omit if not available
 *     { "name": "Bench Press", "top_set": "90 kg × 5", "sets_done": 3,
 *       "volume_kg": 1215, "is_pr": false }
 *   ]
 * }
 *
 * Format B — batch (multiple workouts, e.g. initial backfill):
 * { "workouts": [ <workout>, <workout>, ... ] }
 *
 * ── Response ─────────────────────────────────────────────────────────────────
 * { "ok": true, "saved": 1, "skipped": 0, "total": 1 }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEBHOOK_SECRET       = Deno.env.get('GYMVERSE_WEBHOOK_SECRET') ?? ''

Deno.serve(async (req: Request) => {
  // ── Health check ─────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    return json({ ok: true, service: 'gymverse-sync', ts: new Date().toISOString() })
  }

  if (req.method !== 'POST') {
    return new Response('not found', { status: 404 })
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────
  if (WEBHOOK_SECRET && req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    console.warn('gymverse-sync: rejected — bad secret')
    return new Response('unauthorized', { status: 401 })
  }

  // ── Parse body ───────────────────────────────────────────────────────────────
  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return new Response('invalid json', { status: 400 })
  }

  // Support both single-workout and batch formats
  const workouts: Record<string, unknown>[] = Array.isArray((payload as any).workouts)
    ? (payload as any).workouts
    : [payload]

  if (!workouts.length) {
    return json({ ok: true, saved: 0, skipped: 0, total: 0 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  let saved = 0, skipped = 0

  for (const w of workouts) {
    const row = buildRow(w)

    if (!row.started_at) {
      console.warn('gymverse-sync: skipping workout without started_at')
      skipped++
      continue
    }

    const { error } = await supabase
      .from('gymverse_workouts')
      .upsert(row, { onConflict: 'external_id', ignoreDuplicates: false })

    if (error) {
      console.error(`gymverse-sync: DB error — ${error.message}`, row)
      skipped++
    } else {
      const label = `${row.workout_name ?? 'workout'} @ ${String(row.started_at).slice(0, 16)}`
      console.log(`gymverse-sync: ✅ ${label} | ${row.duration_secs}s | ${row.active_energy_kcal ?? '?'} kcal`)
      saved++
    }
  }

  return json({ ok: true, saved, skipped, total: workouts.length })
})

// ── Row builder ───────────────────────────────────────────────────────────────
function buildRow(w: Record<string, unknown>) {
  return {
    external_id:        str(w.external_id),
    workout_name:       str(w.workout_name),
    started_at:         str(w.started_at),
    ended_at:           str(w.ended_at)  ?? null,
    duration_secs:      num(w.duration_secs),
    active_energy_kcal: num(w.active_energy_kcal),
    total_volume_kg:    num(w.total_volume_kg)  ?? null,
    exercises:          Array.isArray(w.exercises) ? w.exercises : null,
    source_app:         'gymverse',
    device:             str(w.device) ?? null,
    raw:                w,
  }
}

function num(v: unknown): number | null {
  const n = Number(v); return isNaN(n) ? null : n
}
function str(v: unknown): string | null {
  return v != null ? String(v) : null
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
