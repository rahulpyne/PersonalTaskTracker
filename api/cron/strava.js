/**
 * Vercel Cron Function — Strava Nightly Sync
 *
 * Runs daily at 02:00 UTC via vercel.json cron schedule.
 * Reads/writes Strava OAuth tokens from the `strava_tokens` Supabase table
 * so no local file is needed — works fully in the cloud.
 *
 * Env vars required in Vercel dashboard:
 *   SUPABASE_URL            (same as VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_KEY    (service role key — NOT the anon key)
 *   STRAVA_CLIENT_ID
 *   STRAVA_CLIENT_SECRET
 *   CRON_SECRET             (set to any random string; used to secure the endpoint)
 */

import { createClient } from '@supabase/supabase-js'

const TYPE_MAP = {
  Run: 'run', TrailRun: 'run', Ride: 'ride', VirtualRide: 'ride',
  MountainBikeRide: 'ride', GravelRide: 'ride', Swim: 'swim',
  Walk: 'walk', Hike: 'hike', WeightTraining: 'strength',
  Crossfit: 'hiit', HIIT: 'hiit', Yoga: 'yoga', Pilates: 'yoga',
  Workout: 'workout', Elliptical: 'cardio', StairStepper: 'cardio',
  Rowing: 'cardio',
}

// ── Token management ─────────────────────────────────────────────────────────

async function loadTokens(sb) {
  const { data, error } = await sb
    .from('strava_tokens')
    .select('*')
    .eq('id', 'default')
    .single()
  if (error) throw new Error(`loadTokens: ${error.message}`)
  return data
}

async function refreshIfNeeded(tokens, sb) {
  if (Date.now() / 1000 < tokens.expires_at - 300) return tokens   // still valid

  console.log('Refreshing Strava access token…')
  const resp = await fetch('https://www.strava.com/oauth/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type:    'refresh_token',
      refresh_token: tokens.refresh_token,
    }),
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(`Token refresh failed: ${data.message ?? resp.status}`)

  const updated = {
    ...tokens,
    access_token:  data.access_token,
    refresh_token: data.refresh_token,
    expires_at:    data.expires_at,
  }

  const { error } = await sb
    .from('strava_tokens')
    .update({
      access_token:  updated.access_token,
      refresh_token: updated.refresh_token,
      expires_at:    updated.expires_at,
      updated_at:    new Date().toISOString(),
    })
    .eq('id', 'default')
  if (error) console.warn('Failed to persist refreshed token:', error.message)

  return updated
}

// ── Activity fetch + upsert ──────────────────────────────────────────────────

async function syncActivities(tokens, sb, lookbackDays = 7) {
  const after = Math.floor((Date.now() - lookbackDays * 86_400_000) / 1000)
  let page = 1, total = 0, synced = 0

  while (true) {
    const resp = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    )
    if (!resp.ok) throw new Error(`Strava API ${resp.status}: ${await resp.text()}`)

    const activities = await resp.json()
    if (!Array.isArray(activities) || activities.length === 0) break

    for (const a of activities) {
      total++
      const row = {
        source:           'strava',
        external_id:      `strava:${a.id}`,
        type:             TYPE_MAP[a.sport_type] || TYPE_MAP[a.type] || 'workout',
        name:             a.name,
        started_at:       a.start_date,
        duration_secs:    a.elapsed_time     || null,
        moving_secs:      a.moving_time      || null,
        distance_m:       a.distance         || null,
        elevation_gain_m: a.total_elevation_gain || null,
        avg_hr:           a.average_heartrate ? Math.round(a.average_heartrate) : null,
        max_hr:           a.max_heartrate     ? Math.round(a.max_heartrate)     : null,
        calories:         a.calories          || null,
        avg_speed_kmh:    a.average_speed     ? +(a.average_speed * 3.6).toFixed(2) : null,
        raw:              a,
      }

      const { error } = await sb
        .from('fitness_activities')
        .upsert(row, { onConflict: 'external_id' })

      if (error) console.warn(`Upsert error (${a.id}): ${error.message}`)
      else synced++
    }

    if (activities.length < 100) break
    page++
  }

  return { total, synced }
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Secure the endpoint — Vercel sends Authorization: Bearer <CRON_SECRET>
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers['authorization'] ?? ''
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  )

  try {
    let tokens = await loadTokens(sb)
    tokens = await refreshIfNeeded(tokens, sb)

    const lookbackDays = Number(process.env.STRAVA_LOOKBACK_DAYS ?? 7)
    const { total, synced } = await syncActivities(tokens, sb, lookbackDays)

    console.log(`Strava sync: ${total} fetched, ${synced} upserted`)
    return res.status(200).json({ ok: true, total, synced, ts: new Date().toISOString() })
  } catch (e) {
    console.error('Strava sync error:', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }
}
